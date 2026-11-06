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
function freshState(){ return { settings:{ sound:true, shuffle:true, pinyin:false, lastList:null, practice:"write" }, progress:{}, pinyin:{}, translate:{}, sessions:[], backup:{ ts:0, changes:0 } }; }
function mergeState(src){
  const st = freshState();
  if(src && typeof src==="object"){
    Object.assign(st.settings, src.settings||{});
    st.progress = src.progress || {}; st.pinyin = src.pinyin || {}; st.translate = src.translate || {}; st.sessions = src.sessions || [];
    Object.assign(st.backup, src.backup||{});
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
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(profile)); if(typeof Cloud!=="undefined") Cloud.schedule(); }
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

/* ---------------- Sound: soft, rounded tones through a gentle filter and echo ---------------- */
let actx = null, bus = null;
function audio(){
  if(!actx){
    try{ actx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; }
    const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2200;     // takes the edge off
    const master = actx.createGain(); master.gain.value = 0.55;
    const echo = actx.createDelay(); echo.delayTime.value = 0.18;
    const fb = actx.createGain(); fb.gain.value = 0.22;                                         // short, quiet echo
    lp.connect(master); lp.connect(echo); echo.connect(fb).connect(echo); echo.connect(master);
    master.connect(actx.destination); bus = lp;
  }
  if(actx.state==="suspended") actx.resume();
  return actx;
}
function note(freq, t0, dur, gain){       // sine with a soft attack and long, smooth fade
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = "sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0+0.025);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  o.connect(g).connect(bus); o.start(t0); o.stop(t0+dur+0.05);
  const o2 = actx.createOscillator(), g2 = actx.createGain();                                // faint octave for warmth
  o2.type = "sine"; o2.frequency.value = freq*2;
  g2.gain.setValueAtTime(0.0001, t0); g2.gain.linearRampToValueAtTime(gain*0.12, t0+0.02); g2.gain.exponentialRampToValueAtTime(0.0001, t0+dur*0.5);
  o2.connect(g2).connect(bus); o2.start(t0); o2.stop(t0+dur);
}
function playSound(kind){
  if(!profile || !profile.settings.sound) return;
  if(!audio()) return;
  const t = actx.currentTime + 0.02;
  if(kind==="clean"){ note(523.25, t, 0.9, 0.14); note(659.25, t+0.09, 0.9, 0.12); note(783.99, t+0.18, 1.1, 0.11); }   // soft C-E-G arpeggio
  else if(kind==="hinted"){ note(587.33, t, 0.8, 0.12); note(698.46, t+0.1, 0.9, 0.1); }                              // two gentle notes
  else { note(392, t, 0.5, 0.1); note(329.63, t+0.14, 0.7, 0.09); }                                                    // quiet falling pair
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
  ["screenHome","stage","pstage","tstage","summary"].forEach(id => $(id).classList.toggle("hidden", id!==which));
  if(which!=="screenHome") $("flash").hidden = true;
  renderUserBar();
}
function renderUserBar(){
  $("userBar").innerHTML = `<button id="ubSound" aria-pressed="${profile.settings.sound}">${profile.settings.sound?"🔔 Sound on":"🔕 Sound off"}</button>
    ${typeof Cloud!=="undefined" && Cloud.enabled() ? `<button id="ubCloud" class="cloud ${Cloud.status()}" title="Sync progress across devices">${CLOUD_LABEL[Cloud.status()]||"☁️ Sync"}</button>` : ""}
    <button id="ubSync" title="Save your progress as a link, or load it on another device">💾 Save / load</button>`;
  if($("ubCloud")) $("ubCloud").onclick = openSync;
  $("ubSound").onclick = () => { profile.settings.sound = !profile.settings.sound; saveDB(); renderUserBar(); if(profile.settings.sound) playSound("clean"); };
  $("ubSync").onclick = openSync;
}

/* ---------------- Save / load: progress link, code, or file ----------------
   Progress is packed into a short code (compressed JSON) that fits in a link: <site>#p=<code>.
   Loading always merges: for each word, the most recent result wins, so nothing newer is lost. */
const LASTS = [null, "clean", "hinted", "failed"];
const packStats = m => Object.fromEntries(Object.entries(m||{}).map(([w,s]) =>
  [w, [s.seen, s.clean, s.failed, s.streak, Math.max(0, LASTS.indexOf(s.last)), Math.round((s.ts||0)/6e4)]]));
const unpackStats = m => Object.fromEntries(Object.entries(m||{}).map(([w,a]) =>
  [w, { seen:a[0], clean:a[1], hinted:Math.max(0, a[0]-a[1]-a[2]), failed:a[2], streak:a[3], last:LASTS[a[4]]||null, ts:a[5]*6e4 }]));
