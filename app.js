"use strict";
/* =====================================================================
   Hanzi Drill — static site (GitHub Pages friendly)
   Storage: localStorage (per browser) + JSON export/import for backups.
   ===================================================================== */
const $ = id => document.getElementById(id);
const CJK = /[㐀-鿿]/;
const STORE_KEY = "hanziDrill.v1";
const HINTS_PER_WORD = 3;
const MASTER_STREAK = 2;           // clean results in a row to count a word as "mastered"

/* ---------------- Storage ---------------- */
let db = { profiles: {}, lastProfile: null };
let storageOK = true;

function loadDB(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw){ const d = JSON.parse(raw); if(d && d.profiles) db = d; }
  }catch(e){ storageOK = false; }
}
function saveDB(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(db)); storageOK = true; }
  catch(e){ storageOK = false; $("loadErr").textContent = "Couldn't save to this browser's storage. Use Export to keep your data."; }
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id" + Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------------- Passwords (optional) ---------------- */
const enc = new TextEncoder();
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function hashPw(pw, saltB64){
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return toB64(await crypto.subtle.deriveBits({name:"PBKDF2", salt, iterations:100000, hash:"SHA-256"}, key, 256));
}
const newSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

/* ---------------- Vocab parsing ---------------- */
async function docxToLines(arrayBuffer){
  const zip = await JSZip.loadAsync(arrayBuffer);
  const f = zip.file("word/document.xml");
  if(!f) throw new Error("This doesn't look like a .docx file.");
  const xml = new DOMParser().parseFromString(await f.async("string"), "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const lines = [];
  for(const p of xml.getElementsByTagNameNS(W,"p")){
    let s = "";
    const walk = n => { for(const c of n.childNodes){ if(c.nodeType!==1) continue;
      if(c.localName==="t") s += c.textContent; else if(c.localName==="tab") s += " "; else walk(c); } };
    walk(p);
    lines.push(s.replace(/ /g," ").trim());
  }
  return lines;
}
/* Lines look like:  词；pinyin: english；例句；example translation  */
function parseVocab(lines){
  const items = []; let section = "Vocab";
  for(const raw of lines){
    if(!raw) continue;
    if(!CJK.test(raw)){ section = raw.replace(/[:：]\s*$/,"").trim() || section; continue; }
    let parts = raw.split(/[；;]/).map(s=>s.trim());
    if(parts.length===1){ const k = raw.search(/[，,]/); if(k>0) parts = [raw.slice(0,k).trim(), raw.slice(k+1).trim()]; }
    const word = (parts[0].match(/[㐀-鿿]+/g)||[]).join("");
    if(!word) continue;
    const rest = (parts[1]||"").trim(); let pinyin = "", english = "";
    const m = rest.match(/^([^:：,，]+?)\s*[:：,，]\s*(.*)$/);
    if(m){ pinyin = m[1].trim(); english = m[2].trim(); } else { pinyin = rest; }
    english = english.split(/[，]\s*(?=[㐀-鿿])/)[0].replace(/[，,\s]+$/,"").trim();
    items.push({ word, pinyin, english, section,
      examples: (parts[2]||"").replace(/[，,\s]+$/,""),
      examplesEn: (parts[3]||"").replace(/[，,\s]+$/,"") });
  }
  return items;
}
function b64ToBuf(b64){ const bin = atob(b64), a = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a.buffer; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------------- Sound ---------------- */
let actx = null;
function audio(){
  if(!actx){ try{ actx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; } }
  if(actx.state==="suspended") actx.resume();
  return actx;
}
function tone(freq, t0, dur, gain, type="sine"){
  const c = actx, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0+dur+0.05);
}
function bell(f, t0, gain){            // little bell: fundamental + inharmonic partials
  tone(f, t0, 1.3, gain); tone(f*2.76, t0, 0.7, gain*0.35); tone(f*5.4, t0, 0.35, gain*0.15);
}
function playSound(kind){
  if(!profile || !profile.settings.sound) return;
  if(!audio()) return;
  const t = actx.currentTime + 0.02;
  if(kind==="clean"){ bell(1318.5, t, 0.28); bell(1760, t+0.12, 0.24); }       // bright two-note ring
  else if(kind==="hinted"){ bell(1046.5, t, 0.24); }                            // single softer ring
  else { tone(330, t, 0.35, 0.18, "triangle"); tone(247, t+0.16, 0.45, 0.16, "triangle"); }  // gentle low "nope"
}

/* ---------------- State ---------------- */
let profile = null;          // current profile object (inside db.profiles)
let curList = null;          // selected list object
let activeSections = new Set();
let deck = [], idx = 0, sess, writers = [], boxEls = [], charIdx = 0, finished = false, itemState = null;
const charData = {};         // cache of hanzi-writer char data

/* ---------------- Screens ---------------- */
function show(which){
  ["screenLogin","screenHome","stage","summary"].forEach(id => $(id).classList.toggle("hidden", id!==which));
  renderUserBar();
}
function renderUserBar(){
  const bar = $("userBar");
  if(!profile){ bar.innerHTML = ""; return; }
  bar.innerHTML = `<span class="sub">Signed in as <b>${esc(profile.name)}</b></span>
    <button id="ubSound" aria-pressed="${profile.settings.sound}">${profile.settings.sound?"🔔 Sound on":"🔕 Sound off"}</button>
    <button id="ubExport">Export</button><button id="ubOut">Log out</button>`;
  $("ubSound").onclick = () => { profile.settings.sound = !profile.settings.sound; saveDB(); renderUserBar(); if(profile.settings.sound) playSound("clean"); };
  $("ubExport").onclick = exportProfile;
  $("ubOut").onclick = logout;
}

/* ---------------- Login screen ---------------- */
let pendingLogin = null;
function renderLogin(){
  profile = null; renderUserBar();
  const list = $("profileList"); list.innerHTML = "";
  const ps = Object.values(db.profiles).sort((a,b)=>(a.created||0)-(b.created||0));
  if(!ps.length) list.innerHTML = `<div class="sub">No profiles yet — create one below.</div>`;
  ps.forEach(p => {
    const b = document.createElement("button"); b.className = "pcard";
    const words = Object.keys(p.progress||{}).length;
    b.innerHTML = `<b>${esc(p.name)}${p.hash?" 🔒":""}</b><small>${words} word${words===1?"":"s"} practiced</small>`;
    b.onclick = () => beginLogin(p);
    list.appendChild(b);
  });
  $("pwPrompt").classList.add("hidden"); $("loginErr").textContent = "";
  show("screenLogin");
}
function beginLogin(p){
  if(!p.hash) return enterProfile(p);
  pendingLogin = p; $("pwFor").textContent = `Password for ${p.name}:`; $("pwInput").value = "";
  $("pwPrompt").classList.remove("hidden"); $("loginErr").textContent = ""; $("pwInput").focus();
}
async function tryPw(){
  const p = pendingLogin; if(!p) return;
  try{
    if(await hashPw($("pwInput").value, p.salt) === p.hash){ pendingLogin = null; enterProfile(p); }
    else $("loginErr").textContent = "Wrong password.";
  }catch(e){ $("loginErr").textContent = "Password check isn't available in this browser."; }
}
async function createProfile(){
  const name = $("npName").value.trim(), pw = $("npPw").value;
  if(!name) return $("loginErr").textContent = "Enter a name.";
  if(Object.values(db.profiles).some(p=>p.name.toLowerCase()===name.toLowerCase())) return $("loginErr").textContent = "That name is already taken.";
  const p = { id: uid(), name, created: Date.now(), salt:null, hash:null,
    settings:{ sound:true, shuffle:true, pinyin:false }, lists:[], progress:{}, sessions:[] };
  if(pw){
    try{ p.salt = newSalt(); p.hash = await hashPw(pw, p.salt); }
    catch(e){ return $("loginErr").textContent = "Passwords aren't supported in this browser; leave it blank."; }
  }
  try{ p.lists.push({ id:uid(), name:DEFAULT_LIST_NAME, added:Date.now(), items: parseVocab(await docxToLines(b64ToBuf(DEFAULT_DOCX_B64))) }); }catch(e){}
  db.profiles[p.id] = p; saveDB();
  $("npName").value = $("npPw").value = ""; $("newProfile").open = false;
  enterProfile(p);
}
function enterProfile(p){
  profile = p; db.lastProfile = p.id; saveDB();
  $("optShuffle").checked = p.settings.shuffle; $("optPinyin").checked = p.settings.pinyin;
  $("loadErr").textContent = "";
  curList = p.lists.find(l=>l.id===p.settings.lastList) || p.lists[0] || null;
  renderHome();
}
function logout(){ if(sess && !$("stage").classList.contains("hidden")) endSession(true); renderLogin(); }

/* ---------------- Export / import ---------------- */
function download(name, text){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type:"application/json"})); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
function exportProfile(){
  download(`hanzi-drill-${profile.name.replace(/\W+/g,"_")}.json`,
    JSON.stringify({ format:"hanzi-drill-profile", version:1, exported:new Date().toISOString(), profile }, null, 1));
}
async function importProfile(file){
  try{
    const d = JSON.parse(await file.text());
    if(d.format!=="hanzi-drill-profile" || !d.profile || !d.profile.name) throw new Error("Not a Hanzi Drill profile file.");
    const p = d.profile; p.lists = p.lists||[]; p.progress = p.progress||{}; p.sessions = p.sessions||[];
    p.settings = Object.assign({sound:true,shuffle:true,pinyin:false}, p.settings);
    const same = Object.values(db.profiles).find(x=>x.name.toLowerCase()===p.name.toLowerCase());
    if(same){
      if(confirm(`A profile named "${same.name}" already exists here. Replace it with the imported one?\n(Cancel imports it as a separate copy.)`)){ delete db.profiles[same.id]; p.id = same.id; }
      else { p.id = uid(); p.name += " (imported)"; }
    } else if(!p.id || db.profiles[p.id]) p.id = uid();
    db.profiles[p.id] = p; saveDB(); renderLogin();
    $("loginErr").textContent = "";
  }catch(e){ $("loginErr").textContent = "Couldn't import: " + e.message; }
}

