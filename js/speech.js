"use strict";
/* Tone colours and pronunciation (browser speech). */
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
/* Speak after a short delay; any newer request (or a new card) cancels the old one. */
let sayTimer = null;
function sayLater(text, ms){ clearTimeout(sayTimer); sayTimer = setTimeout(() => say(text), ms); }
function stopSpeech(){ clearTimeout(sayTimer); try{ if(window.speechSynthesis) speechSynthesis.cancel(); }catch(e){} }
const ICON_SPEAKER = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`;
const sayBtn = it => window.speechSynthesis ? ` <button type="button" class="say" data-say="${esc(it.word)}" title="Hear it" aria-label="Hear ${esc(it.word)}">${ICON_SPEAKER}</button>` : "";
document.addEventListener("click", e => { const b = e.target.closest(".say"); if(b) say(b.dataset.say); });