function b64url(bytes){ let s = ""; for(let i=0;i<bytes.length;i+=8192) s += String.fromCharCode(...bytes.subarray(i, i+8192)); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function unb64url(str){ const bin = atob(str.replace(/-/g,"+").replace(/_/g,"/")); const a = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i] = bin.charCodeAt(i); return a; }
async function pipeBytes(bytes, stream){ return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
async function encodeProgress(){
  const json = JSON.stringify({ v:2, s:profile.settings, w:packStats(profile.progress), y:packStats(profile.pinyin), z:packStats(profile.translate),
    h:(profile.sessions||[]).slice(-20).map(x => [Math.round(x.ts/6e4), x.list, x.clean, x.hinted, x.failed, x.type==="pinyin"?1:x.type==="translate"?2:0]) });
  const bytes = new TextEncoder().encode(json);
  if(window.CompressionStream){ try{ return "1" + b64url(await pipeBytes(bytes, new CompressionStream("deflate-raw"))); }catch(e){} }
  return "0" + b64url(bytes);
}
async function decodeProgress(code){
  let bytes = unb64url(code.slice(1));
  if(code[0]==="1"){
    if(!window.DecompressionStream) throw new Error("this browser is too old to read progress codes. Try Chrome, Edge, Firefox or Safari.");
    bytes = await pipeBytes(bytes, new DecompressionStream("deflate-raw"));
  } else if(code[0]!=="0") throw new Error("that isn't a progress code.");
  const d = JSON.parse(new TextDecoder().decode(bytes));
  return { settings:d.s||{}, progress:unpackStats(d.w), pinyin:unpackStats(d.y), translate:unpackStats(d.z),
    sessions:(d.h||[]).map(a => ({ ts:a[0]*6e4, list:a[1], clean:a[2], hinted:a[3], failed:a[4], type:["write","pinyin","translate"][a[5]]||"write" })) };
}
const progressLink = code => location.origin + location.pathname + "#p=" + code;

/* Combine incoming progress with this browser's. Returns how many words changed. */
function mergeProgress(inc){
  const wasEmpty = ["progress","pinyin","translate"].every(k => !Object.keys(profile[k]).length);
  let changed = 0;
  for(const key of ["progress","pinyin","translate"]){
    for(const [w, s] of Object.entries(inc[key]||{})){
      const cur = profile[key][w];
      if(!cur || (s.ts||0) > (cur.ts||0)){ profile[key][w] = s; changed++; }
    }
  }
  const seen = new Set(profile.sessions.map(s => Math.round(s.ts/6e4)+"|"+s.list));
  for(const s of inc.sessions||[]) if(!seen.has(Math.round(s.ts/6e4)+"|"+s.list)) profile.sessions.push(s);
  profile.sessions.sort((a,b) => a.ts-b.ts); profile.sessions = profile.sessions.slice(-50);
  if(wasEmpty && inc.settings) Object.assign(profile.settings, inc.settings);
  profile.backup = { ts:Date.now(), changes:0 };
  saveDB();
  $("optShuffle").checked = profile.settings.shuffle; $("optPinyin").checked = profile.settings.pinyin;
  return changed;
}

/* Accepts a progress link, a bare code, or the contents of a downloaded backup file. */
async function loadFromText(text){
  text = String(text||"").trim();
  if(!text) throw new Error("paste a progress link or code first.");
  if(text[0]==="{"){
    const d = JSON.parse(text);
    if(d.format!=="hanzi-drill-progress" || !d.data) throw new Error("that isn't a Hanzi Drill backup file.");
    return mergeProgress(mergeState(d.data));
  }
  const m = text.match(/[#&?]p=([A-Za-z0-9_-]+)/) || text.match(/^([01][A-Za-z0-9_-]+)$/);
  if(!m) throw new Error("that doesn't look like a progress link or code.");
  return mergeProgress(await decodeProgress(m[1]));
}
const loadedMsg = n => n ? `✓ Progress loaded: ${n} word${n===1?"":"s"} updated.` : "✓ Loaded. This browser already had everything in it.";

function downloadBackup(){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ format:"hanzi-drill-progress", version:2, exported:new Date().toISOString(), data:profile }, null, 1)], {type:"application/json"}));
  a.download = `hanzi-drill-progress-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  markBackedUp();
}
function markBackedUp(){ profile.backup = { ts:Date.now(), changes:0 }; saveDB(); renderBackupNote(); }

/* Copy the progress link. Falls back to showing it selected if the clipboard is blocked. */
async function copyProgressLink(msgEl){
  const link = progressLink(await encodeProgress());
  try{ await navigator.clipboard.writeText(link); markBackedUp();
    if(msgEl){ msgEl.className = "dmsg ok"; msgEl.textContent = "✓ Link copied. Paste it somewhere safe: your notes, or an email to yourself."; }
    return true;
  }catch(e){
    openSync(); const box = $("dLink"); box.value = link; box.hidden = false; box.select();
    $("dMsg").className = "dmsg"; $("dMsg").textContent = "Copy the selected link above (Ctrl/Cmd + C).";
    markBackedUp(); return false;
  }
}

const CLOUD_LABEL = { off:"☁️ Sync", signedout:"☁️ Sign in to sync", syncing:"☁️ Syncing…", synced:"☁️ Synced", offline:"☁️ Offline", error:"☁️ Sync problem" };
/* Cloud section at the top of the Save / load panel. */
function renderCloudBox(){
  const box = $("cloudBox"); if(!box) return;
  if(typeof Cloud==="undefined" || !Cloud.enabled()){ box.hidden = true; return; }
  box.hidden = false;
  const u = Cloud.user(), st = Cloud.status();
  if(!u){
    box.innerHTML = `<h3>Sync across devices</h3>
      <p class="sub" style="margin-top:0">Sign in with Google and your progress saves to the cloud automatically. Sign in on any device to pick up where you left off. No links needed.</p>
      <button class="primary" id="cSignIn" ${st==="off"||st==="error"?"disabled":""}>Sign in with Google</button>
      ${st==="error" ? `<p class="sub" style="color:var(--bad)">Cloud sync couldn't start. Check your connection and reload.</p>` : ""}`;
    $("cSignIn").onclick = () => Cloud.signIn();
  } else {
    const note = { syncing:"Syncing…", synced:"✓ Up to date. Progress syncs automatically.", offline:"Offline. Will sync when you're back online.", error:"Last sync failed. It'll retry on your next answer." }[st] || "";
    box.innerHTML = `<h3>Sync across devices</h3>
      <p style="margin:0 0 6px">Signed in as <b>${esc(u.displayName || u.email || "you")}</b>${u.email && u.displayName ? ` <span class="sub">(${esc(u.email)})</span>` : ""}</p>
      <p class="sub" style="margin:0 0 8px">${note}</p>
      <div class="row"><button id="cSync">Sync now</button><button id="cSignOut">Sign out</button></div>`;
    $("cSync").onclick = () => Cloud.syncNow();
    $("cSignOut").onclick = () => Cloud.signOut();
  }
}
function openSync(){
  renderCloudBox();
  const d = $("syncDlg"); $("dMsg").textContent = ""; $("dLink").hidden = true; $("dPaste").value = "";
  $("dShare").hidden = !navigator.share;
  if(!d.open) d.showModal();
}
async function syncLoad(text){
  try{ const n = await loadFromText(text); $("dMsg").className = "dmsg ok"; $("dMsg").textContent = loadedMsg(n); $("dPaste").value = ""; renderHome(); }
  catch(e){ $("dMsg").className = "dmsg bad"; $("dMsg").textContent = "Couldn't load: " + e.message; }
}
function wireSync(){
  $("dCopy").onclick = () => copyProgressLink($("dMsg"));
  $("dShare").onclick = async () => { try{ await navigator.share({ title:"My Hanzi Drill progress", url:progressLink(await encodeProgress()) }); markBackedUp(); }catch(e){} };
  $("dFile").onclick = downloadBackup;
  $("dLoad").onclick = () => syncLoad($("dPaste").value);
  $("dFileIn").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if(f) syncLoad(await f.text()); };
  $("dClose").onclick = () => $("syncDlg").close();
  // Drop a backup file anywhere on the page to load it
  document.addEventListener("dragover", e => { if([...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", async e => { const f = e.dataTransfer.files[0]; if(!f) return; e.preventDefault(); openSync(); syncLoad(await f.text()); });
}

/* Opening a progress link loads it, then tidies the address bar. */
async function loadFromHash(){
  const m = location.hash.match(/^#p=([A-Za-z0-9_-]+)/);
  if(!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  try{ flash(loadedMsg(mergeProgress(await decodeProgress(m[1]))), "ok"); }
  catch(e){ flash("Couldn't load progress from that link: " + e.message, "bad"); }
  renderHome();
}
function flash(msg, kind){ const f = $("flash"); f.className = "flash " + (kind||""); f.textContent = msg; f.hidden = false; }

/* Home reminder: how much progress hasn't been saved to a link yet. */
function renderBackupNote(){
  const el = $("backupNote"); if(!el) return;
  const b = profile.backup || {}, any = ["progress","pinyin","translate"].some(k => Object.keys(profile[k]).length);
  if(!any || (b.ts && !b.changes) || (typeof Cloud!=="undefined" && Cloud.user())){ el.hidden = true; return; }
  el.hidden = false;
  el.querySelector("span").textContent = b.ts
    ? `${b.changes} answer${b.changes===1?"":"s"} since you last saved a progress link.`
    : "Your progress is only saved in this browser. Save a link so you can't lose it.";
}
function resetProgress(){
  if(!confirm("Erase all saved progress in this browser? This can't be undone (Export first if you want a backup).")) return;
  const keep = profile.settings; profile = freshState(); profile.settings = keep; saveDB(); renderHome();
}

/* ---------------- Home: lists, sections, progress ---------------- */
function renderHome(){
  syncPracticeUI();
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
  updateDeckInfo(); renderProgress(); renderBackupNote(); show("screenHome");
}
const isPinyinPractice = () => profile.settings.practice === "pinyin";
const isTranslatePractice = () => profile.settings.practice === "translate";
const progMap = () => isTranslatePractice() ? profile.translate : isPinyinPractice() ? profile.pinyin : profile.progress;   // each practice type is tracked separately
const stat = w => (progMap()[w] || null);
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
  if(isTranslatePractice()){
    const n = translateItems().length, fromBank = curList && typeof SENTENCES!=="undefined" && /\bL(\d+)/i.test(curList.name) && SENTENCES["L"+curList.name.match(/\bL(\d+)/i)[1]];
    $("deckInfo").textContent = !curList ? "No vocab list found." : !sentencesFor(curList).length ? "No sentences for this list yet." : `${n} sentence${n===1?"":"s"} in this drill` + (fromBank ? "" : " (from the list's example phrases)");
    $("start").disabled = n===0; return;
  }
  const items = selectedItems(), mode = $("optMode").value, nNew = items.filter(isNew).length;
  const n = mode==="learn" ? nNew : items.length, writing = !isPinyinPractice();
  let msg = "No vocab list found.";
  if(curList){
    msg = writing ? (mode==="learn" ? `${nNew} new word${nNew===1?"":"s"}` : `${n} word${n===1?"":"s"} in this drill` + (nNew ? ` · ${nNew} not practiced yet` : "")) + " · press 📖 Learn on any word you don't know yet"
        : mode==="learn" ? `${nNew} new word${nNew===1?"":"s"} to learn, in batches of ${BATCH}`
        : `${n} word${n===1?"":"s"} in this drill` + (nNew ? ` · ${nNew} new (taught first, step by step)` : "");
  }
  $("deckInfo").textContent = msg;
  $("start").disabled = n===0;
}
function renderProgress(){
  const P = $("progressPanel");
  if(!curList){ P.innerHTML = `<h2 class="sec">Progress</h2><div class="sub">No list yet.</div>`; return; }
  const uniq = isTranslatePractice() ? sentencesFor(curList) : [...new Map(curList.items.map(i=>[i.word,i])).values()];
  let mastered=0, practiced=0, att=0, clean=0;
  uniq.forEach(i => { const s = stat(i.word); if(s){ practiced++; att += s.seen; clean += s.clean; if(s.streak>=MASTER_STREAK) mastered++; } });
  const acc = att ? Math.round(clean/att*100) : 0;
  const chips = uniq.map(i => {
    const s = stat(i.word); let c = "";
    if(s) c = s.streak>=MASTER_STREAK ? "m" : (s.last==="failed" ? "f" : s.last==="hinted" ? "h" : "");
    const what = i.pinyin!==undefined ? `${i.pinyin} — ${i.english}` : i.english;
    const tip = s ? `${what} · ${s.clean}/${s.seen} clean` : `${what} · not practiced`;
    const label = [...i.word].length>9 ? [...i.word].slice(0,8).join("")+"…" : i.word;
    return `<span class="w ${c}" title="${esc(tip)}">${esc(label)}</span>`;
  }).join("");
  const recent = (profile.sessions||[]).slice(-3).reverse().map(s =>
    `<div class="note">${new Date(s.ts).toLocaleDateString()} · ${esc(s.list)}${s.type==="pinyin"?" (pinyin)":s.type==="translate"?" (translate)":""}: ${s.clean} clean, ${s.hinted} with hints, ${s.failed} missed</div>`).join("");
  P.innerHTML = `<h2 class="sec">Progress — ${esc(curList.name)} · ${isTranslatePractice() ? "translation" : isPinyinPractice() ? "pinyin &amp; tones" : "writing"}</h2>
    <div class="stats"><div><b>${mastered}/${uniq.length}</b>mastered</div><div><b>${practiced}/${uniq.length}</b>practiced</div><div><b>${att?acc+"%":"–"}</b>clean on first go</div></div>
    <div class="words">${chips}</div>
    <div class="legend"><span>■ green: mastered (${MASTER_STREAK} clean in a row)</span><span>■ yellow: last time used hints</span><span>■ red: last time missed</span><span>□ not practiced / in progress</span></div>
    <div style="margin-top:10px">${recent}</div>`;
}

/* ---------------- Drill ---------------- */
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function startSession(){
  if(isTranslatePractice()){ let t = translateItems(); if($("optShuffle").checked) t = shuffle(t.slice()); if(t.length) startTranslate(t); return; }
  const items = selectedItems(), mode = $("optMode").value;
  const fresh = items.filter(isNew);
  if(!isPinyinPractice()){                                       // writing: straight to the quiz; "Learn" is optional per word
    let list = mode==="learn" ? fresh : items;
    if($("optShuffle").checked) list = shuffle(list.slice());
    if(list.length) startDrill(list.map(it => ({...it})), true);
    return;
  }
  let known = items.filter(it => !isNew(it));
  const entries = [];
  for(let i=0;i<fresh.length;i+=BATCH){                         // learn 5, then recall those 5 from a blank grid
    const b = fresh.slice(i, i+BATCH);
    b.forEach(it => entries.push({...it, phase:"learn"}));
    shuffle(b.slice()).forEach(it => entries.push({...it, phase:"recall"}));
  }
  if(mode!=="learn"){ if($("optShuffle").checked) known = shuffle(known.slice()); known.forEach(it => entries.push({...it})); }
  if(!entries.length) return;
  if(isPinyinPractice()) startPinyin(entries, true); else startDrill(entries, true);
}
function startDrill(items, keepOrder){
  audio();   // unlock audio on user gesture
  profile.settings.shuffle = $("optShuffle").checked; profile.settings.pinyin = $("optPinyin").checked; saveDB();
  deck = items.slice(); if(!keepOrder && profile.settings.shuffle) shuffle(deck);
  idx = 0; sess = { type:"write", list: curList ? curList.name : "", clean:0, hinted:0, failed:0, review:[], saved:false };
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
  $("secTag").textContent = it.learned ? "From memory, after learning · " + it.section : it.phase==="recall" ? "Recall check · " + it.section : it.section;
  $("prompt").textContent = it.english || ("Pinyin: " + it.pinyin);
  $("hint").textContent = (profile.settings.pinyin && it.english) ? it.pinyin : "";
  $("verdict").className = "verdict"; $("verdict").innerHTML = "";
  $("bNext").classList.add("hidden");
  ["bHint","bReveal","bRetry","bSkip"].forEach(id=>$(id).disabled=false);
  if(it.phase==="learn"){ learnStage = 0; enterLearnStage(); return; }
  learnStage = null; setLearnUI(false);
  $("bLearn").classList.toggle("hidden", !!it.learned || isMastered(it.word)); $("bLearn").disabled = false;
  buildBoxes(true);
}
/* Optional guided lesson for the current word: watch -> trace -> copy, then back to drawing it from memory. */
function startLearn(){
  const it = deck[idx];
  if(finished || it.phase==="learn") return;
  writers.forEach(w => { try{ w.cancelQuiz(); }catch(e){} });
  if(boxEls[charIdx]) clearOverlay(charIdx);
  it.phase = "learn"; it.learned = true; learnStage = 0;
  $("bLearn").classList.add("hidden");
  enterLearnStage();
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
      showCharacter:false, showOutline:(learnStage===1||learnStage===2), strokeColor:ink, outlineColor:"rgba(170,160,205,0.28)",
      highlightColor:"#c4b5fd", drawingColor:"#a78bfa", drawingWidth:Math.max(8,Math.round(sz/22)),
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
  if(on) $("bLearn").classList.add("hidden");
  if(!on){ $("bReplay").classList.add("hidden"); $("bRetry").classList.remove("hidden"); }
  $("stageNote").textContent = on ? "Guided practice, nothing here is scored. After the copy step you'll draw it from memory. Skip jumps straight there."
                                  : "Draw each stroke in order. You get 3 hints per word; each shows only the next stroke.";
}
function enterLearnStage(){
  const it = deck[idx]; finished = false; watchToken++;
  setLearnUI(true);
  $("secTag").textContent = `📖 Learn · step ${learnStage+1} of 3: ${STAGES[learnStage]}`;
  $("hint").textContent = it.pinyin;
  const instr = ["Watch the stroke order. Replay as often as you like.", "Trace each stroke. The highlighted stroke is next.", "Now draw it from just the faint outline."][learnStage];
  const v = $("verdict"); v.className = "verdict show info";
  v.innerHTML = `<b style="font-family:'Songti SC','Noto Serif CJK SC',serif;font-size:22px">${esc(it.word)}</b> &nbsp;${pyHTML(it)}${sayBtn(it)}${it.english?" — "+esc(it.english):""}
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
    : `<b>✓ Nicely done</b><div class="more">Now draw it from memory on a blank grid.</div>`;
  $("bNext").classList.remove("hidden"); $("bRetry").disabled = true;
  $("bNext").textContent = learnStage===1 ? "Next: Copy →" : "Now from memory →";
  $("bNext").focus({preventScroll:true});
}

