"use strict";
/* =====================================================================
   Hanzi Drill — static site (GitHub Pages friendly)
   Storage: localStorage (per browser) + JSON export/import for backups.
   ===================================================================== */
const $ = id => document.getElementById(id);
const CJK = /[㐀-鿿]/;
const STORE_KEY = "hanziDrill.v2";
const HINTS_PER_WORD = 3;
const MASTER_STREAK = 2;           // clean results in a row to count a word as "mastered"

/* ---------------- Storage (this browser only) ---------------- */
const OLD_KEY = "hanziDrill.v1";          // earlier multi-profile version
function freshState(){ return { settings:{ sound:true, shuffle:true, pinyin:false, lastList:null }, progress:{}, sessions:[] }; }
function mergeState(src){
  const st = freshState();
  if(src && typeof src==="object"){
    Object.assign(st.settings, src.settings||{});
    st.progress = src.progress || {}; st.sessions = src.sessions || [];
  }
  return st;
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw) return mergeState(JSON.parse(raw));
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");       // carry over progress from the profile version
    if(old && old.profiles){
      const ps = Object.values(old.profiles);
      const p = old.profiles[old.lastProfile] || ps[0];
      if(p) return mergeState(p);
    }
  }catch(e){}
  return freshState();
}
function saveDB(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(profile)); }
  catch(e){ $("loadErr").textContent = "Couldn't save to this browser's storage. Use Export to keep your progress."; }
}

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
let profile = loadState();   // { settings, progress, sessions } — saved in this browser
let curList = null;          // selected list object
let activeSections = new Set();
let deck = [], idx = 0, sess, writers = [], boxEls = [], charIdx = 0, finished = false, itemState = null;
let learnStage = null, watchToken = 0;   // learnStage: null = normal drill, 0 watch / 1 trace / 2 copy
const BATCH = 5;                  // new words taught per batch, followed by a recall check
const STAGES = ["Watch","Trace","Copy"];
const charData = {};         // cache of hanzi-writer char data

