"use strict";
/* Start-up: wire the controls and show the home screen. */
/* ---------------- Wire up ---------------- */
wirePinyin(); wireTranslate();
const PRACTICE_DESC = { write:"Draw each character stroke by stroke from its English meaning.",
  pinyin:"See the character and type its full pinyin, tones included.",
  translate:"Translate sentences built from this list's words, English ↔ Chinese.",
  listen:"Hear a word, then type its pinyin or write the characters." };
document.querySelectorAll("#optPractice button").forEach(b => b.onclick = () => { profile.settings.practice = b.dataset.v; saveDB(); renderHome(); });
$("optDir").onchange = () => { profile.settings.tdir = $("optDir").value; saveDB(); };
$("optListen").onchange = () => { profile.settings.lans = $("optListen").value; saveDB(); };
function syncPracticeUI(){
  const p = profile.settings.practice || "write", t = p==="translate";
  document.querySelectorAll("#optPractice button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.v===p)));
  $("practiceDesc").textContent = PRACTICE_DESC[p] || "";
  $("optPinyinLbl").hidden = p!=="write"; $("optDir").hidden = !t; $("optDir").value = profile.settings.tdir || "mix";
  $("optListen").hidden = p!=="listen"; $("optListen").value = profile.settings.lans || "pinyin";
  const o = $("optMode").options;
  o[0].text = t ? "All sentences" : "All words";
  o[1].text = t ? "Sentences I haven't mastered" : "Words I haven't mastered";
  o[2].text = t ? "New sentences only" : "Words I haven't practiced yet";
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
$("dClose").onclick = () => $("syncDlg").close();

/* Welcome popup: shown once to people who aren't signed in, after sign-in state is known (so it never flashes for signed-in users). */
function onCloudAuth(u){
  const d = $("welcomeDlg");
  if(u){ if(d.open) d.close(); if($("gSignIn")) $("gSignIn").closest(".guest-note").remove(); return; }
  if(profile.settings.welcomed || d.open || $("screenHome").classList.contains("hidden")) return;
  d.showModal();
}
function welcomeDone(){ profile.settings.welcomed = true; saveDB(); if($("welcomeDlg").open) $("welcomeDlg").close(); }
$("wSignIn").onclick = () => { profile.settings.welcomed = true; saveDB(); Cloud.signIn(); };
$("wGuest").onclick = welcomeDone;
$("welcomeDlg").addEventListener("cancel", welcomeDone);     // Esc counts as "continue as guest"
try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}   // ask the browser not to clear our data
$("optShuffle").checked = profile.settings.shuffle; $("optPinyin").checked = profile.settings.pinyin;
renderHome();                                   // shows the page immediately; lists fill in once loaded
if(typeof Cloud!=="undefined") Cloud.init();
loadSharedLists().then(() => { if(!$("screenHome").classList.contains("hidden")) renderHome(); });