function record(word, result, map = profile.progress){      // result: clean | hinted | failed
  profile.backup.changes = (profile.backup.changes||0) + 1;
  const s = map[word] || (map[word] = { seen:0, clean:0, hinted:0, failed:0, streak:0, last:null, ts:0 });
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
  } else if(it.learned){
    cls="warn"; head="✓ Correct, after learning it"; result="hinted";
    detail = "You went through Learn first, so it counts as needing review. Get it clean next time to master it.";
  } else if(st.hintsUsed>0){
    cls="warn"; head=`Correct — with ${st.hintsUsed} hint${st.hintsUsed===1?"":"s"}`; result="hinted";
    detail = "You drew every stroke right, but with help, so it counts as needing review.";
  } else {
    cls="ok"; result="clean"; head = st.mistakes===0 ? "✓ Correct — perfect!" : "✓ Correct";
    if(st.mistakes) detail = `Right character, with ${st.mistakes} wrong stroke attempt${st.mistakes===1?"":"s"} along the way.`;
  }
  if(result){ record(it.word, result); sess[result]++; if(result!=="clean") sess.review.push({it, result}); saveDB(); playSound(result); }
  setLive("");
  const ex = [`<b style="font-size:20px;font-family:'Songti SC','Noto Serif CJK SC',serif;display:inline">${esc(it.word)}</b> &nbsp;${pyHTML(it)}${sayBtn(it)}${it.english?" — "+esc(it.english):""}`];
  if(it.examples) ex.push(esc(it.examples) + (it.examplesEn ? ` <span style="color:var(--muted)">· ${esc(it.examplesEn)}</span>` : ""));
  const v = $("verdict"); v.className = "verdict show "+cls;
  v.innerHTML = `<b>${head}</b>${detail?`<div class="more">${detail}</div>`:""}<div class="more">${ex.join("<br>")}</div>`;
  updateScore(); $("pBar").style.width = ((idx+1)/deck.length*100)+"%";
  $("bNext").classList.remove("hidden"); $("bNext").textContent = idx+1>=deck.length ? "Finish" : "Next →";
  $("bNext").focus({preventScroll:true});
  ["bHint","bReveal","bRetry","bLearn"].forEach(id=>$(id).disabled=true);
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
  if(deck[idx].phase==="learn"){ deck[idx].phase = undefined; showItem(); return; }   // lesson done: back to the quiz for this word
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
  if(window.speechSynthesis) speechSynthesis.cancel();
  if(total){ profile.sessions.push({ ts:Date.now(), type:sess.type, list:sess.list, clean:sess.clean, hinted:sess.hinted, failed:sess.failed });
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
      <button id="sSave">💾 Copy progress link</button>
    </div>
    <div class="dmsg" id="sMsg"></div>`;
  show("summary");
  $("sSave").onclick = () => copyProgressLink($("sMsg"));
  if(sess.review.length){
    const r = [...new Map(sess.review.map(x => [x.it.word, {...x.it, phase:undefined, again:false, learned:false}])).values()];
    $("sRetry").onclick = () => sess.type==="pinyin" ? startPinyin(r) : sess.type==="translate" ? startTranslate(r) : startDrill(r);
  }
  $("sHome").onclick = () => renderHome();
}

/* ---------------- Tone colours and pronunciation ---------------- */
const nChars = it => [...it.word].length;
/* Pinyin coloured by tone; one syllable under each character when they line up. */
function pyHTML(it, ruby){
  const syl = it.pinyin && Pinyin.read(it.pinyin, nChars(it));
  if(!syl) return esc(it.pinyin||"");
  if(ruby && syl.length===nChars(it)){
    const chars = [...it.word];
    return `<span class="ruby" lang="zh-CN">${syl.map((s,i) => `<span class="rb"><b>${esc(chars[i])}</b><i class="t${s.t}">${esc(Pinyin.mark(s.l, s.t))}</i></span>`).join("")}</span>`;
  }
  return syl.map(s => `<span class="t${s.t}">${esc(Pinyin.mark(s.l, s.t))}</span>`).join("");
}
let zhVoice = null;
function pickVoice(){ try{ const vs = speechSynthesis.getVoices(); zhVoice = vs.find(v => /^zh[-_]CN/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null; }catch(e){} }
if(window.speechSynthesis){ pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text){
  if(!window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = "zh-CN"; if(zhVoice) u.voice = zhVoice; u.rate = 0.8;
  speechSynthesis.speak(u);
}
const sayBtn = it => window.speechSynthesis ? ` <button type="button" class="say" data-say="${esc(it.word)}" title="Hear it" aria-label="Hear ${esc(it.word)}">🔊</button>` : "";
document.addEventListener("click", e => { const b = e.target.closest(".say"); if(b) say(b.dataset.say); });

/* ---------------- Pinyin & tones drill ----------------
   New words: a study card (see it, hear it, type it once), then a recall check per batch.
   Answers: right first time = clean; right after a hint or a second try = hinted; otherwise missed.
   Missed words come back a few cards later in the same session (practice only, not scored again). */
let pst = null;
function startPinyin(items, keepOrder){
  audio();
  profile.settings.shuffle = $("optShuffle").checked; saveDB();
  deck = items.slice(); if(!keepOrder && profile.settings.shuffle) shuffle(deck);
  idx = 0; sess = { type:"pinyin", list: curList ? curList.name : "", clean:0, hinted:0, failed:0, review:[], saved:false };
  show("pstage"); showPin();
}
function showPin(){
  const it = deck[idx], study = it.phase==="learn";
  pst = { tries:0, hinted:false, done:false };
  $("qCount").textContent = `Word ${idx+1} of ${deck.length}`;
  $("qScore").textContent = `${sess.clean} clean · ${sess.hinted} hinted · ${sess.failed} missed`;
  $("qBar").style.width = (idx/deck.length*100)+"%";
  $("qTag").textContent = study ? `📖 New word · ${it.section}` : it.again ? `🔁 Again · ${it.section}` : it.phase==="recall" ? `Recall check · ${it.section}` : it.section;
  $("qWord").textContent = it.word;
  $("qEn").textContent = it.english || "";
  $("qStudy").hidden = !study;
  if(study){
    const syl = Pinyin.read(it.pinyin, nChars(it)) || [];
    $("qStudy").innerHTML = `<div class="qans">${pyHTML(it, true)}${sayBtn(it)}</div>
      <div class="sub">${syl.map(s => `<span class="t${s.t}">${esc(Pinyin.mark(s.l, s.t))}</span>: ${Pinyin.TONE_NAMES[s.t]}`).join(" · ")}</div>
      <div class="sub" style="margin-top:6px">Say it out loud, then type it below to lock it in.</div>`;
    if(profile.settings.sound) setTimeout(() => say(it.word), 250);
  }
  const inp = $("qIn"); inp.value = ""; inp.disabled = false; $("qPrev").innerHTML = "";
  $("qVerdict").className = "verdict"; $("qVerdict").innerHTML = "";
  $("qNext").classList.add("hidden");
  $("qCheck").classList.remove("hidden"); $("qCheck").disabled = false;
  $("qHint").classList.toggle("hidden", study); $("qHint").disabled = false;
  $("qReveal").classList.toggle("hidden", study); $("qReveal").disabled = false;
  inp.focus({preventScroll:true});
}
function pinPreview(){
  const it = deck[idx], p = Pinyin.preview($("qIn").value, nChars(it));
  $("qPrev").innerHTML = p ? p.map(x => `<span class="t${x.t}">${esc(x.text)}</span>`).join(" ") : "";
}
function pinAddKey(k){
  const inp = $("qIn"); if(inp.disabled) return;
  const a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a;
  const ins = k==="v" ? "ü" : k;
  inp.value = inp.value.slice(0,a) + ins + inp.value.slice(b);
  inp.focus(); inp.setSelectionRange(a+ins.length, a+ins.length); pinPreview();
}
function pinHint(){
  if(pst.done) return;
  const it = deck[idx], syl = Pinyin.read(it.pinyin, nChars(it));
  pst.hinted = true; $("qHint").disabled = true;
  const v = $("qVerdict"); v.className = "verdict show info";
  v.innerHTML = `<b>Spelling: ${syl ? syl.map(s => esc(Pinyin.mark(s.l, 0))).join(" · ") : esc(it.pinyin)}</b><div class="more">Now add the tones.</div>`;
  $("qIn").focus();
}
function pinCheck(){
  if(pst.done) return pinNext();
  const it = deck[idx], input = $("qIn").value.trim();
  if(!input){ $("qIn").focus(); return; }
  const g = Pinyin.grade(it.pinyin, input, nChars(it));
  if(it.phase==="learn"){                        // study card: just has to be typed correctly once
    if(g.ok) return pinFinish("study");
    return pinFeedback(g, "Not quite. Copy it from the card above.");
  }
  if(g.ok) return pinFinish(pst.tries || pst.hinted ? "hinted" : "clean");
  pst.tries++;
  if(pst.tries>=2) return pinFinish("failed", g);
  pinFeedback(g, "Not quite. One more try.");
}
/* Say which syllables are wrong (spelling or tone) without giving the answer away. */
function pinFeedback(g, head){
  const it = deck[idx], chars = [...it.word];
  let lines;
  if(!g.got) lines = [`That doesn't split into ${g.want ? g.want.length : chars.length} syllable${chars.length===1?"":"s"}. Check the spelling.`];
  else lines = g.syl.map((s,i) => {
    const ch = chars.length===g.syl.length ? chars[i] : `syllable ${i+1}`;
    if(s.letters && s.tone) return `✓ ${esc(ch)}`;
    if(s.letters) return `✗ ${esc(ch)}: right sound, wrong tone (you wrote ${Pinyin.TONE_NAMES[s.got.t]})`;
    return `✗ ${esc(ch)}: check the spelling`;
  });
  playSound("failed");
  const v = $("qVerdict"); v.className = "verdict show warn";
  v.innerHTML = `<b>${head}</b><div class="more">${lines.join("<br>")}</div>`;
  $("qIn").focus(); $("qIn").select();
}
function pinFinish(result, g){
  const it = deck[idx]; pst.done = true;
  $("qIn").disabled = true; $("qHint").disabled = true; $("qReveal").disabled = true;
  $("qCheck").classList.add("hidden");
  const scored = result!=="study" && !it.again;
  if(scored){ record(it.word, result, profile.pinyin); sess[result]++; if(result!=="clean") sess.review.push({it, result}); saveDB(); }
  if(result!=="study") playSound(result);
  if((result==="failed" || result==="hinted") && (it.again||0) < 2){   // bring it back a few cards later
    deck.splice(Math.min(deck.length, idx+4), 0, {...it, phase:undefined, again:(it.again||0)+1});
  }
  const cls = { clean:"ok", study:"ok", hinted:"warn", failed:"bad" }[result];
  const head = { clean:"✓ Correct!", study:"✓ Got it", hinted:"Correct, with help", failed:"✗ Not quite. Here's the answer" }[result];
  let wrong = "";
  if(g && g.got) wrong = g.syl.filter(s => s.letters && !s.tone).map(s => `${esc(Pinyin.mark(s.want.l, s.want.t))} is ${Pinyin.TONE_NAMES[s.want.t]}`).join("<br>");
  const v = $("qVerdict"); v.className = "verdict show " + cls;
  v.innerHTML = `<b>${head}</b><div class="more qans">${pyHTML(it, true)}${sayBtn(it)}</div>
    ${wrong ? `<div class="more">${wrong}</div>` : ""}
    ${it.examples && result!=="study" ? `<div class="more" style="color:var(--muted)">${esc(it.examples)}${it.examplesEn ? " · "+esc(it.examplesEn) : ""}</div>` : ""}`;
  if(profile.settings.sound && result!=="study") setTimeout(() => say(it.word), 450);
  $("qScore").textContent = `${sess.clean} clean · ${sess.hinted} hinted · ${sess.failed} missed`;
  $("qBar").style.width = ((idx+1)/deck.length*100)+"%";
  $("qNext").classList.remove("hidden"); $("qNext").textContent = idx+1>=deck.length ? "Finish" : "Next →";
  $("qNext").focus({preventScroll:true});
}
function pinNext(){ idx++; if(idx>=deck.length) return endSession(false); showPin(); }
function pinSkip(){
  const it = deck[idx];
  if(pst.done || it.phase==="learn") return pinNext();
  pinFinish("failed");
}
function wirePinyin(){
  $("qForm").onsubmit = e => { e.preventDefault(); pinCheck(); };
  $("qIn").oninput = pinPreview;
  document.querySelectorAll(".tones button").forEach(b => b.onclick = () => pinAddKey(b.dataset.k));
  $("qCheck").onclick = pinCheck; $("qHint").onclick = pinHint; $("qReveal").onclick = () => { if(!pst.done) pinFinish("failed"); };
  $("qSkip").onclick = pinSkip; $("qNext").onclick = pinNext;
  $("qQuit").onclick = () => endSession(false);
}

