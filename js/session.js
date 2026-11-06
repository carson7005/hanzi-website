"use strict";
/* Starting, scoring and ending a practice round (shared by all practice types). */
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function startSession(){
  if(isTranslatePractice()){ let t = translateItems(); if($("optShuffle").checked) t = shuffle(t.slice()); if(t.length) startTranslate(t); return; }
  const items = selectedItems(), mode = $("optMode").value;
  let list = mode==="learn" ? items.filter(isNew) : items;       // every word starts as a quiz; "Learn" is optional per word
  if($("optShuffle").checked) list = shuffle(list.slice());
  if(!list.length) return;
  list = list.map(it => ({...it}));
  const p = profile.settings.practice;
  if(p==="pinyin") startPinyin(list, true);
  else if(p==="listen") profile.settings.lans==="write" ? startDrill(list, true, "listen") : startPinyin(list, true, "listen");
  else startDrill(list, true);
}

function record(word, result, map = profile.progress){      // result: clean | hinted | failed
  profile.backup.changes = (profile.backup.changes||0) + 1;
  const s = map[word] || (map[word] = { seen:0, clean:0, hinted:0, failed:0, streak:0, last:null, ts:0 });
  s.seen++; s[result]++; s.last = result; s.ts = Date.now();
  s.streak = result==="clean" ? s.streak+1 : 0;
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
    </div>${guestReminder(total)}`;
  show("summary");
  if($("gSignIn")) $("gSignIn").onclick = () => Cloud.signIn();
  if(sess.review.length){
    const r = [...new Map(sess.review.map(x => [x.it.word, {...x.it, phase:undefined, again:false, learned:false}])).values()];
    $("sRetry").onclick = () => sess.type==="pinyin" ? startPinyin(r) : sess.type==="translate" ? startTranslate(r) : startDrill(r);
  }
  $("sHome").onclick = () => renderHome();
}

/* One-time nudge for guests on the end-of-round screen. */
function guestReminder(total){
  if(!total || profile.settings.reminded || typeof Cloud==="undefined" || !Cloud.enabled() || Cloud.user()) return "";
  profile.settings.reminded = true; saveDB();
  return `<div class="guest-note"><span>Sign in to keep this progress on all your devices.</span>
    <button class="primary" id="gSignIn">Sign in with Google</button></div>`;
}