/* ---------------- Home: lists, sections, progress ---------------- */
function renderHome(){
  const sel = $("listSel"); sel.innerHTML = "";
  profile.lists.forEach(l => { const o = document.createElement("option"); o.value = l.id; o.textContent = `${l.name} (${l.items.length})`; sel.appendChild(o); });
  if(curList) sel.value = curList.id;
  $("listDel").disabled = !curList;
  const secs = curList ? [...new Set(curList.items.map(i=>i.section))] : [];
  activeSections = new Set(secs);
  const box = $("sections"); box.innerHTML = "";
  secs.forEach(s => {
    const n = curList.items.filter(i=>i.section===s).length;
    const b = document.createElement("button"); b.className = "chip"; b.setAttribute("aria-pressed","true"); b.textContent = `${s} (${n})`;
    b.onclick = () => { if(activeSections.has(s)){ activeSections.delete(s); b.setAttribute("aria-pressed","false"); } else { activeSections.add(s); b.setAttribute("aria-pressed","true"); } updateDeckInfo(); };
    box.appendChild(b);
  });
  updateDeckInfo(); renderProgress(); show("screenHome");
}
const stat = w => (profile.progress[w] || null);
const isMastered = w => { const s = stat(w); return !!s && s.streak >= MASTER_STREAK; };
function selectedItems(){
  if(!curList) return [];
  const seen = new Set(), out = [];
  const weak = $("optMode").value === "weak";
  for(const it of curList.items){
    if(!activeSections.has(it.section) || seen.has(it.word)) continue;
    seen.add(it.word);
    if(weak && isMastered(it.word)) continue;
    out.push(it);
  }
  return out;
}
function updateDeckInfo(){
  const n = selectedItems().length;
  $("deckInfo").textContent = curList ? `${n} word${n===1?"":"s"} in this drill` : "Upload a vocab file to begin.";
  $("start").disabled = n===0;
}
function renderProgress(){
  const P = $("progressPanel");
  if(!curList){ P.innerHTML = `<h2 class="sec">Progress</h2><div class="sub">No list yet.</div>`; return; }
  const uniq = [...new Map(curList.items.map(i=>[i.word,i])).values()];
  let mastered=0, practiced=0, att=0, clean=0;
  uniq.forEach(i => { const s = stat(i.word); if(s){ practiced++; att += s.seen; clean += s.clean; if(s.streak>=MASTER_STREAK) mastered++; } });
  const acc = att ? Math.round(clean/att*100) : 0;
  const chips = uniq.map(i => {
    const s = stat(i.word); let c = "";
    if(s) c = s.streak>=MASTER_STREAK ? "m" : (s.last==="failed" ? "f" : s.last==="hinted" ? "h" : "");
    const tip = s ? `${i.pinyin} — ${i.english} · ${s.clean}/${s.seen} clean` : `${i.pinyin} — ${i.english} · not practiced`;
    return `<span class="w ${c}" title="${esc(tip)}">${esc(i.word)}</span>`;
  }).join("");
  const recent = (profile.sessions||[]).slice(-3).reverse().map(s =>
    `<div class="note">${new Date(s.ts).toLocaleDateString()} · ${esc(s.list)}: ${s.clean} clean, ${s.hinted} with hints, ${s.failed} missed</div>`).join("");
  P.innerHTML = `<h2 class="sec">Progress — ${esc(curList.name)}</h2>
    <div class="stats"><div><b>${mastered}/${uniq.length}</b>mastered</div><div><b>${practiced}/${uniq.length}</b>practiced</div><div><b>${att?acc+"%":"–"}</b>clean on first go</div></div>
    <div class="words">${chips}</div>
    <div class="legend"><span>■ green: mastered (${MASTER_STREAK} clean in a row)</span><span>■ yellow: last time used hints</span><span>■ red: last time missed</span><span>□ not practiced / in progress</span></div>
    <div style="margin-top:10px">${recent}</div>`;
}