/* ---------------- Translate drill ----------------
   Sentences come from sentences.js (by lesson number in the list name, e.g. "L3 ..."), or else
   from the list's example phrases where the Chinese and English line up one to one. */
function sentencesFor(list){
  if(!list) return [];
  const m = list.name.match(/\bL(\d+)/i), bank = m && typeof SENTENCES!=="undefined" && SENTENCES["L"+m[1]];
  if(bank) return bank.map(([section, zh, en, enAlt=[], zhAlt=[]]) => ({ word:zh, english:en, enAlt, zhAlt, section }));
  const out = [], seen = new Set();
  for(const it of list.items){
    if(!it.examples || !it.examplesEn) continue;
    const zs = it.examples.split(/[，,]/).map(s=>s.trim()).filter(Boolean), es = it.examplesEn.split(/[，,]/).map(s=>s.trim()).filter(Boolean);
    if(zs.length!==es.length) continue;
    zs.forEach((z, i) => {
      const zh = z.replace(/[（(]([^）)]*)[）)]/g, "$1"), alt = z.replace(/[（(][^）)]*[）)]/g, "");   // 我（的）家 → 我的家 or 我家
      if(CJK.test(zh) && !seen.has(zh)){ seen.add(zh); out.push({ word:zh, english:es[i], enAlt:[], zhAlt: alt!==zh ? [alt] : [], section:it.section }); }
    });
  }
  return out;
}
function translateItems(){
  const mode = $("optMode").value, seen = new Set();
  return sentencesFor(curList).filter(s => {
    if(seen.has(s.word) || !activeSections.has(s.section)) return false;
    seen.add(s.word);
    return mode==="weak" ? !isMastered(s.word) : mode==="learn" ? isNew(s) : true;
  });
}

