"use strict";
/* Pinyin helpers: split pinyin into syllables, read tones (marks or numbers), compare answers. */
(function(root){
  const MARKS = { a:"āáǎà", e:"ēéěè", i:"īíǐì", o:"ōóǒò", u:"ūúǔù", "ü":"ǖǘǚǜ" };
  const UNMARK = {};
  for(const [v, s] of Object.entries(MARKS)) [...s].forEach((c, k) => { UNMARK[c] = [v, k+1]; });
  const VOWELS = "aeiouü";

  /* Valid syllables, built from initials + finals (a slight superset is fine for splitting). */
  const SYL = new Set(["r"]);
  const F_MAIN = "a o e ai ei ao ou an en ang eng ong i u ua uo uai ui uan un uang ia ie iao iu ian in iang ing".split(" ");
  const F_JQX  = "i ia ie iao iu ian in iang ing iong u ue uan un".split(" ");
  const F_Y    = "a e o ao ou an ang ong i in ing u ue uan un".split(" ");
  const F_W    = "a o ai ei an en ang eng u".split(" ");
  const F_ZERO = "a o e ai ei ao ou an en ang eng er".split(" ");
  "b p m f d t n l g k h zh ch sh r z c s".split(" ").forEach(i => F_MAIN.forEach(f => SYL.add(i+f)));
  "j q x".split(" ").forEach(i => F_JQX.forEach(f => SYL.add(i+f)));
  F_Y.forEach(f => SYL.add("y"+f)); F_W.forEach(f => SYL.add("w"+f)); F_ZERO.forEach(f => SYL.add(f));
  ["nü","lü","nüe","lüe"].forEach(s => SYL.add(s));

  /* After j/q/x/y, ü is written u: treat both spellings the same. */
  const normSyl = s => s.replace(/^([jqxy])ü/, "$1u");

  /* Text -> letters (each with its tone mark, 0 if none), hard breaks, and typed tone numbers. */
  function tokenize(str){
    let s = String(str||"").normalize("NFC").toLowerCase().replace(/u:/g,"ü").replace(/v/g,"ü");
    const letters = [], breaks = new Set(), digit = {};
    for(const c of s){
      if(UNMARK[c]){ letters.push({ c:UNMARK[c][0], t:UNMARK[c][1] }); }
      else if(/[a-zü]/.test(c)){ letters.push({ c, t:0 }); }
      else if(/[0-5]/.test(c)){ if(letters.length){ breaks.add(letters.length); digit[letters.length] = (+c===0 ? 5 : +c); } }
      else breaks.add(letters.length);          // space, apostrophe, hyphen, brackets...
    }
    breaks.add(letters.length);
    return { letters, breaks, digit };
  }

  /* Split into syllables. n = expected count (null = any). Returns [{l, t}] or null. */
  function split(str, n){
    const { letters, breaks, digit } = tokenize(str);
    const L = letters.length;
    if(!L) return null;
    const memo = new Map();
    const best = (i, k) => {                     // lowest-penalty split of letters[i..] into k syllables
      if(i===L) return (k===0 || k===null) ? { p:0, out:[] } : null;
      if(k===0) return null;
      const key = i+","+k; if(memo.has(key)) return memo.get(key);
      let res = null;
      for(let j=i+1; j<=Math.min(L, i+6); j++){
        const chunk = letters.slice(i, j), text = normSyl(chunk.map(x=>x.c).join(""));
        if(SYL.has(text)){
          const marks = chunk.filter(x=>x.t);
          let p = marks.length>1 ? 10 : 0;
          if(i>0 && !breaks.has(i) && "aeo".includes(text[0])) p += 1;   // a new syllable starting with a vowel needs an apostrophe
          const rest = best(j, k===null ? null : k-1);
          if(rest && (!res || p+rest.p < res.p)){
            const t = marks.length ? marks[marks.length-1].t : (digit[j] || 5);
            res = { p:p+rest.p, out:[{ l:text, t }, ...rest.out] };
          }
        }
        if(breaks.has(j)) break;                 // a syllable can't run past a space or tone number
      }
      memo.set(key, res); return res;
    };
    const r = best(0, n==null ? null : n);
    return r ? r.out : null;
  }

  /* Put the tone mark on the right vowel: a/e first, then the o in "ou", else the last vowel. */
  function mark(l, t){
    const shown = l.replace(/^([jqxy])u/, "$1u");
    if(!(t>=1 && t<=4)) return shown;
    let k = shown.indexOf("a"); if(k<0) k = shown.indexOf("e"); if(k<0) k = shown.indexOf("ou");
    if(k<0){ for(let i=shown.length-1; i>=0; i--) if(VOWELS.includes(shown[i])){ k = i; break; } }
    if(k<0) return shown;
    return shown.slice(0,k) + MARKS[shown[k]][t-1] + shown.slice(k+1);
  }

  /* Read an answer: tries the expected syllable count first, then any count. */
  function read(str, n){ return split(str, n) || split(str, null); }

  /* Compare typed input with the correct pinyin for a word with n characters. */
  function grade(answer, input, n){
    const want = read(answer, n);
    if(!want){                                   // answer itself unreadable: plain comparison
      const flat = s => String(s).normalize("NFC").toLowerCase().replace(/[^a-zü0-9āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g,"");
      return { ok: flat(answer)===flat(input), want:null, got:null, syl:[] };
    }
    const got = split(input, want.length);
    if(!got) return { ok:false, want, got:null, syl:[] };
    const syl = want.map((w, i) => ({ letters: w.l===got[i].l, tone: w.t===got[i].t, want:w, got:got[i] }));
    return { ok: syl.every(s => s.letters && s.tone), want, got, syl };
  }

  /* Live preview of what the user typed, as tone-marked syllables. */
  function preview(input, n){
    const s = split(input, n) || split(input, null);
    return s ? s.map(x => ({ text:mark(x.l, x.t), t:x.t })) : null;
  }

  const TONE_NAMES = ["", "1st tone (high, flat ˉ)", "2nd tone (rising ˊ)", "3rd tone (dip ˇ)", "4th tone (falling ˋ)", "neutral tone (light, no mark)"];
  const api = { split, read, grade, mark, preview, TONE_NAMES };
  if(typeof module!=="undefined" && module.exports) module.exports = api; else root.Pinyin = api;
})(typeof window!=="undefined" ? window : globalThis);