async function addFiles(files){
  const errs = [];
  for(const f of files){
    try{
      const items = parseVocab(await docxToLines(await f.arrayBuffer()));
      if(!items.length) throw new Error("no Chinese vocabulary lines found");
      let name = f.name.replace(/\.docx$/i,""), base = name, n = 2;
      while(profile.lists.some(l=>l.name===name)) name = `${base} (${n++})`;
      const l = { id:uid(), name, added:Date.now(), items };
      profile.lists.push(l); curList = l;
    }catch(e){ errs.push(`${f.name}: ${e.message}`); }
  }
  if(curList) profile.settings.lastList = curList.id;
  saveDB(); renderHome();
  $("loadErr").textContent = errs.length ? "Couldn't read " + errs.join("; ") : "";
}

/* ---------------- Drill ---------------- */
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function startDrill(items){
  audio();   // unlock audio on user gesture
  profile.settings.shuffle = $("optShuffle").checked; profile.settings.pinyin = $("optPinyin").checked; saveDB();
  deck = items.slice(); if(profile.settings.shuffle) shuffle(deck);
  idx = 0; sess = { list: curList ? curList.name : "", clean:0, hinted:0, failed:0, review:[], saved:false };
  show("stage"); showItem();
}
function boxSize(n){
  const avail = Math.min(window.innerWidth - 80, 700);
  return Math.max(120, Math.min(260, Math.floor((avail - (n-1)*12) / n)));
}
function updateScore(){ $("pScore").textContent = `${sess.clean} clean · ${sess.hinted} hinted · ${sess.failed} missed`; }

