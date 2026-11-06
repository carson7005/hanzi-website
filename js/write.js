"use strict";
/* Writing drill (Hanzi Writer): draw from memory, hints, optional Learn lesson (watch, trace, copy). */
function startDrill(items, keepOrder, kind){            // kind "listen": prompt is the spoken word instead of English
  audio();   // unlock audio on user gesture
  profile.settings.shuffle = $("optShuffle").checked; profile.settings.pinyin = $("optPinyin").checked; saveDB();
  deck = items.slice(); if(!keepOrder && profile.settings.shuffle) shuffle(deck);
  idx = 0; sess = { type: kind || "write", listen: kind==="listen", list: curList ? curList.name : "", clean:0, hinted:0, failed:0, review:[], saved:false };
  show("stage"); showItem();
}
function boxSize(n){
  const avail = Math.min(window.innerWidth - 80, 700);
  return Math.max(120, Math.min(260, Math.floor((avail - (n-1)*12) / n)));
}
function updateScore(){ $("pScore").textContent = `${sess.clean} clean · ${sess.hinted} hinted · ${sess.failed} missed`; }

function showItem(){
  const it = deck[idx]; finished = false; stopSpeech();
  $("pCount").textContent = `Word ${idx+1} of ${deck.length}`; updateScore();
  $("pBar").style.width = (idx/deck.length*100)+"%";
  $("secTag").textContent = it.learned ? "From memory, after learning · " + it.section : it.phase==="recall" ? "Recall check · " + it.section : it.section;
  if(sess.listen){
    $("prompt").innerHTML = `<button type="button" class="play" id="bPlay">🔊 Play again</button>`;
    $("hint").innerHTML = `Listen, then write it. <button type="button" class="linkbtn" id="bMeaning">Show meaning</button>`;
    $("bPlay").onclick = () => say(it.word);
    $("bMeaning").onclick = () => { $("hint").textContent = it.english || ""; };      // free: many words sound alike
    sayLater(it.word, 300);
  } else {
    $("prompt").textContent = it.english || ("Pinyin: " + it.pinyin);
    $("hint").textContent = (profile.settings.pinyin && it.english) ? it.pinyin : "";
  }
  $("verdict").className = "verdict"; $("verdict").innerHTML = "";
  $("bNext").classList.add("hidden");
  ["bHint","bReveal","bRetry","bSkip"].forEach(id=>$(id).disabled=false);
  if(it.phase==="learn"){ learnStage = 0; enterLearnStage(); return; }
  learnStage = null; setLearnUI(false);
  $("bLearn").classList.toggle("hidden", sess.listen || !!it.learned || isMastered(it.word)); $("bLearn").disabled = false;
  $("stageNote").textContent = sess.listen ? "Some words sound alike. Tap Show meaning if you're not sure which one it is (no penalty)."
                                           : "Draw each stroke in order. You get 3 hints per word; each shows only the next stroke.";
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
  if(result){ record(it.word, result, mapFor(sess.type)); sess[result]++; if(result!=="clean") sess.review.push({it, result}); saveDB(); playSound(result); }
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
  record(deck[idx].word, "failed", mapFor(sess.type)); sess.failed++; sess.review.push({it:deck[idx], result:"failed"}); saveDB();
  next();
}
