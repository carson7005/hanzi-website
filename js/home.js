"use strict";
/* Home screen: list picker, sections, progress panel. */
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
  updateDeckInfo(); renderProgress(); show("screenHome");
}
const isPinyinPractice = () => profile.settings.practice === "pinyin";
const isTranslatePractice = () => profile.settings.practice === "translate";
const isListenPractice = () => profile.settings.practice === "listen";
const progMap = () => mapFor(profile.settings.practice || "write");   // each practice type is tracked separately
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
  const n = mode==="learn" ? nNew : items.length;
  let msg = "No vocab list found.";
  if(curList){
    msg = (mode==="learn" ? `${nNew} word${nNew===1?"":"s"} not practiced yet` : `${n} word${n===1?"":"s"} in this drill` + (nNew ? ` · ${nNew} not practiced yet` : ""))
        + (isListenPractice() ? "" : " · press 📖 Learn on any word you don't know yet");
    if(isListenPractice() && !window.speechSynthesis) msg = "This browser can't play speech, so Listen mode won't work here.";
  }
  $("deckInfo").textContent = msg;
  $("start").disabled = n===0 || (isListenPractice() && !window.speechSynthesis);
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
    `<div class="note">${new Date(s.ts).toLocaleDateString()} · ${esc(s.list)}${s.type && s.type!=="write" ? ` (${s.type})` : ""}: ${s.clean} clean, ${s.hinted} with hints, ${s.failed} missed</div>`).join("");
  P.innerHTML = `<h2 class="sec">Progress — ${esc(curList.name)} · ${({ translate:"translation", pinyin:"pinyin &amp; tones", listen:"listening", write:"writing" })[profile.settings.practice] || "writing"}</h2>
    <div class="stats"><div><b>${mastered}/${uniq.length}</b>mastered</div><div><b>${practiced}/${uniq.length}</b>practiced</div><div><b>${att?acc+"%":"–"}</b>clean on first go</div></div>
    <div class="words">${chips}</div>
    <div class="legend"><span>■ green: mastered (${MASTER_STREAK} clean in a row)</span><span>■ yellow: last time used hints</span><span>■ red: last time missed</span><span>□ not practiced / in progress</span></div>
    <div style="margin-top:10px">${recent}</div>`;
}