function showItem(){
  const it = deck[idx]; finished = false;
  $("pCount").textContent = `Word ${idx+1} of ${deck.length}`; updateScore();
  $("pBar").style.width = (idx/deck.length*100)+"%";
  $("secTag").textContent = it.section;
  $("prompt").textContent = it.english || ("Pinyin: " + it.pinyin);
  $("hint").textContent = (profile.settings.pinyin && it.english) ? it.pinyin : "";
  $("verdict").className = "verdict"; $("verdict").innerHTML = "";
  $("bNext").classList.add("hidden");
  ["bHint","bReveal","bRetry","bSkip"].forEach(id=>$(id).disabled=false);
  buildBoxes(true);
}
function hintsLeft(){ return HINTS_PER_WORD - itemState.hintsUsed; }
function updateHintBtn(){ $("bHint").textContent = `Hint (${hintsLeft()})`; $("bHint").disabled = finished || hintsLeft()<=0; }

function buildBoxes(fresh){
  const it = deck[idx];
  writers.forEach(w=>{ try{ w.cancelQuiz(); }catch(e){} });
  const chars = [...it.word];
  const host = $("boxes"); host.innerHTML = ""; writers = []; boxEls = [];
  const sz = boxSize(chars.length); host.style.setProperty("--sz", sz+"px");
  if(fresh) itemState = { mistakes:0, hintsUsed:0, revealed:false, missing:[] };
  else { itemState.mistakes = 0; itemState.missing = []; }       // redraw keeps hints spent
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#222";
  chars.forEach((ch,i) => {
    const d = document.createElement("div"); d.className = "box";
    if(chars.length>1){ const t=document.createElement("span"); t.className="tag"; t.textContent=`${i+1}/${chars.length}`; d.appendChild(t); }
    host.appendChild(d); boxEls.push(d);
    writers.push(HanziWriter.create(d, ch, {
      width: sz-4, height: sz-4, padding: Math.round(sz*0.07),
      showCharacter:false, showOutline:false, strokeColor:ink, outlineColor:"#bbb",
      highlightColor:"#b3362b", drawingColor:"#b3362b", drawingWidth:Math.max(8,Math.round(sz/22)),
      strokeAnimationSpeed:1.2, delayBetweenStrokes:150,
      showHintAfterMisses:false,            // no automatic hints — hints are only on request
      highlightOnComplete:true
    }));
  });
  updateHintBtn(); startChar(0);
}
function setLive(m){ $("live").textContent = m; }