/* Lenient comparison: ignore punctuation, spacing, case, articles and common contractions. */
const normZh = s => String(s).normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const NUMS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"];
const SYN = { mum:"mom", mother:"mom", father:"dad", ok:"okay", picture:"photo", photograph:"photo", film:"movie", kids:"children", kid:"child",
  practise:"practice", glad:"happy", lesson:"class", journalist:"reporter", thirty:"30", "15":"fifteen" };
function normEn(s){
  let t = String(s).toLowerCase().replace(/[’‘]/g, "'");
  [[/\bcan't\b/g,"can not"],[/\bwon't\b/g,"will not"],[/n't\b/g," not"],[/\blet's\b/g,"let us"],[/'re\b/g," are"],[/'m\b/g," am"],
   [/'ll\b/g," will"],[/'ve\b/g," have"],[/'d\b/g," would"],[/\b(it|that|what|he|she|there|who|where|how)'s\b/g,"$1 is"]].forEach(([a,b]) => { t = t.replace(a, b); });
  return t.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
    .map(w => /^\d+$/.test(w) && +w<=12 ? NUMS[+w] : w).map(w => SYN[w] || w)
    .filter(w => !["a","an","the"].includes(w)).join(" ");
}
/* Token diff (longest common subsequence): marks what's extra in yours and missing from yours. */
function diffTokens(a, b){
  const n = a.length, m = b.length, L = Array.from({length:n+1}, () => new Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) L[i][j] = a[i]===b[j] ? L[i+1][j+1]+1 : Math.max(L[i+1][j], L[i][j+1]);
  const inA = new Array(n).fill(false), inB = new Array(m).fill(false);
  for(let i=0,j=0; i<n && j<m;){ if(a[i]===b[j]){ inA[i]=inB[j]=true; i++; j++; } else if(L[i+1][j]>=L[i][j+1]) i++; else j++; }
  return { inA, inB, score: (2*L[0][0]) / ((n+m)||1) };
}
function keyWords(zh){                    // vocab words found in the sentence, longest match first
  const dict = new Map();
  [curList, ...allLists()].filter(Boolean).forEach(l => l.items.forEach(it => { if(!dict.has(it.word)) dict.set(it.word, it); }));
  const out = [], seen = new Set(), chars = [...zh];
  for(let i=0; i<chars.length;){
    let hit = null;
    for(let len=Math.min(5, chars.length-i); len>=1 && !hit; len--){ const w = chars.slice(i, i+len).join(""); if(dict.has(w)) hit = dict.get(w); }
    if(hit){ if(!seen.has(hit.word)){ seen.add(hit.word); out.push(hit); } i += [...hit.word].length; } else i++;
  }
  return out;
}

