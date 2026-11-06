"use strict";
/* Shared basics: storage, vocab parsing, sound, app state, screens, progress packing, cloud panel. */
const $ = id => document.getElementById(id);
const CJK = /[㐀-鿿]/;
const STORE_KEY = "hanziDrill.v2";
const HINTS_PER_WORD = 3;
const MASTER_STREAK = 2;           // clean results in a row to count a word as "mastered"

/* ---------------- Storage (this browser only) ---------------- */
const OLD_KEY = "hanziDrill.v1";          // earlier multi-profile version
function freshState(){ return { settings:{ sound:true, shuffle:true, pinyin:false, lastList:null, practice:"write" }, progress:{}, pinyin:{}, translate:{}, listen:{}, sessions:[], backup:{ ts:0, changes:0 }, resetAt:0 }; }
function mergeState(src){
  const st = freshState();
  if(src && typeof src==="object"){
    Object.assign(st.settings, src.settings||{});
    st.progress = src.progress || {}; st.pinyin = src.pinyin || {}; st.translate = src.translate || {}; st.listen = src.listen || {}; st.sessions = src.sessions || [];
    Object.assign(st.backup, src.backup||{}); st.resetAt = src.resetAt || 0;
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
const STAGES = ["Watch","Trace","Copy"];
const charData = {};         // cache of hanzi-writer char data

/* ---------------- Screens ---------------- */
function show(which){
  stopSpeech();
  ["screenHome","stage","pstage","tstage","summary"].forEach(id => $(id).classList.toggle("hidden", id!==which));
  renderUserBar();
}
function renderUserBar(){
  $("userBar").innerHTML = `<button id="ubSound" aria-pressed="${profile.settings.sound}">${profile.settings.sound?"🔔 Sound on":"🔕 Sound off"}</button>
    ${typeof Cloud!=="undefined" && Cloud.enabled() ? `<button id="ubCloud" class="cloud ${Cloud.status()}" title="Sync progress across devices">${CLOUD_LABEL[Cloud.status()]||"☁️ Sync"}</button>` : ""}`;
  if($("ubCloud")) $("ubCloud").onclick = openSync;
  $("ubSound").onclick = () => { profile.settings.sound = !profile.settings.sound; saveDB(); renderUserBar(); if(profile.settings.sound) playSound("clean"); };
}

/* ---------------- Progress packing (used by cloud sync) ----------------
   Progress is packed into a short compressed code. Merging keeps the newest result per word. */
const LASTS = [null, "clean", "hinted", "failed"];
const PROGRESS_KEYS = ["progress","pinyin","translate","listen"];
const SESSION_TYPES = ["write","pinyin","translate","listen"];
/* Where each practice type keeps its progress. */
const mapFor = type => ({ write:profile.progress, pinyin:profile.pinyin, translate:profile.translate, listen:profile.listen })[type] || profile.progress;
const packStats = m => Object.fromEntries(Object.entries(m||{}).map(([w,s]) =>         // times stored in whole seconds, rounded down
  [w, [s.seen, s.clean, s.failed, s.streak, Math.max(0, LASTS.indexOf(s.last)), Math.floor((s.ts||0)/1000)]]));
const unpackStats = (m, unit = 1000) => Object.fromEntries(Object.entries(m||{}).map(([w,a]) =>
  [w, { seen:a[0], clean:a[1], hinted:Math.max(0, a[0]-a[1]-a[2]), failed:a[2], streak:a[3], last:LASTS[a[4]]||null, ts:a[5]*unit }]));
function b64url(bytes){ let s = ""; for(let i=0;i<bytes.length;i+=8192) s += String.fromCharCode(...bytes.subarray(i, i+8192)); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function unb64url(str){ const bin = atob(str.replace(/-/g,"+").replace(/_/g,"/")); const a = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i] = bin.charCodeAt(i); return a; }
async function pipeBytes(bytes, stream){ return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
async function encodeProgress(){
  const json = JSON.stringify({ v:3, r:profile.resetAt||0, s:profile.settings, w:packStats(profile.progress), y:packStats(profile.pinyin), z:packStats(profile.translate), l:packStats(profile.listen),
    h:(profile.sessions||[]).slice(-20).map(x => [Math.round(x.ts/6e4), x.list, x.clean, x.hinted, x.failed, Math.max(0, SESSION_TYPES.indexOf(x.type))]) });
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
  const u = (d.v||2) >= 3 ? 1000 : 6e4;                       // older codes stored minutes
  return { resetAt:d.r||0, settings:d.s||{}, progress:unpackStats(d.w, u), pinyin:unpackStats(d.y, u), translate:unpackStats(d.z, u), listen:unpackStats(d.l, u),
    sessions:(d.h||[]).map(a => ({ ts:a[0]*6e4, list:a[1], clean:a[2], hinted:a[3], failed:a[4], type:SESSION_TYPES[a[5]]||"write" })) };
}
/* Combine incoming progress with this browser's. Returns how many words changed. */
function mergeProgress(inc){
  const wasEmpty = PROGRESS_KEYS.every(k => !Object.keys(profile[k]).length);
  let changed = 0;
  const R = Math.max(profile.resetAt||0, inc.resetAt||0);      // progress from before the latest reset is dropped everywhere
  if(R > (profile.resetAt||0)){
    for(const key of PROGRESS_KEYS) for(const [w, s] of Object.entries(profile[key])) if((s.ts||0) <= R){ delete profile[key][w]; changed++; }
    profile.sessions = profile.sessions.filter(x => x.ts > R); profile.resetAt = R;
  }
  for(const key of PROGRESS_KEYS){
    for(const [w, s] of Object.entries(inc[key]||{})){
      if((s.ts||0) <= R) continue;
      const cur = profile[key][w];
      if(!cur || (s.ts||0) > (cur.ts||0)){ profile[key][w] = s; changed++; }
    }
  }
  const seen = new Set(profile.sessions.map(s => Math.round(s.ts/6e4)+"|"+s.list));
  for(const s of inc.sessions||[]) if(s.ts > R && !seen.has(Math.round(s.ts/6e4)+"|"+s.list)) profile.sessions.push(s);
  profile.sessions.sort((a,b) => a.ts-b.ts); profile.sessions = profile.sessions.slice(-50);
  if(wasEmpty && inc.settings) Object.assign(profile.settings, inc.settings);
  profile.backup = { ts:Date.now(), changes:0 };
  saveDB();
  $("optShuffle").checked = profile.settings.shuffle; $("optPinyin").checked = profile.settings.pinyin;
  return changed;
}

const CLOUD_LABEL = { off:"☁️ Sync", signedout:"☁️ Sign in to sync", syncing:"☁️ Syncing…", synced:"☁️ Synced", offline:"☁️ Offline", error:"☁️ Sync problem" };
/* Cloud sync panel (opened from the ☁️ button). */
function renderCloudBox(){
  const box = $("cloudBox"); if(!box) return;
  if(typeof Cloud==="undefined" || !Cloud.enabled()){ box.hidden = true; return; }
  box.hidden = false;
  const u = Cloud.user(), st = Cloud.status();
  if(!u){
    box.innerHTML = `<h3>Sync across devices</h3>
      <p class="sub" style="margin-top:0">Sign in with Google and your progress saves to the cloud automatically. Sign in on any device to pick up where you left off.</p>
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
  renderCloudBox(); $("dMsg").textContent = "";
  if(!$("syncDlg").open) $("syncDlg").showModal();
}

function resetProgress(){
  const cloudOn = typeof Cloud!=="undefined" && Cloud.user();
  if(!confirm(cloudOn ? "Erase all your progress, here and in the cloud (every signed-in device)? This can't be undone."
                      : "Erase all saved progress in this browser? This can't be undone.")) return;
  const keep = profile.settings; profile = freshState(); profile.settings = keep; profile.resetAt = Date.now();
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(profile)); }catch(e){}
  if(cloudOn) Cloud.overwrite();                 // replace the cloud copy too, or the next sync would bring it all back
  renderHome();
}