function startChar(i){
  charIdx = i;
  if(i>=writers.length) return finishItem();
  boxEls.forEach((b,k)=>b.classList.toggle("active", k===i));
  const w = writers[i], ch = [...deck[idx].word][i];
  itemState.strokesDone = 0;
  setLive(writers.length>1 ? `Draw character ${i+1} of ${writers.length}` : "Draw the character");
  const my = idx;
  HanziWriter.loadCharacterData(ch).then(data => {
    if(my!==idx || finished || writers[i]!==w) return;
    charData[ch] = data;
    w.quiz({
      leniency: 1.0,
      onCorrectStroke: s => { itemState.strokesDone = s.strokeNum+1; clearOverlay(i);
        setLive(`✓ Stroke ${s.strokeNum+1} correct` + (s.strokesRemaining ? ` — ${s.strokesRemaining} to go` : "")); },
      onMistake: s => { itemState.mistakes++; setLive(`✗ That stroke doesn't match (stroke ${s.strokeNum+1}). Try again.`); },
      onComplete: () => { clearOverlay(i); boxEls[i].classList.remove("active"); boxEls[i].classList.add("done"); startChar(i+1); }
    });
  }).catch(() => charMissing(i, ch));
}
function charMissing(i, ch){
  itemState.missing.push(ch); boxEls[i].classList.remove("active");
  boxEls[i].insertAdjacentHTML("beforeend", `<div style="position:absolute;inset:0;display:grid;place-items:center;font-size:13px;color:var(--muted);padding:10px;text-align:center">No stroke data for ${esc(ch)}<br>(or offline)</div>`);
  startChar(i+1);
}