let tst = null;
function startTranslate(items){
  audio();
  const dir = profile.settings.tdir || "mix";
  deck = items.map(it => ({ ...it, dir: dir==="mix" ? (Math.random()<0.5 ? "en2zh" : "zh2en") : dir }));
  idx = 0; sess = { type:"translate", list: curList ? curList.name : "", clean:0, hinted:0, failed:0, review:[], saved:false };
  show("tstage"); showTrans();
}
function showTrans(){
  const it = deck[idx], toZh = it.dir==="en2zh";
  tst = { hinted:false, done:false, judging:false };
  $("tCount").textContent = `Sentence ${idx+1} of ${deck.length}`;
  $("tScore").textContent = `${sess.clean} right · ${sess.hinted} with help · ${sess.failed} missed`;
  $("tBar").style.width = (idx/deck.length*100)+"%";
  $("tTag").textContent = (it.again ? "🔁 Again · " : "") + it.section;
  $("tDir").textContent = toZh ? "Translate into Chinese" : "Translate into English";
  $("tPrompt").className = "tprompt" + (toZh ? "" : " zh");
  $("tPrompt").innerHTML = toZh ? esc(it.english) : `<span lang="zh-CN">${esc(it.word)}</span>${sayBtn(it)}`;
  const inp = $("tIn"); inp.value = ""; inp.disabled = false;
  inp.lang = toZh ? "zh-CN" : "en"; inp.placeholder = toZh ? "用中文写… (type in Chinese)" : "Type the English…";
  $("tVerdict").className = "verdict"; $("tVerdict").innerHTML = "";
  ["tCheck","tHint","tReveal"].forEach(id => { $(id).classList.remove("hidden"); $(id).disabled = false; });
  ["tRight","tWrong","tNext"].forEach(id => $(id).classList.add("hidden"));
  inp.focus({preventScroll:true});
}
function transHint(){
  if(tst.done || tst.judging) return;
  const it = deck[idx], toZh = it.dir==="en2zh", kws = keyWords(it.word);
  tst.hinted = true; $("tHint").disabled = true;
  const v = $("tVerdict"); v.className = "verdict show info";
  v.innerHTML = `<b>Key words</b><div class="more kw">${kws.length ? kws.map(k => toZh
      ? `<span><span lang="zh-CN" class="han">${esc(k.word)}</span> ${pyHTML(k)} · ${esc(k.english||"")}</span>`
      : `<span><span lang="zh-CN" class="han">${esc(k.word)}</span> · ${esc(k.english||"")}</span>`).join("") : "No list words found in this one."}</div>`;
  $("tIn").focus();
}
function transCheck(){
  if(tst.done) return transNext();
  if(tst.judging) return;
  const it = deck[idx], toZh = it.dir==="en2zh", input = $("tIn").value.trim();
  if(!input){ $("tIn").focus(); return; }
  const answers = toZh ? [it.word, ...(it.zhAlt||[])] : [it.english, ...(it.enAlt||[])];
  const norm = toZh ? normZh : normEn, mine = norm(input);
  if(answers.some(a => norm(a)===mine)) return transFinish(tst.hinted ? "hinted" : "clean");
  // Not an exact match: show the differences and let the learner judge
  const tok = s => toZh ? [...norm(s)] : norm(s).split(" ");
  let best = null;
  for(const a of answers){ const d = diffTokens(tok(input), tok(a)); if(!best || d.score > best.d.score) best = { a, d }; }
  const mineT = tok(input), ansT = tok(best.a), sep = toZh ? "" : " ";
  const youHTML = mineT.map((t,i) => best.d.inA[i] ? esc(t) : `<span class="dx">${esc(t)}</span>`).join(sep);
  const ansHTML = ansT.map((t,i) => best.d.inB[i] ? esc(t) : `<span class="dm">${esc(t)}</span>`).join(sep);
  tst.judging = true; $("tIn").disabled = true;
  ["tCheck","tHint","tReveal"].forEach(id => $(id).classList.add("hidden"));
  ["tRight","tWrong"].forEach(id => $(id).classList.remove("hidden"));
  const v = $("tVerdict"); v.className = "verdict show info";
  v.innerHTML = `<b>${best.d.score>=0.8 ? "Close! Compare with the answer" : "Compare with the answer"}</b>
    <div class="more cmp"><div><small>Yours</small><span ${toZh?'lang="zh-CN"':""}>${youHTML || "–"}</span></div>
    <div><small>Answer</small><span ${toZh?'lang="zh-CN"':""}>${ansHTML}</span></div></div>
    <div class="more" style="color:var(--muted)">Red = not in the answer · purple = missing from yours. Does yours mean the same thing?</div>`;
  $("tRight").focus({preventScroll:true});
}
function transFinish(result){
  const it = deck[idx], toZh = it.dir==="en2zh"; tst.done = true; tst.judging = false;
  $("tIn").disabled = true;
  ["tCheck","tHint","tReveal","tRight","tWrong"].forEach(id => $(id).classList.add("hidden"));
  if(!it.again){ record(it.word, result, profile.translate); sess[result]++; if(result!=="clean") sess.review.push({it, result}); saveDB(); }
  playSound(result);
  if((result==="failed" || result==="hinted") && (it.again||0) < 2) deck.splice(Math.min(deck.length, idx+4), 0, { ...it, again:(it.again||0)+1 });
  const alts = toZh ? (it.zhAlt||[]) : (it.enAlt||[]).slice(0, 3);
  const v = $("tVerdict"); v.className = "verdict show " + ({ clean:"ok", hinted:"warn", failed:"bad" }[result]);
  v.innerHTML = `<b>${{ clean:"✓ Correct!", hinted:"✓ Right, with help", failed:"✗ Here's the answer" }[result]}</b>
    <div class="more tans"><span lang="zh-CN" class="han">${esc(it.word)}</span>${sayBtn(it)}</div>
    <div class="more">${esc(it.english)}</div>
    ${alts.length ? `<div class="more" style="color:var(--muted)">Also fine: ${alts.map(esc).join(" · ")}</div>` : ""}`;
  if(profile.settings.sound && toZh) setTimeout(() => say(it.word), 450);
  $("tScore").textContent = `${sess.clean} right · ${sess.hinted} with help · ${sess.failed} missed`;
  $("tBar").style.width = ((idx+1)/deck.length*100)+"%";
  $("tNext").classList.remove("hidden"); $("tNext").textContent = idx+1>=deck.length ? "Finish" : "Next →";
  $("tNext").focus({preventScroll:true});
}
function transNext(){ idx++; if(idx>=deck.length) return endSession(false); showTrans(); }
function wireTranslate(){
  $("tForm").onsubmit = e => { e.preventDefault(); transCheck(); };
  $("tIn").addEventListener("keydown", e => { if(e.key==="Enter" && !e.shiftKey && !e.isComposing && e.keyCode!==229){ e.preventDefault(); transCheck(); } });
  $("tCheck").onclick = transCheck; $("tHint").onclick = transHint;
  $("tReveal").onclick = () => { if(!tst.done) transFinish("failed"); };
  $("tRight").onclick = () => transFinish(tst.hinted ? "hinted" : "clean");
  $("tWrong").onclick = () => transFinish("failed");
  $("tSkip").onclick = () => { if(tst.done) transNext(); else transFinish("failed"); };
  $("tNext").onclick = transNext; $("tQuit").onclick = () => endSession(false);
}

