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
  const key = PROGRESS_KEYS.find(k => profile[k]===map);      // another tab may have saved newer progress for this word
  if(key){ try{ const saved = (JSON.parse(localStorage.getItem(STORE_KEY)||"null")||{})[key]||{}, o = saved[word];
    if(o && (o.ts||0) > ((map[word]&&map[word].ts)||0)) map[word] = o; }catch(e){} }
  const s = map[word] || (map[word] = { seen:0, clean:0, hinted:0, failed:0, streak:0, last:null, ts:0 });
  s.seen++; s[result]++; s.last = result; s.ts = Date.now();
  s.streak = result==="clean" ? s.streak+1 : 0;
}
/* One line for the verdict: how close the word is to being mastered. */
function streakNote(word, map){
  const s = map[word]; if(!s) return "";
  if(s.streak >= MASTER_STREAK) return s.streak===MASTER_STREAK ? "Mastered!" : `Mastered (${s.streak} clean in a row).`;
  if(s.streak > 0) return `${MASTER_STREAK - s.streak===1 ? "One more clean round" : (MASTER_STREAK - s.streak)+" more clean rounds"} to master it.`;
  return `Streak reset. Get it clean ${MASTER_STREAK} times in a row to master it.`;
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
    const t = sess.type, eng = sess.engine;
    $("sRetry").onclick = () => t==="translate" ? startTranslate(r)
      : t==="listen" ? (eng==="write" ? startDrill(r, false, "listen") : startPinyin(r, false, "listen"))
      : t==="pinyin" ? startPinyin(r) : startDrill(r);
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