/* ---------------- Shared (built-in) lists: files in /lists ---------------- */
let sharedLists = [];
async function discoverListFiles(){
  const found = new Map();                      // file -> display name
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if(m){                                        // auto-detect any .docx you drop into the repo's lists/ folder
    const owner = m[1], seg = location.pathname.split("/")[1];
    const repo = seg && !/\.html?$/i.test(seg) ? seg : owner + ".github.io";
    try{
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/lists`);
      if(r.ok) for(const f of await r.json()) if(f.type==="file" && /\.docx$/i.test(f.name)) found.set(f.name, null);
    }catch(e){}
  }
  try{                                          // manifest (works anywhere, and as a fallback)
    const r = await fetch("lists/manifest.json", {cache:"no-cache"});
    if(r.ok) for(const e of (await r.json()).lists||[]) found.set(e.file, e.name || found.get(e.file) || null);
  }catch(e){}
  return found;
}
async function loadSharedLists(){
  const out = [];
  try{
    const files = await discoverListFiles();
    await Promise.all([...files].map(async ([file, name]) => {
      try{
        const r = await fetch("lists/" + encodeURIComponent(file)); if(!r.ok) return;
        const items = parseVocab(await docxToLines(await r.arrayBuffer()));
        if(items.length) out.push({ id:"shared:"+file, shared:true, name: name || file.replace(/\.docx$/i,"").replace(/_/g," "), items });
      }catch(e){}
    }));
  }catch(e){}
  if(!out.length){                              // offline / opened from disk: fall back to the embedded L3 list
    try{ out.push({ id:"shared:builtin", shared:true, name:DEFAULT_LIST_NAME, items: parseVocab(await docxToLines(b64ToBuf(DEFAULT_DOCX_B64))) }); }catch(e){}
  }
  sharedLists = out.sort((a,b)=>a.name.localeCompare(b.name, undefined, {numeric:true}));
}
function allLists(){ return sharedLists; }

/* ---------------- Screens ---------------- */
function show(which){
  ["screenHome","stage","summary"].forEach(id => $(id).classList.toggle("hidden", id!==which));
  renderUserBar();
}
function renderUserBar(){
  $("userBar").innerHTML = `<button id="ubSound" aria-pressed="${profile.settings.sound}">${profile.settings.sound?"🔔 Sound on":"🔕 Sound off"}</button>
    <button id="ubExport" title="Download a backup of your progress">Export</button>
    <label class="btn" title="Restore progress from a backup file">Import<input type="file" id="importFile" accept=".json,application/json"></label>`;
  $("ubSound").onclick = () => { profile.settings.sound = !profile.settings.sound; saveDB(); renderUserBar(); if(profile.settings.sound) playSound("clean"); };
  $("ubExport").onclick = exportProgress;
  $("importFile").onchange = e => { if(e.target.files[0]) importProgress(e.target.files[0]); e.target.value = ""; };
}

/* ---------------- Export / import (backup file) ---------------- */
function exportProgress(){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ format:"hanzi-drill-progress", version:1, exported:new Date().toISOString(), data:profile }, null, 1)], {type:"application/json"}));
  a.download = "hanzi-drill-progress.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
async function importProgress(file){
  try{
    const d = JSON.parse(await file.text());
    if(d.format!=="hanzi-drill-progress" || !d.data) throw new Error("Not a Hanzi Drill progress file.");
    if(!confirm("Replace the progress saved in this browser with the contents of this file?")) return;
    profile = mergeState(d.data); saveDB();
    $("optShuffle").checked = profile.settings.shuffle; $("optPinyin").checked = profile.settings.pinyin;
    renderHome(); $("loadErr").textContent = "";
  }catch(e){ $("loadErr").textContent = "Couldn't import: " + e.message; }
}
function resetProgress(){
  if(!confirm("Erase all saved progress in this browser? This can't be undone (Export first if you want a backup).")) return;
  const keep = profile.settings; profile = freshState(); profile.settings = keep; saveDB(); renderHome();
}

/* ---------------- Home: lists, sections, progress ---------------- */
function renderHome(){
  const sel = $("listSel"); sel.innerHTML = "";
  const al = allLists();
  if(!curList || !al.includes(curList)) curList = al.find(l=>curList && l.id===curList.id) || al.find(l=>l.id===profile.settings.lastList) || al[0] || null;
  al.forEach(l => { const o = document.createElement("option"); o.value = l.id; o.textContent = `${l.name} (${l.items.length})`; sel.appendChild(o); });
  if(curList) sel.value = curList.id;
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
const isNew = it => { const s = stat(it.word); return !s || s.seen===0; };
function updateDeckInfo(){
  const items = selectedItems(), mode = $("optMode").value, nNew = items.filter(isNew).length;
  const n = mode==="learn" ? nNew : items.length;
  let msg = "No vocab list found.";
  if(curList){
    msg = mode==="learn" ? `${nNew} new word${nNew===1?"":"s"} to learn, in batches of ${BATCH}`
        : `${n} word${n===1?"":"s"} in this drill` + (nNew ? ` · ${nNew} new (taught first, step by step)` : "");
  }
  $("deckInfo").textContent = msg;
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

/* ---------------- Drill ---------------- */
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function startSession(){
  const items = selectedItems(), mode = $("optMode").value;
  const fresh = items.filter(isNew);
  let known = items.filter(it => !isNew(it));
  const entries = [];
  for(let i=0;i<fresh.length;i+=BATCH){                         // learn 5, then recall those 5 from a blank grid
    const b = fresh.slice(i, i+BATCH);
    b.forEach(it => entries.push({...it, phase:"learn"}));
    shuffle(b.slice()).forEach(it => entries.push({...it, phase:"recall"}));
  }
  if(mode!=="learn"){ if($("optShuffle").checked) known = shuffle(known.slice()); known.forEach(it => entries.push({...it})); }
  if(entries.length) startDrill(entries, true);
}
function startDrill(items, keepOrder){
  audio();   // unlock audio on user gesture
  profile.settings.shuffle = $("optShuffle").checked; profile.settings.pinyin = $("optPinyin").checked; saveDB();
  deck = items.slice(); if(!keepOrder && profile.settings.shuffle) shuffle(deck);
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
  $("secTag").textContent = it.phase==="recall" ? "Recall check · " + it.section : it.section;
  $("prompt").textContent = it.english || ("Pinyin: " + it.pinyin);
  $("hint").textContent = (profile.settings.pinyin && it.english) ? it.pinyin : "";
  $("verdict").className = "verdict"; $("verdict").innerHTML = "";
  $("bNext").classList.add("hidden");
  ["bHint","bReveal","bRetry","bSkip"].forEach(id=>$(id).disabled=false);
  if(it.phase==="learn"){ learnStage = 0; enterLearnStage(); return; }
  learnStage = null; setLearnUI(false);
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
      showCharacter:false, showOutline:(learnStage===1||learnStage===2), strokeColor:ink, outlineColor:"rgba(140,130,115,0.5)",
      highlightColor:"#b3362b", drawingColor:"#b3362b", drawingWidth:Math.max(8,Math.round(sz/22)),
      strokeAnimationSpeed:1.2, delayBetweenStrokes:150,
      showHintAfterMisses:false,            // no automatic hints — hints are only on request
      highlightOnComplete:true
    }));
  });
  updateHintBtn(); if(learnStage===0) return; startChar(0);
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
    if(learnStage===1) drawStrokeOverlay(i, 0, true);
    w.quiz({
      leniency: 1.0,
      onCorrectStroke: s => { itemState.strokesDone = s.strokeNum+1; clearOverlay(i);
        if(learnStage===1 && s.strokesRemaining) drawStrokeOverlay(i, s.strokeNum+1, true);
        setLive(`✓ Stroke ${s.strokeNum+1} correct` + (s.strokesRemaining ? ` — ${s.strokesRemaining} to go` : "")); },
      onMistake: s => { itemState.mistakes++; if(learnStage!==null){ setLive("Not quite — try that stroke again."); return; } setLive(`✗ That stroke doesn't match (stroke ${s.strokeNum+1}). Try again.`); },
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
function drawStrokeOverlay(i, n, persist){
  const ch = [...deck[idx].word][i], data = charData[ch];
  if(!data || n>=data.strokes.length) return false;
  const box = boxEls[i], sz = parseFloat(getComputedStyle(box).width) - 4;
  clearOverlay(i);
  const T = HanziWriter.getScalingTransform(sz, sz, Math.round((sz+4)*0.07));
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class","ov"); svg.setAttribute("width",sz); svg.setAttribute("height",sz);
  const g = document.createElementNS(ns,"g"); g.setAttribute("transform", T.transform);
  const path = document.createElementNS(ns,"path"); path.setAttribute("d", data.strokes[n]); g.appendChild(path);
  const m = data.medians && data.medians[n] && data.medians[n][0];
  if(m){ const c = document.createElementNS(ns,"circle"); c.setAttribute("cx",m[0]); c.setAttribute("cy",m[1]); c.setAttribute("r",36); g.appendChild(c); }
  svg.appendChild(g); box.appendChild(svg);
  if(!persist){ clearTimeout(hintTimer); hintTimer = setTimeout(() => { if(svg.isConnected) svg.remove(); }, 2000); }
  return true;
}
function useHint(){
  if(finished || charIdx>=writers.length || hintsLeft()<=0) return;
  const n = itemState.strokesDone;
  if(!drawStrokeOverlay(charIdx, n, false)) return;
  itemState.hintsUsed++; updateHintBtn();
  setLive(`Hint: stroke ${n+1} shown. ${hintsLeft()} hint${hintsLeft()===1?"":"s"} left for this word.`);
}

/* ---------------- Learn mode (guided, unscored): watch -> trace -> copy ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function setLearnUI(on){
  ["bHint","bReveal"].forEach(id => $(id).classList.toggle("hidden", on));
  if(!on){ $("bReplay").classList.add("hidden"); $("bRetry").classList.remove("hidden"); }
  $("stageNote").textContent = on ? `Guided practice, nothing here is scored. After every ${BATCH} new words you'll recall them from a blank grid.`
                                  : "Draw each stroke in order. You get 3 hints per word; each shows only the next stroke.";
}
function enterLearnStage(){
  const it = deck[idx]; finished = false; watchToken++;
  setLearnUI(true);
  $("secTag").textContent = `📖 Learn · step ${learnStage+1} of 3: ${STAGES[learnStage]}`;
  $("hint").textContent = it.pinyin;
  const instr = ["Watch the stroke order. Replay as often as you like.", "Trace each stroke. The highlighted stroke is next.", "Now draw it from just the faint outline."][learnStage];
  const v = $("verdict"); v.className = "verdict show info";
  v.innerHTML = `<b style="font-family:'Songti SC','Noto Serif CJK SC',serif;font-size:22px">${esc(it.word)}</b> &nbsp;${esc(it.pinyin||"")}${it.english?" — "+esc(it.english):""}
    <div class="more">${instr}</div>${it.examples && learnStage===0 ? `<div class="more" style="color:var(--muted)">${esc(it.examples)}${it.examplesEn?" · "+esc(it.examplesEn):""}</div>`:""}`;
  $("bNext").classList.toggle("hidden", learnStage!==0); $("bNext").textContent = "Next: Trace →";
  $("bReplay").classList.toggle("hidden", learnStage!==0);
  $("bRetry").classList.toggle("hidden", learnStage===0);
  $("bRetry").disabled = false; $("bSkip").disabled = false;
  buildBoxes(learnStage===0);
  if(learnStage===0){
    setLive("Loading…");
    Promise.all([...it.word].map(ch => HanziWriter.loadCharacterData(ch).then(d => { charData[ch] = d; })))
      .then(() => playWatch()).catch(() => setLive("Couldn't load stroke data. Are you offline?"));
  }
}
async function playWatch(){
  const tok = ++watchToken, my = idx;
  for(let i=0;i<writers.length;i++){
    if(tok!==watchToken || my!==idx) return;
    boxEls.forEach((b,k) => b.classList.toggle("active", k===i));
    setLive(writers.length>1 ? `Watching character ${i+1} of ${writers.length}` : "Watch the strokes");
    await new Promise(res => writers[i].animateCharacter({ onComplete: res }));
    await sleep(350);
  }
  if(tok!==watchToken || my!==idx) return;
  boxEls.forEach(b => b.classList.remove("active")); setLive("Press Replay to watch again, or go on to tracing.");
}
function learnStageDone(){
  finished = true; boxEls.forEach(b => b.classList.remove("active")); setLive("");
  playSound("hinted");
  const v = $("verdict"); v.className = "verdict show ok";
  v.innerHTML = learnStage===1
    ? `<b>✓ Traced it!</b><div class="more">Next, copy it from just the faint outline.</div>`
    : `<b>✓ Nicely done</b><div class="more">You'll recall this word from a blank grid in this batch's check.</div>`;
  $("bNext").classList.remove("hidden"); $("bRetry").disabled = true;
  $("bNext").textContent = learnStage===1 ? "Next: Copy →" : (idx+1>=deck.length ? "Finish" : "Next →");
  $("bNext").focus({preventScroll:true});
}

function record(word, result){      // result: clean | hinted | failed
  const s = profile.progress[word] || (profile.progress[word] = { seen:0, clean:0, hinted:0, failed:0, streak:0, last:null, ts:0 });
  s.seen++; s[result]++; s.last = result; s.ts = Date.now();
  s.streak = result==="clean" ? s.streak+1 : 0;
}

function finishItem(){
  if(finished) return; finished = true;
  if(deck[idx].phase==="learn") return learnStageDone();
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
function next(){
  if(deck[idx].phase==="learn" && learnStage<2){ learnStage++; enterLearnStage(); return; }
  idx++; if(idx>=deck.length) return endSession(false); showItem(); }
function skip(){
  if(deck[idx].phase==="learn"){ watchToken++; writers.forEach(w=>{ try{w.cancelQuiz();}catch(e){} }); learnStage = 2; finished = true; return next(); }   // skipping a lesson doesn't score anything
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
$("listSel").onchange = e => { curList = allLists().find(l=>l.id===e.target.value); profile.settings.lastList = curList.id; saveDB(); renderHome(); };
$("optMode").onchange = updateDeckInfo;
$("optShuffle").onchange = () => { profile.settings.shuffle = $("optShuffle").checked; saveDB(); };
$("optPinyin").onchange = () => { profile.settings.pinyin = $("optPinyin").checked; saveDB();
  if(sess && !$("stage").classList.contains("hidden") && deck[idx]) $("hint").textContent = profile.settings.pinyin ? deck[idx].pinyin : ""; };
$("start").onclick = startSession;
$("bHint").onclick = useHint; $("bReveal").onclick = reveal; $("bRetry").onclick = redraw;
$("bReplay").onclick = () => { if(learnStage===0) playWatch(); }; $("bSkip").onclick = skip; $("bNext").onclick = next; $("bQuit").onclick = () => endSession(false);
document.addEventListener("keydown", e => { if(e.key==="Enter" && !$("bNext").classList.contains("hidden") && document.activeElement.tagName!=="BUTTON" && document.activeElement.tagName!=="INPUT") next(); });

$("resetBtn").onclick = resetProgress;
$("optShuffle").checked = profile.settings.shuffle; $("optPinyin").checked = profile.settings.pinyin;
renderHome();                                   // shows the page immediately; lists fill in once loaded
loadSharedLists().then(() => { if(!$("screenHome").classList.contains("hidden")) renderHome(); });