/* ---------------- Wire up ---------------- */
wirePinyin(); wireTranslate();
const PRACTICE_DESC = { write:"Draw each character stroke by stroke from its English meaning.",
  pinyin:"See the character and type its full pinyin, tones included.",
  translate:"Translate sentences built from this list's words, English ↔ Chinese." };
document.querySelectorAll("#optPractice button").forEach(b => b.onclick = () => { profile.settings.practice = b.dataset.v; saveDB(); renderHome(); });
$("optDir").onchange = () => { profile.settings.tdir = $("optDir").value; saveDB(); };
function syncPracticeUI(){
  const p = profile.settings.practice || "write", t = p==="translate";
  document.querySelectorAll("#optPractice button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.v===p)));
  $("practiceDesc").textContent = PRACTICE_DESC[p] || "";
  $("optPinyinLbl").hidden = p!=="write"; $("optDir").hidden = !t; $("optDir").value = profile.settings.tdir || "mix";
  const o = $("optMode").options;
  o[0].text = t ? "All sentences" : p==="write" ? "All words" : "All words (new ones taught first)";
  o[1].text = t ? "Sentences I haven't mastered" : "Words I haven't mastered";
  o[2].text = t ? "New sentences only" : p==="write" ? "Words I haven't practiced yet" : "Learn new words only";
}
syncPracticeUI();
$("listSel").onchange = e => { curList = allLists().find(l=>l.id===e.target.value); profile.settings.lastList = curList.id; saveDB(); renderHome(); };
$("optMode").onchange = updateDeckInfo;
$("optShuffle").onchange = () => { profile.settings.shuffle = $("optShuffle").checked; saveDB(); };
$("optPinyin").onchange = () => { profile.settings.pinyin = $("optPinyin").checked; saveDB();
  if(sess && !$("stage").classList.contains("hidden") && deck[idx]) $("hint").textContent = profile.settings.pinyin ? deck[idx].pinyin : ""; };
$("start").onclick = startSession;
$("bHint").onclick = useHint; $("bLearn").onclick = startLearn; $("bReveal").onclick = reveal; $("bRetry").onclick = redraw;
$("bReplay").onclick = () => { if(learnStage===0) playWatch(); }; $("bSkip").onclick = skip; $("bNext").onclick = next; $("bQuit").onclick = () => endSession(false);
document.addEventListener("keydown", e => { if(e.key==="Enter" && !$("stage").classList.contains("hidden") && !$("bNext").classList.contains("hidden") && document.activeElement.tagName!=="BUTTON" && document.activeElement.tagName!=="INPUT") next(); });

$("resetBtn").onclick = resetProgress;
$("bnCopy").onclick = () => copyProgressLink(null).then(ok => { if(ok) flash("✓ Progress link copied. Paste it somewhere safe: your notes, or an email to yourself.", "ok"); });
$("flash").onclick = () => { $("flash").hidden = true; };
wireSync();
try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}   // ask the browser not to clear our data
$("optShuffle").checked = profile.settings.shuffle; $("optPinyin").checked = profile.settings.pinyin;
renderHome();                                   // shows the page immediately; lists fill in once loaded
loadFromHash();
if(typeof Cloud!=="undefined") Cloud.init();
loadSharedLists().then(() => { if(!$("screenHome").classList.contains("hidden")) renderHome(); });