/* Hint: overlay ONLY the next stroke (plus a dot where it starts) */
function clearOverlay(i){ const o = boxEls[i] && boxEls[i].querySelector(".ov"); if(o) o.remove(); }
let hintTimer = null;
function useHint(){
  if(finished || charIdx>=writers.length || hintsLeft()<=0) return;
  const ch = [...deck[idx].word][charIdx], data = charData[ch], n = itemState.strokesDone;
  if(!data || n>=data.strokes.length) return;
  itemState.hintsUsed++; updateHintBtn();
  const box = boxEls[charIdx], sz = parseFloat(getComputedStyle(box).width) - 4;
  clearOverlay(charIdx);
  const T = HanziWriter.getScalingTransform(sz, sz, Math.round((sz+4)*0.07));
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class","ov"); svg.setAttribute("width",sz); svg.setAttribute("height",sz);
  const g = document.createElementNS(ns,"g"); g.setAttribute("transform", T.transform);
  const path = document.createElementNS(ns,"path"); path.setAttribute("d", data.strokes[n]); g.appendChild(path);
  const m = data.medians && data.medians[n] && data.medians[n][0];
  if(m){ const c = document.createElementNS(ns,"circle"); c.setAttribute("cx",m[0]); c.setAttribute("cy",m[1]); c.setAttribute("r",36); g.appendChild(c); }
  svg.appendChild(g); box.appendChild(svg);
  const mine = svg; clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { if(mine.isConnected) mine.remove(); }, 2000);
  setLive(`Hint: stroke ${n+1} shown. ${hintsLeft()} hint${hintsLeft()===1?"":"s"} left for this word.`);
}

function record(word, result){      // result: clean | hinted | failed
  const s = profile.progress[word] || (profile.progress[word] = { seen:0, clean:0, hinted:0, failed:0, streak:0, last:null, ts:0 });
  s.seen++; s[result]++; s.last = result; s.ts = Date.now();
  s.streak = result==="clean" ? s.streak+1 : 0;
}

function finishItem(){
  if(finished) return; finished = true;
  const it = deck[idx], st = itemState, n = [...it.word].length;
  boxEls.forEach(b=>b.classList.remove("active"));
  let cls, head, detail = "", result = null;
  if(st.missing.length===n){
    cls="warn"; head="Couldn't check this one"; detail="Stroke data couldn't be loaded (are you offline?). Nothing was recorded.";
  } else if(st.revealed){
    cls="bad"; head="✗ Not quite — answer revealed"; result="failed"; boxEls.forEach(b=>b.classList.add("fail"));
  } else if(st.hintsUsed>0){
    cls="warn"; head=`Correct — with ${st.hintsUsed} hint${st.hintsUsed===1?"":"s"}`; result="hinted";
    detail = "You drew every stroke right, but with help, so it counts as needing review.";
  } else {
    cls="ok"; result="clean"; head = st.mistakes===0 ? "✓ Correct — perfect!" : "✓ Correct";
    if(st.mistakes) detail = `Right character, with ${st.mistakes} wrong stroke attempt${st.mistakes===1?"":"s"} along the way.`;
  }
  if(result){ record(it.word, result); sess[result]++; if(result!=="clean") sess.review.push({it, result}); saveDB(); playSound(result); }
  setLive("");
  const ex = [`<b style="font-size:20px;font-family:'Songti SC','Noto Serif CJK SC',serif">${esc(it.word)}</b> &nbsp;${esc(it.pinyin||"")}${it.english?" — "+esc(it.english):""}`];
  if(it.examples) ex.push(esc(it.examples) + (it.examplesEn ? ` <span style="color:var(--muted)">· ${esc(it.examplesEn)}</span>` : ""));
  const v = $("verdict"); v.className = "verdict show "+cls;
  v.innerHTML = `<b>${head}</b>${detail?`<div class="more">${detail}</div>`:""}<div class="more">${ex.join("<br>")}</div>`;
  updateScore(); $("pBar").style.width = ((idx+1)/deck.length*100)+"%";
  $("bNext").classList.remove("hidden"); $("bNext").textContent = idx+1>=deck.length ? "Finish" : "Next →";
  $("bNext").focus({preventScroll:true});
  ["bHint","bReveal","bRetry"].forEach(id=>$(id).disabled=true);
}
function reveal(){
  if(finished) return;
  itemState.revealed = true;
  try{ writers[charIdx].cancelQuiz(); }catch(e){}
  clearOverlay(charIdx);
  writers.forEach((wr,k)=>{ if(k>=charIdx) wr.showCharacter({duration:200}); });
  finishItem();
}
function redraw(){ if(!finished) buildBoxes(false); }
function next(){ idx++; if(idx>=deck.length) return endSession(false); showItem(); }
function skip(){
  if(finished) return next();
  writers.forEach(w=>{ try{w.cancelQuiz();}catch(e){} });
  record(deck[idx].word, "failed"); sess.failed++; sess.review.push({it:deck[idx], result:"failed"}); saveDB();
  next();
}
function endSession(silent){
  if(!sess || sess.saved) return; sess.saved = true;
  writers.forEach(w=>{ try{w.cancelQuiz();}catch(e){} });
  const total = sess.clean + sess.hinted + sess.failed;
  if(total){ profile.sessions.push({ ts:Date.now(), list:sess.list, clean:sess.clean, hinted:sess.hinted, failed:sess.failed });
    profile.sessions = profile.sessions.slice(-50); saveDB(); }
  if(silent) return;
  const pct = total ? Math.round(sess.clean/total*100) : 0;
  const s = $("summary");
  s.innerHTML = `<h2 class="sec" style="font-size:20px">Round complete</h2>
    <div>${sess.clean} clean · ${sess.hinted} with hints · ${sess.failed} missed — ${pct}% clean.</div>
    ${sess.review.length ? `<div style="margin-top:12px" class="sub">Words to review:</div><ul>${sess.review.map(r=>`<li class="${r.result==="hinted"?"y":""}">${esc(r.it.word)} · ${esc(r.it.english||r.it.pinyin)}</li>`).join("")}</ul>` : `<div style="margin-top:8px">Nothing to review — nice work.</div>`}
    <div class="row" style="margin-top:16px">
      ${sess.review.length ? `<button class="primary" id="sRetry">Drill these words</button>` : ""}
      <button id="sHome">Back to progress</button>
    </div>`;
  show("summary");
  if(sess.review.length){ const r = sess.review.map(x=>x.it); $("sRetry").onclick = () => startDrill(r); }
  $("sHome").onclick = () => renderHome();
}

