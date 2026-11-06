"use strict";
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
  const it = deck[idx], toZh = it.dir==="en2zh"; stopSpeech();
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
  if(profile.settings.sound && toZh) sayLater(it.word, 450);
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
