"use strict";
/* Vocab lists: every .docx in /lists (auto-detected on github.io, or from lists/manifest.json). */
/* ---------------- Shared (built-in) lists: files in /lists ---------------- */
let sharedLists = [];
async function discoverListFiles(){
  const found = new Map();                      // file -> display name
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if(m){                                        // auto-detect any .docx you drop into the repo's lists/ folder
    const owner = m[1], seg = location.pathname.split("/")[1];
    const repo = seg && !/\.html?$/i.test(seg) ? seg : owner + ".github.io";
    try{
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/lists`);
      if(r.ok) for(const f of await r.json()) if(f.type==="file" && /\.docx$/i.test(f.name)) found.set(f.name, null);
    }catch(e){}
  }
  try{                                          // manifest (works anywhere, and as a fallback)
    const r = await fetch("lists/manifest.json", {cache:"no-cache"});
    if(r.ok) for(const e of (await r.json()).lists||[]) found.set(e.file, e.name || found.get(e.file) || null);
  }catch(e){}
  return found;
}
async function loadSharedLists(){
  const out = [];
  try{
    const files = await discoverListFiles();
    await Promise.all([...files].map(async ([file, name]) => {
      try{
        const r = await fetch("lists/" + encodeURIComponent(file)); if(!r.ok) return;
        const items = parseVocab(await docxToLines(await r.arrayBuffer()));
        if(items.length) out.push({ id:"shared:"+file, shared:true, name: name || file.replace(/\.docx$/i,"").replace(/_/g," "), items });
      }catch(e){}
    }));
  }catch(e){}
  if(!out.length){                              // offline / opened from disk: fall back to the embedded L3 list
    try{ out.push({ id:"shared:builtin", shared:true, name:DEFAULT_LIST_NAME, items: parseVocab(await docxToLines(b64ToBuf(DEFAULT_DOCX_B64))) }); }catch(e){}
  }
  sharedLists = out.sort((a,b)=>a.name.localeCompare(b.name, undefined, {numeric:true}));
}
function allLists(){ return sharedLists; }