/* ---------------- Wire up ---------------- */
$("npGo").onclick = createProfile;
$("npName").onkeydown = $("npPw").onkeydown = e => { if(e.key==="Enter") createProfile(); };
$("pwGo").onclick = tryPw; $("pwInput").onkeydown = e => { if(e.key==="Enter") tryPw(); };
$("pwCancel").onclick = () => { pendingLogin = null; $("pwPrompt").classList.add("hidden"); $("loginErr").textContent = ""; };
$("importFile").onchange = e => { if(e.target.files[0]) importProfile(e.target.files[0]); e.target.value = ""; };
$("file").onchange = e => { if(e.target.files.length) addFiles([...e.target.files]); e.target.value = ""; };
$("listSel").onchange = e => { curList = profile.lists.find(l=>l.id===e.target.value); profile.settings.lastList = curList.id; saveDB(); renderHome(); };
$("listDel").onclick = () => {
  if(!curList || !confirm(`Delete the list "${curList.name}"? (Your progress on its words is kept.)`)) return;
  profile.lists = profile.lists.filter(l=>l!==curList); curList = profile.lists[0] || null; saveDB(); renderHome();
};
$("optMode").onchange = updateDeckInfo;
$("optShuffle").onchange = () => { profile.settings.shuffle = $("optShuffle").checked; saveDB(); };
$("optPinyin").onchange = () => { profile.settings.pinyin = $("optPinyin").checked; saveDB();
  if(sess && !$("stage").classList.contains("hidden") && deck[idx]) $("hint").textContent = profile.settings.pinyin ? deck[idx].pinyin : ""; };
$("start").onclick = () => startDrill(selectedItems());
$("bHint").onclick = useHint; $("bReveal").onclick = reveal; $("bRetry").onclick = redraw;
$("bSkip").onclick = skip; $("bNext").onclick = next; $("bQuit").onclick = () => endSession(false);
document.addEventListener("keydown", e => { if(e.key==="Enter" && !$("bNext").classList.contains("hidden") && document.activeElement.tagName!=="BUTTON" && document.activeElement.tagName!=="INPUT") next(); });

loadDB();
renderLogin();
