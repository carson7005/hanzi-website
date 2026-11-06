"use strict";
/* ---------------- Pinyin & tones drill ----------------
   Every word starts as a quiz. "Learn" (for words not mastered) shows a study card: pinyin, tones, audio.
   Answers: right first time = clean; right after Learn, a hint or a second try = hinted; otherwise missed.
   Missed words come back a few cards later in the same session (practice only, not scored again).
   Listen mode (kind "listen"): the word is spoken instead of shown; the character appears after answering. */
let pst = null;
function startPinyin(items, keepOrder, kind){
  audio();
  profile.settings.shuffle = $("optShuffle").checked; saveDB();
  deck = items.slice(); if(!keepOrder && profile.settings.shuffle) shuffle(deck);
  idx = 0; sess = { type: kind || "pinyin", listen: kind==="listen", list: curList ? curList.name : "", clean:0, hinted:0, failed:0, review:[], saved:false };
  show("pstage"); showPin();
}
function showPin(){
  const it = deck[idx]; stopSpeech();
  pst = { tries:0, hinted:false, done:false, learned:false };
  $("qCount").textContent = `Word ${idx+1} of ${deck.length}`;
  $("qScore").textContent = `${sess.clean} clean · ${sess.hinted} hinted · ${sess.failed} missed`;
  $("qBar").style.width = (idx/deck.length*100)+"%";
  $("qTag").textContent = (it.again ? "🔁 Again · " : "") + it.section;
  if(sess.listen){
    $("qWord").innerHTML = `<button type="button" class="play" id="qPlay">🔊 Play again</button>`;
    $("qEn").textContent = "Type the pinyin you hear, tones included.";
    $("qPlay").onclick = () => say(it.word);
    sayLater(it.word, 300);
  } else {
    $("qWord").textContent = it.word;
    $("qEn").textContent = it.english || "";
  }
  $("qStudy").hidden = true; $("qStudy").innerHTML = "";
  const inp = $("qIn"); inp.value = ""; inp.disabled = false; $("qPrev").innerHTML = "";
  $("qVerdict").className = "verdict"; $("qVerdict").innerHTML = "";
  $("qNext").classList.add("hidden");
  $("qCheck").classList.remove("hidden"); $("qCheck").disabled = false;
  $("qHint").classList.remove("hidden"); $("qHint").disabled = false;
  $("qReveal").classList.remove("hidden"); $("qReveal").disabled = false;
  $("qLearn").classList.toggle("hidden", sess.listen || isMastered(it.word)); $("qLearn").disabled = false;
  inp.focus({preventScroll:true});
}
/* Optional study card for the current word; answering after it counts as needing review. */
function pinLearn(){
  if(pst.done || pst.learned) return;
  const it = deck[idx], syl = Pinyin.read(it.pinyin, nChars(it)) || [];
  pst.learned = true; $("qLearn").classList.add("hidden"); $("qHint").disabled = true;
  $("qStudy").innerHTML = `<div class="qans">${pyHTML(it, true)}${sayBtn(it)}</div>
    <div class="sub">${syl.map(s => `<span class="t${s.t}">${esc(Pinyin.mark(s.l, s.t))}</span>: ${Pinyin.TONE_NAMES[s.t]}`).join(" · ")}</div>
    <div class="sub" style="margin-top:6px">Say it out loud, then type it below.</div>`;
  $("qStudy").hidden = false;
  if(profile.settings.sound) sayLater(it.word, 250);
  $("qIn").focus();
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
  if(g.ok) return pinFinish(pst.tries || pst.hinted || pst.learned ? "hinted" : "clean");
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
  $("qIn").disabled = true; $("qHint").disabled = true; $("qReveal").disabled = true; $("qLearn").classList.add("hidden");
  $("qCheck").classList.add("hidden");
  if(!it.again){ record(it.word, result, mapFor(sess.type)); sess[result]++; if(result!=="clean") sess.review.push({it, result}); saveDB(); }
  playSound(result);
  if((result==="failed" || result==="hinted") && (it.again||0) < 2){   // bring it back a few cards later
    deck.splice(Math.min(deck.length, idx+4), 0, {...it, again:(it.again||0)+1});
  }
  const cls = { clean:"ok", hinted:"warn", failed:"bad" }[result];
  const head = { clean:"✓ Correct!", hinted: pst.learned ? "✓ Correct, after learning it" : "Correct, with help", failed:"✗ Not quite. Here's the answer" }[result];
  let wrong = "";
  if(g && g.got) wrong = g.syl.filter(s => s.letters && !s.tone).map(s => `${esc(Pinyin.mark(s.want.l, s.want.t))} is ${Pinyin.TONE_NAMES[s.want.t]}`).join("<br>");
  const v = $("qVerdict"); v.className = "verdict show " + cls;
  v.innerHTML = `<b>${head}</b><div class="more qans">${pyHTML(it, true)}${sayBtn(it)}</div>
    ${sess.listen && it.english ? `<div class="more">${esc(it.english)}</div>` : ""}
    ${wrong ? `<div class="more">${wrong}</div>` : ""}
    ${it.examples ? `<div class="more" style="color:var(--muted)">${esc(it.examples)}${it.examplesEn ? " · "+esc(it.examplesEn) : ""}</div>` : ""}`;
  if(profile.settings.sound && !sess.listen) sayLater(it.word, 450);
  $("qScore").textContent = `${sess.clean} clean · ${sess.hinted} hinted · ${sess.failed} missed`;
  $("qBar").style.width = ((idx+1)/deck.length*100)+"%";
  $("qNext").classList.remove("hidden"); $("qNext").textContent = idx+1>=deck.length ? "Finish" : "Next →";
  $("qNext").focus({preventScroll:true});
}
function pinNext(){ idx++; if(idx>=deck.length) return endSession(false); showPin(); }
function pinSkip(){
  if(pst.done) return pinNext();
  pinFinish("failed");
}
function wirePinyin(){
  $("qForm").onsubmit = e => { e.preventDefault(); pinCheck(); };
  $("qIn").oninput = pinPreview;
  document.querySelectorAll(".tones button").forEach(b => b.onclick = () => pinAddKey(b.dataset.k));
  $("qCheck").onclick = pinCheck; $("qHint").onclick = pinHint; $("qReveal").onclick = () => { if(!pst.done) pinFinish("failed"); };
  $("qSkip").onclick = pinSkip; $("qLearn").onclick = pinLearn; $("qNext").onclick = pinNext;
  $("qQuit").onclick = () => endSession(false);
}
