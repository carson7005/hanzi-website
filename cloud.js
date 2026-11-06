"use strict";
/* Optional cloud sync: Google sign-in + one Firestore document per person (users/<uid>).
   Uses only free Firebase features (Authentication and Firestore on the Spark plan).
   Every sync reads the cloud copy, merges it in (newest result per word wins), then writes the result back,
   so two devices never overwrite each other's newer progress. */
const Cloud = (() => {
  const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
  let auth = null, db = null, user = null, status = "off", timer = null, busy = false, again = false, lastPull = 0, quiet = false;
  const enabled = () => !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
  const loadScript = src => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  const setStatus = s => { status = s; if(typeof renderUserBar==="function") renderUserBar(); if(typeof renderCloudBox==="function") renderCloudBox(); };

  async function init(){
    if(!enabled()) return;
    try{
      for(const f of ["firebase-app-compat.js","firebase-auth-compat.js","firebase-firestore-compat.js"]) await loadScript(SDK + f);
      firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth(); db = firebase.firestore();
      auth.getRedirectResult().catch(() => {});
      auth.onAuthStateChanged(u => {
        user = u; setStatus(u ? "syncing" : "signedout");
        if(u) syncNow();
        if(typeof renderBackupNote==="function") renderBackupNote();
      });
      document.addEventListener("visibilitychange", () => {
        if(!user) return;
        if(document.visibilityState==="hidden" && timer){ clearTimeout(timer); timer = null; syncNow(); }       // save before leaving
        else if(document.visibilityState==="visible" && Date.now()-lastPull > 30000) syncNow();               // pick up other devices
      });
    }catch(e){ console.warn("Cloud sync unavailable", e); setStatus("error"); }
  }

  async function signIn(){
    if(!auth) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    try{ await auth.signInWithPopup(provider); }
    catch(e){
      if(["auth/popup-blocked","auth/operation-not-supported-in-this-environment","auth/cancelled-popup-request"].includes(e.code)) return auth.signInWithRedirect(provider);
      if(e.code!=="auth/popup-closed-by-user") alertMsg("Couldn't sign in: " + (e.message||e.code));
    }
  }
  async function signOut(){ if(auth){ await syncNow(); await auth.signOut(); } }
  function alertMsg(m){ const el = document.getElementById("dMsg"); if(el){ el.className = "dmsg bad"; el.textContent = m; } }

  /* Called after every local save: sync a few seconds later, batching quick changes together. */
  function schedule(){
    if(!user || quiet) return;                 // ignore the save that our own merge makes
    if(busy){ again = true; return; }
    clearTimeout(timer); timer = setTimeout(() => { timer = null; syncNow(); }, 4000);
  }

  async function syncNow(){
    if(!user || !db) return;
    if(busy){ again = true; return; }
    busy = true; setStatus("syncing");
    try{
      const ref = db.collection("users").doc(user.uid);
      let changed = 0;
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const remote = snap.exists && snap.data().code;
        if(remote){ try{ const inc = await decodeProgress(remote); quiet = true; changed = mergeProgress(inc); }catch(e){ console.warn("Bad cloud data", e); } finally{ quiet = false; } }
        tx.set(ref, { code: await encodeProgress(), updated: firebase.firestore.FieldValue.serverTimestamp(), v: 2 });
      });
      lastPull = Date.now();
      profile.backup = { ts: Date.now(), changes: 0 }; saveLocalOnly();
      setStatus("synced");
      if(changed && !document.getElementById("screenHome").classList.contains("hidden")) renderHome();
    }catch(e){ console.warn("Sync failed", e); setStatus(navigator.onLine===false ? "offline" : "error"); }
    busy = false;
    if(again){ again = false; schedule(); }
  }
  function saveLocalOnly(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(profile)); }catch(e){} }

  return { init, signIn, signOut, schedule, syncNow, enabled, user: () => user, status: () => status };
})();
