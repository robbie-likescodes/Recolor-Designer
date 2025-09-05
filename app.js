/* Palette Mapper — app.js (v12-suggested)
   New in this build:
   • Palette-limit prompt on load (e.g., 3 inks + white)
   • Suggestions modal: auto rules (per-rule sliders + delete)
   • Refresh button to re-apply mapping + rules
   • Export SVG activation & safe fallback tracer
   • Duplicate "Texture Mode" guard + UI cleanup
   • Helpful toasts for Lasso / Suggestions / Export
*/

/////////////////////////////// Quick DOM helpers ///////////////////////////////
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgbToHex = (r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
const hexToRgb = (hex)=>{ let h=(hex||'').trim(); if(!h.startsWith('#')) h='#'+h; const m=/^#([0-9a-f]{6})$/i.exec(h); if(!m) return null; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; };

function toast(msg, ms=2200){
  let host = $("#toasts");
  if(!host){
    host = document.createElement("div");
    host.id="toasts";
    host.style.cssText="position:fixed;left:50%;transform:translateX(-50%);bottom:18px;display:grid;gap:8px;z-index:999999";
    document.body.appendChild(host);
  }
  const t=document.createElement("div");
  t.textContent=msg;
  t.style.cssText="background:#0b1326cc;border:1px solid #1e293b;color:#e5e7eb;padding:10px 12px;border-radius:10px;backdrop-filter:blur(10px)";
  host.appendChild(t);
  setTimeout(()=>{ t.style.opacity="0"; t.style.transition="opacity .22s"; setTimeout(()=>host.removeChild(t),220); }, ms);
}

// Safe get of known elements from your HTML (created if missing)
const els = {
  fileInput:  document.getElementById('fileInput'),
  cameraInput:document.getElementById('cameraInput'),
  pasteBtn:   document.getElementById('pasteBtn'),
  resetBtn:   document.getElementById('resetBtn'),
  maxW:       document.getElementById('maxW'),
  keepFullRes:document.getElementById('keepFullRes'),
  sharpenEdges:document.getElementById('sharpenEdges'),
  srcCanvas:  document.getElementById('srcCanvas'),
  outCanvas:  document.getElementById('outCanvas'),

  paletteList:document.getElementById('paletteList'),
  addColor:   document.getElementById('addColor'),
  clearColors:document.getElementById('clearColors'),
  loadExample:document.getElementById('loadExample'),
  savePalette:document.getElementById('savePalette'),
  clearSavedPalettes:document.getElementById('clearSavedPalettes'),
  savedPalettes:document.getElementById('savedPalettes'),

  wChroma:    document.getElementById('wChroma'),
  wLight:     document.getElementById('wLight'),
  wChromaOut: document.getElementById('wChromaOut'),
  wLightOut:  document.getElementById('wLightOut'),
  useDither:  document.getElementById('useDither'),
  bgMode:     document.getElementById('bgMode'),
  applyBtn:   document.getElementById('applyBtn'),
  downloadBtn:document.getElementById('downloadBtn'),

  // Vector area (may not exist yet — create if missing)
  exportSvgBtn: document.getElementById('exportSvgBtn'),

  // Texture rules list container (dynamic)
  texList: document.getElementById('texList'),
};

const sctx = els.srcCanvas.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas.getContext('2d', { willReadFrequently:true });
sctx.imageSmoothingEnabled = false;
octx.imageSmoothingEnabled = false;

/////////////////////////////// App state ///////////////////////////////
const state = {
  fullBitmap: null,
  fullW: 0, fullH: 0,
  exifOrientation: 1,
  // Rules: { id, hexTarget, mode:'checker'|'stripe'|'bayer', aIdx, bIdx, density:0..1, lumaAdaptive:bool }
  textureRules: [],
  // Palette limits after load
  paletteLimit: { inks:3, includeWhite:true },
};

/////////////////////////////// UI bootstrapping ///////////////////////////////
function ensureVectorSection(){
  if ($('#vectorCard')) return;
  const sec = document.createElement('section');
  sec.className='card';
  sec.id='vectorCard';
  sec.innerHTML = `
    <h2>Vector (SVG)</h2>
    <div class="row">
      <label>Simplify <input id="vecSimplify" type="range" min="0" max="100" value="35" /></label>
      <label>Min area <input id="vecMinArea" type="number" min="1" value="8" /></label>
      <label class="check"><input id="vecLockPal" type="checkbox" checked /> Lock to current palette</label>
      <button id="exportSvgBtn" type="button">Export SVG</button>
    </div>
    <div class="help">Uses <em>Vectorize</em> if present (vector.js) or <em>ImageTracer</em> if included. Falls back to a simple built-in tracer.</div>
  `;
  document.body.appendChild(sec);
  els.exportSvgBtn = $('#exportSvgBtn');
}
function ensureTextureSection(){
  // If a duplicate texture block exists, we reuse the first and ignore the rest.
  if ($('#textureCard')) return;
  const sec = document.createElement('section');
  sec.className='card';
  sec.id='textureCard';
  sec.innerHTML = `
    <h2>4) Texture / Replace one color</h2>
    <div class="row">
      <button id="suggestBtn" type="button">Suggest replacements…</button>
      <button id="refreshAllBtn" type="button" class="ghost">Refresh output</button>
    </div>
    <div id="texList" class="tiny-help" style="margin-top:10px"></div>
  `;
  document.body.appendChild(sec);
  els.texList = $('#texList');
}
ensureTextureSection();
ensureVectorSection();

/////////////////////////////// Palette UI ///////////////////////////////
function addPaletteRow(hex='#FFFFFF'){
  const row=document.createElement('div'); row.className='palette-item';
  row.innerHTML = `
    <input type="color" value="${hex}"/>
    <input type="text" value="${hex}" class="mono" placeholder="#RRGGBB"/>
    <button class="ghost" type="button">Remove</button>
  `;
  const color = row.querySelector('input[type=color]');
  const hexIn = row.querySelector('input[type=text]');
  const del   = row.querySelector('button');

  function sync(fromColor){
    if(fromColor) hexIn.value = color.value.toUpperCase();
    let v = hexIn.value.trim(); if(!v.startsWith('#')) v = '#'+v;
    if(/^#([0-9a-f]{6})$/i.test(v)){ hexIn.value = v.toUpperCase(); color.value = v; }
  }
  on(color,'input',()=>{ sync(true); });
  on(hexIn,'change',()=>{ sync(false); });
  on(del,'click',()=>{ row.remove(); renderRulesList(); });
  els.paletteList.appendChild(row);
}
function getPalette(){
  return [...els.paletteList.querySelectorAll('.palette-item')].map(r=>{
    const h=(r.querySelector('input[type=text]').value||'').trim(); const rgb=hexToRgb(h); return rgb?[rgb.r,rgb.g,rgb.b]:null;
  }).filter(Boolean);
}
function setPalette(hexes){ els.paletteList.innerHTML=''; hexes.forEach(h=>addPaletteRow(h)); }

/////////////////////////////// Image loading ///////////////////////////////
function objectUrlFor(file){ return URL.createObjectURL(file); }
function revoke(url){ try{ URL.revokeObjectURL(url); }catch{} }
function loadImage(url){ return new Promise((res,rej)=>{ const im=new Image(); im.decoding='async'; im.onload=()=>res(im); im.onerror=rej; im.src=url; }); }

async function handleFile(file){
  try{
    if(!file) return;
    const url = objectUrlFor(file);
    const img = await loadImage(url);
    revoke(url);

    state.fullBitmap = img;
    state.fullW = img.naturalWidth || img.width;
    state.fullH = img.naturalHeight || img.height;
    state.exifOrientation = 1;

    // Draw preview (fit to maxW)
    const MAXW = parseInt(els.maxW.value||'1400',10);
    let w = state.fullW, h = state.fullH;
    if (w > MAXW){ const s = MAXW/w; w=Math.round(w*s); h=Math.round(h*s); }
    els.srcCanvas.width=w; els.srcCanvas.height=h; sctx.imageSmoothingEnabled=false;
    sctx.drawImage(img,0,0,w,h);

    // Clear output
    els.outCanvas.width=w; els.outCanvas.height=h; octx.clearRect(0,0,w,h);

    // Quick auto palette from image (10 colors)
    autoPaletteFromCanvasHybrid(els.srcCanvas, 10);

    // Ask palette limit
    await askPaletteLimit();
    // Offer suggestions
    openSuggestionsModal();
    toast('Tip: Press & hold in editor to pick a color. Lasso can restrict allowed inks in regions.');
  }catch(e){
    console.error(e);
    alert('Could not open that image.');
  }
}

on(els.fileInput,'change',e=>handleFile(e.target.files?.[0]));
on(els.cameraInput,'change',e=>handleFile(e.target.files?.[0]));
on(els.pasteBtn,'click', async ()=>{
  if(!navigator.clipboard?.read) { alert('Clipboard read not supported here.'); return; }
  try{
    const items = await navigator.clipboard.read();
    for(const it of items){ for(const t of it.types){ if(t.startsWith('image/')){ const b=await it.getType(t); await handleFile(b); return; } } }
    alert('No image in clipboard.');
  }catch{ alert('Clipboard read failed.'); }
});
on(els.resetBtn,'click', ()=>{ if(!state.fullBitmap) return; sctx.drawImage(state.fullBitmap,0,0,els.srcCanvas.width,els.srcCanvas.height); });

/////////////////////////////// Auto palette (hybrid) ///////////////////////////////
function autoPaletteFromCanvasHybrid(canvas, k=10){
  if(!canvas.width) return;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;

  // 5-bit histogram seeds
  const bins=new Map();
  for(let i=0;i<data.length;i+=4){
    const a=data[i+3]; if(a<16) continue;
    const r=data[i]>>3, g=data[i+1]>>3, b=data[i+2]>>3;
    const key=(r<<10)|(g<<5)|b;
    bins.set(key,(bins.get(key)||0)+1);
  }
  const seeds=[...bins.entries()].sort((a,b)=>b[1]-a[1]).slice(0,Math.max(k*4,24)).map(([key])=>{
    return [((key>>10)&31)<<3, ((key>>5)&31)<<3, (key&31)<<3];
  });

  // k-means from seeds
  const centers = kmeansFromSeeds(data, k, seeds, 8);
  setPalette(centers.map(([r,g,b])=>rgbToHex(r,g,b)));
}

function kmeansFromSeeds(data,k,seeds,iters=8){
  const picked=[]; for(let i=0;i<k;i++) picked.push(seeds[Math.floor((i+0.5)*seeds.length/k)]);
  const centers=picked.map(c=>c.slice());
  const n=data.length/4;
  const counts=new Array(k).fill(0), sums=new Array(k).fill(0).map(()=>[0,0,0]);
  for(let it=0;it<iters;it++){
    counts.fill(0); for(const s of sums){ s[0]=s[1]=s[2]=0; }
    for(let i=0;i<n;i++){
      if(data[i*4+3]===0) continue;
      const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
      let best=0, bestD=1e9;
      for(let c=0;c<k;c++){ const dr=r-centers[c][0], dg=g-centers[c][1], db=b-centers[c][2]; const d=dr*dr+dg*dg+db*db; if(d<bestD){ bestD=d; best=c; } }
      counts[best]++; sums[best][0]+=r; sums[best][1]+=g; sums[best][2]+=b;
    }
    for(let c=0;c<k;c++){ if(counts[c]>0){ centers[c][0]=Math.round(sums[c][0]/counts[c]); centers[c][1]=Math.round(sums[c][1]/counts[c]); centers[c][2]=Math.round(sums[c][2]/counts[c]); } }
  }
  return centers;
}

/////////////////////////////// Palette-limit prompt ///////////////////////////////
function askPaletteLimit(){
  return new Promise((resolve)=>{
    const sh=document.createElement('div');
    sh.innerHTML=`
      <div style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99998;display:grid;place-items:center">
        <div style="background:#0b1225;border:1px solid #1e293b;border-radius:12px;padding:14px;width:min(480px,92vw)">
          <h3 style="margin:0 0 8px">Limit palette</h3>
          <div class="row" style="margin-bottom:8px">
            <label>Inks <input id="limitInks" type="number" min="2" max="8" value="${state.paletteLimit.inks}"/></label>
            <label class="check"><input id="limitWhite" type="checkbox" ${state.paletteLimit.includeWhite?'checked':''}/> Include white</label>
          </div>
          <div class="row">
            <button id="limitOk" type="button">OK</button>
            <button id="limitCancel" class="ghost" type="button">Cancel</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(sh);
    $('#limitOk',sh).onclick=()=>{ state.paletteLimit.inks = clamp(parseInt($('#limitInks',sh).value||'3',10),2,8); state.paletteLimit.includeWhite = !!$('#limitWhite',sh).checked; document.body.removeChild(sh); resolve(); };
    $('#limitCancel',sh).onclick=()=>{ document.body.removeChild(sh); resolve(); };
  });
}

/////////////////////////////// Suggestions modal ///////////////////////////////
function openSuggestionsModal(){
  const pal = getPalette();
  if(!pal.length){ toast('Add colors first.'); return; }

  // Build allowed inks (limit) from current palette by luminance spread
  const inks = Math.min(state.paletteLimit.inks, pal.length);
  const includeWhite = !!state.paletteLimit.includeWhite;

  // sort by pop/luma-ish: here just by luma desc
  const withL = pal.map((rgb,i)=>({i, rgb, L: 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2]}))
                   .sort((a,b)=>a.L-b.L); // dark..light

  // Keep a subset
  let kept = withL;
  if (withL.length > inks) kept = withL.filter((_,idx)=> idx % Math.ceil(withL.length/inks) === 0).slice(0,inks);
  kept = kept.sort((a,b)=>a.L-b.L);

  // Optionally force white into kept
  if(includeWhite){
    const hasWhite = kept.some(k=> k.rgb[0]>250 && k.rgb[1]>250 && k.rgb[2]>250);
    if(!hasWhite){
      kept.push({i:-1, rgb:[255,255,255], L:255});
      kept.sort((a,b)=>a.L-b.L);
    }
  }

  // Suggest: every palette color NOT in kept becomes a target replaced by mix of nearest two kepts
  const keptArr = kept.map(k=>k.rgb);
  const keptHex = keptArr.map(([r,g,b])=>rgbToHex(r,g,b));
  const keptLab = keptArr.map(([r,g,b])=> rgbToLab(r,g,b));

  const drop = pal.filter(p=> !keptArr.some(k=> k[0]===p[0]&&k[1]===p[1]&&k[2]===p[2]));
  const suggestions = drop.map(rgb=>{
    const hex = rgbToHex(rgb[0],rgb[1],rgb[2]);
    // nearest 2 kept by Lab
    const lab = rgbToLab(rgb[0],rgb[1],rgb[2]);
    let a=0,b=1,da=1e9,db=1e9;
    keptLab.forEach((kl,i)=>{
      const d = deltaE2Sq(lab, kl, 1,1);
      if(d<da){ db=da; b=a; da=d; a=i; }
      else if(d<db){ db=d; b=i; }
    });
    // estimated density from luminance (closer to darker ink -> higher B ratio if darker mapped first)
    const Lsrc = 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
    const L0 = 0.2126*keptArr[a][0]+0.7152*keptArr[a][1]+0.0722*keptArr[a][2];
    const L1 = 0.2126*keptArr[b][0]+0.7152*keptArr[b][1]+0.0722*keptArr[b][2];
    const dens = clamp((Lsrc - Math.min(L0,L1))/Math.max(1, Math.abs(L1-L0)), 0, 1);
    return { hexTarget:hex, mode:'checker', aIdx:a, bIdx:b, density:dens, lumaAdaptive:true };
  });

  // Build modal UI
  const sh=document.createElement('div');
  sh.innerHTML=`
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99997;display:grid;place-items:center">
      <div style="background:#0b1225;border:1px solid #1e293b;border-radius:12px;padding:14px;width:min(560px,96vw);max-height:90vh;overflow:auto">
        <h3 style="margin:0 0 8px">Suggested replacements</h3>
        <div class="help">Limit: ${state.paletteLimit.inks} inks ${includeWhite?'+ white':''}. Kept inks: ${keptHex.join(', ')}</div>
        <div id="sugList"></div>
        <div class="row" style="margin-top:10px">
          <button id="sugApply" type="button">Apply rules</button>
          <button id="sugCancel" class="ghost" type="button">Cancel</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(sh);

  const list = $('#sugList', sh);
  suggestions.forEach((r,idx)=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:8px;margin:6px 0;padding:6px;border:1px solid #1e293b;border-radius:8px;background:#0a132a';
    row.innerHTML = `
      <span class="mono" style="min-width:100px">Target ${r.hexTarget}</span>
      <span style="width:16px;height:16px;border:1px solid #334155;border-radius:4px;background:${r.hexTarget}"></span>
      <span class="mono">→</span>
      <span class="mono">${rgbToHex(...keptArr[r.aIdx])} + ${rgbToHex(...keptArr[r.bIdx])}</span>
      <label style="margin-left:auto">Density
        <input type="range" min="0" max="100" value="${Math.round(r.density*100)}" />
      </label>
      <button class="ghost" type="button">Delete</button>
    `;
    const slider = row.querySelector('input[type=range]');
    const delBtn = row.querySelector('button.ghost');
    slider.addEventListener('input', ()=>{ r.density = slider.value/100; });
    delBtn.addEventListener('click', ()=>{ row.remove(); const i=suggestions.indexOf(r); if(i>=0) suggestions.splice(i,1); });
    list.appendChild(row);
  });

  $('#sugApply',sh).onclick=()=>{
    // Merge into rules (replace previous rules that target the same hex)
    suggestions.forEach(s=>{
      const id = 'r_'+s.hexTarget;
      const prevIdx = state.textureRules.findIndex(rr=> rr.hexTarget===s.hexTarget);
      const rule = { id, ...s };
      if(prevIdx>=0) state.textureRules[prevIdx]=rule; else state.textureRules.push(rule);
    });
    renderRulesList();
    document.body.removeChild(sh);
    toast('Suggestions applied — hit “Refresh output”.');
  };
  $('#sugCancel',sh).onclick=()=>{ document.body.removeChild(sh); };
}

/////////////////////////////// Texture rules list (per-rule sliders + delete) ///////////////////////////////
function renderRulesList(){
  if(!els.texList) return;
  if(state.textureRules.length===0){
    els.texList.innerHTML = '<div class="help">No texture rules yet. Use “Suggest replacements…” or add manually in the editor.</div>';
    return;
  }
  const pal = getPalette();
  els.texList.innerHTML = `
    <div class="help" style="margin-bottom:6px">Each rule replaces a mapped color with a 2-color pattern; density adjusts A:B ratio. Toggle Luma-adaptive to modulate by source brightness.</div>
  `;
  state.textureRules.forEach((r,idx)=>{
    const row=document.createElement('div');
    row.style.cssText='display:grid;grid-template-columns:1fr auto;gap:8px;margin:6px 0;padding:8px;border:1px solid #1e293b;border-radius:10px;background:#0a132a';
    const aHex = rgbToHex(...pal[r.aIdx]||[0,0,0]);
    const bHex = rgbToHex(...pal[r.bIdx]||[255,255,255]);
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="mono">Target ${r.hexTarget}</span>
        <span style="width:16px;height:16px;border:1px solid #334155;border-radius:4px;background:${r.hexTarget}"></span>
        <span class="mono">→ ${aHex} + ${bHex}</span>
        <label>Density <input class="dens" type="range" min="0" max="100" value="${Math.round(r.density*100)}" /></label>
        <label class="check"><input class="luma" type="checkbox" ${r.lumaAdaptive?'checked':''}/> Luma-adaptive</label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="ghost del" type="button">Delete</button>
      </div>
    `;
    row.querySelector('.dens').addEventListener('input', (e)=>{ r.density = e.target.value/100; });
    row.querySelector('.luma').addEventListener('change', (e)=>{ r.lumaAdaptive = !!e.target.checked; });
    row.querySelector('.del').addEventListener('click', ()=>{ state.textureRules.splice(idx,1); renderRulesList(); });
    els.texList.appendChild(row);
  });
}

/////////////////////////////// Mapping + Texture application ///////////////////////////////
// (We’ll reuse your existing palette mapper; here’s a compact version)
function rgbToXyz(r,g,b){ r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b);
  return [r*0.4124564+g*0.3575761+b*0.1804375, r*0.2126729+g*0.7151522+b*0.0721750, r*0.0193339+g*0.1191920+b*0.9503041];
}
function srgbToLinear(u){ u/=255; return u<=0.04045 ? u/12.92 : Math.pow((u+0.055)/1.055,2.4); }
function xyzToLab(x,y,z){ const Xn=0.95047,Yn=1,Zn=1.08883; x/=Xn; y/=Yn; z/=Zn; const f=t=>(t>0.008856)?Math.cbrt(t):(7.787*t+16/116); const fx=f(x),fy=f(y),fz=f(z); return [116*fy-16, 500*(fx-fy), 200*(fy-fz)]; }
function rgbToLab(r,g,b){ const [x,y,z]=rgbToXyz(r,g,b); return xyzToLab(x,y,z); }
function deltaE2Sq(l1,l2,wL,wC){ const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2]; return wL*dL*dL + wC*(da*da+db*db); }

function buildPalLab(pal){ return pal.map(([r,g,b])=>({rgb:[r,g,b], lab:rgbToLab(r,g,b)})); }

function applyMappingAndRules(){
  if(!els.srcCanvas.width){ alert('Load an image first.'); return; }
  const pal = getPalette(); if(!pal.length){ alert('Add at least one color.'); return; }
  const wL = parseInt(els.wLight?.value||'100',10)/100;
  const wC = parseInt(els.wChroma?.value||'100',10)/100;
  const dither = !!els.useDither?.checked;

  const w = els.srcCanvas.width, h = els.srcCanvas.height;
  const src = sctx.getImageData(0,0,w,h);
  const out = new ImageData(w,h); out.data.set(src.data);

  const palLab = buildPalLab(pal);

  // Map to nearest palette color first
  const errR=dither?new Float32Array(w*h):null;
  const errG=dither?new Float32Array(w*h):null;
  const errB=dither?new Float32Array(w*h):null;

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx=y*w+x, i4=idx*4; if(out.data[i4+3]===0) continue;
      let r=out.data[i4], g=out.data[i4+1], b=out.data[i4+2];
      if(dither){ r=clamp(Math.round(r+(errR[idx]||0)),0,255); g=clamp(Math.round(g+(errG[idx]||0)),0,255); b=clamp(Math.round(b+(errB[idx]||0)),0,255); }
      const lab=rgbToLab(r,g,b);
      let best=0, bestD=1e9;
      for(let p=0;p<palLab.length;p++){ const d=deltaE2Sq(lab,palLab[p].lab,wL,wC); if(d<bestD){ bestD=d; best=p; } }
      const [nr,ng,nb]=palLab[best].rgb;
      out.data[i4]=nr; out.data[i4+1]=ng; out.data[i4+2]=nb;

      if(dither){
        const er=r-nr, eg=g-ng, eb=b-nb;
        const push=(xx,yy,fr,fg,fb)=>{ if(xx<0||xx>=w||yy<0||yy>=h) return; const j=yy*w+xx; errR[j]+=fr; errG[j]+=fg; errB[j]+=fb; };
        push(x+1,y,     er*7/16, eg*7/16, eb*7/16);
        push(x-1,y+1,   er*3/16, eg*3/16, eb*3/16);
        push(x,  y+1,   er*5/16, eg*5/16, eb*5/16);
        push(x+1,y+1,   er*1/16, eg*1/16, eb*1/16);
      }
    }
  }

  // Apply 2-color texture rules per target hex
  if(state.textureRules.length){
    // Build quick lookup of target hex → rule
    const ruleMap = new Map();
    state.textureRules.forEach(r=>ruleMap.set(r.hexTarget.toUpperCase(), r));

    // Precompute LAB for source (for luma-adaptive)
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i4=(y*w+x)*4; if(out.data[i4+3]===0) continue;
        const th = rgbToHex(out.data[i4], out.data[i4+1], out.data[i4+2]).toUpperCase();
        const rule = ruleMap.get(th);
        if(!rule) continue;

        const palA = pal[rule.aIdx]||[0,0,0], palB = pal[rule.bIdx]||[255,255,255];
        // Base density
        let d = rule.density;
        if(rule.lumaAdaptive){
          // Use original SRC luminance to modulate (darker → more of darker ink)
          const sr = src.data[i4], sg=src.data[i4+1], sb=src.data[i4+2];
          const L = (0.2126*sr+0.7152*sg+0.0722*sb)/255; // 0..1
          d = clamp( (1-L), 0, 1 )*0.75 + rule.density*0.25; // blend
        }
        // Simple patterns: checker by (x^y)&1, stripe by x%2
        let chooseA = true;
        if(rule.mode==='stripe'){ chooseA = ((x&1)===0) ? (Math.random() < d) : (Math.random() >= d); }
        else if(rule.mode==='bayer'){ // tiny 2x2 Bayer
          const bx = x&1, by=y&1; const t = (bx+2*by)/3; chooseA = (t < d); }
        else { // checker default
          const t = ((x^y)&1) ? 1 : 0; chooseA = (t < d);
        }
        const use = chooseA ? palA : palB;
        out.data[i4]=use[0]; out.data[i4+1]=use[1]; out.data[i4+2]=use[2];
      }
    }
  }

  // Optional sharpen (edge-preserving lite)
  if (els.sharpenEdges && els.sharpenEdges.checked){
    const sh = unsharpMask(out, 0.35);
    octx.putImageData(sh, 0, 0);
    els.outCanvas._fullImageData = sh;
  } else {
    octx.putImageData(out, 0, 0);
    els.outCanvas._fullImageData = out;
  }
  els.downloadBtn.disabled = false;
}

on(els.applyBtn,'click', applyMappingAndRules);

// Big “Refresh output” in Texture card
$('#refreshAllBtn')?.addEventListener('click', applyMappingAndRules);

// Suggestions button
$('#suggestBtn')?.addEventListener('click', openSuggestionsModal);

/////////////////////////////// Download PNG ///////////////////////////////
on(els.downloadBtn,'click', ()=>{
  const full = els.outCanvas._fullImageData;
  if(!full){ alert('Nothing to export yet.'); return; }
  const c=document.createElement('canvas');
  c.width=full.width; c.height=full.height;
  const cx=c.getContext('2d',{willReadFrequently:true});
  cx.putImageData(full,0,0);
  c.toBlob(b=>{
    const a=document.createElement('a'); a.download='mapped.png'; a.href=URL.createObjectURL(b); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  }, 'image/png');
});

/////////////////////////////// Export SVG (vector) ///////////////////////////////
on(els.exportSvgBtn,'click', async ()=>{
  if(!els.outCanvas.width){ alert('Map something first.'); return; }
  const hasVectorize   = typeof window.Vectorize === 'function';
  const hasImageTracer = typeof window.ImageTracer !== 'undefined';

  try{
    let svg = '';
    if(hasVectorize){
      // Vectorize.js path (palette-locked if desired)
      const lock = $('#vecLockPal')?.checked;
      const simp = parseInt($('#vecSimplify')?.value||'35',10)/100;
      const minA = parseInt($('#vecMinArea')?.value||'8',10);
      const pal  = lock ? getPalette().map(([r,g,b])=>rgbToHex(r,g,b)) : null;
      svg = await Vectorize.fromCanvas(els.outCanvas, { simplify: simp, minArea:minA, palette: pal });
    }else if(hasImageTracer){
      const lock = $('#vecLockPal')?.checked;
      const pal  = lock ? getPalette().map(([r,g,b])=>rgbToHex(r,g,b)) : null;
      const options = { ltres:1, qtres:1, pathomit:8, rightangleenhance:true };
      if(pal) options.palette = pal.map(h=> ({ r:hexToRgb(h).r, g:hexToRgb(h).g, b:hexToRgb(h).b, a:255 }));
      svg = ImageTracer.imagedataToSVG(els.outCanvas.getContext('2d').getImageData(0,0,els.outCanvas.width,els.outCanvas.height), options);
    }else{
      // Fallback simplistic per-color marching squares-ish
      svg = fallbackTraceToSVG(els.outCanvas, getPalette().map(([r,g,b])=>rgbToHex(r,g,b)));
      toast('Exported with fallback tracer (install vector.js or ImageTracer for cleaner paths).', 3000);
    }
    const blob = new Blob([svg], {type:'image/svg+xml'});
    const a=document.createElement('a'); a.download='mapped.svg'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }catch(err){
    console.error(err);
    alert('Vector export failed.');
  }
});

function fallbackTraceToSVG(canvas, lockPalHexes){
  const w=canvas.width, h=canvas.height;
  const ctx=canvas.getContext('2d'); const id=ctx.getImageData(0,0,w,h).data;
  const HEX = (i)=> rgbToHex(id[i],id[i+1],id[i+2]);
  const seen=new Uint8Array(w*h);
  const paths=[];
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx=y*w+x; if(seen[idx]) continue;
      const i4=idx*4; const hx=HEX(i4);
      if(lockPalHexes && lockPalHexes.length && !lockPalHexes.includes(hx)) continue;
      // flood fill small regions → crude polygon
      const q=[[x,y]]; seen[idx]=1; const pts=[];
      while(q.length){
        const [qx,qy]=q.pop(); pts.push([qx,qy]);
        const neigh=[[qx+1,qy],[qx-1,qy],[qx,qy+1],[qx,qy-1]];
        for(const [nx,ny] of neigh){
          if(nx<0||ny<0||nx>=w||ny>=h) continue;
          const nidx=ny*w+nx; if(seen[nidx]) continue;
          const j4=nidx*4; if(HEX(j4)!==hx) continue;
          seen[nidx]=1; q.push([nx,ny]);
        }
      }
      if(pts.length>6){
        const d = simplifyPoly(pts, 1.5).map(p=>p.join(',')).join(' ');
        paths.push(`<polygon points="${d}" fill="${hx}" stroke="none"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${paths.join('')}</svg>`;
}
function simplifyPoly(pts, tol){
  // RDP lite on a sorted hull-ish (we just sample every kth)
  const step=Math.max(1, Math.floor(pts.length/200));
  const out=[]; for(let i=0;i<pts.length;i+=step) out.push(pts[i]); return out;
}

/////////////////////////////// Unsharp mask ///////////////////////////////
function unsharpMask(imageData, amount=0.35){
  const w=imageData.width, h=imageData.height, src=imageData.data;
  const out=new ImageData(w,h); out.data.set(src);
  const k=[0,-1,0,-1,5,-1,0,-1,0];
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      let r=0,g=0,b=0,ki=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++,ki++){
          const i=((y+dy)*w+(x+dx))*4, kv=k[ki];
          r+=src[i]*kv; g+=src[i+1]*kv; b+=src[i+2]*kv;
        }
      }
      const o=(y*w+x)*4;
      out.data[o  ] = clamp((1-amount)*src[o  ] + amount*r,0,255);
      out.data[o+1] = clamp((1-amount)*src[o+1] + amount*g,0,255);
      out.data[o+2] = clamp((1-amount)*src[o+2] + amount*b,0,255);
    }
  }
  return out;
}

/////////////////////////////// Small wiring ///////////////////////////////
function updateWeightsUI(){
  if(els.wChromaOut) els.wChromaOut.textContent = (parseInt(els.wChroma.value||'100',10)/100).toFixed(2)+'×';
  if(els.wLightOut)  els.wLightOut.textContent  = (parseInt(els.wLight.value||'100',10)/100).toFixed(2)+'×';
}
['input','change'].forEach(ev=>{
  els.wChroma?.addEventListener(ev, updateWeightsUI);
  els.wLight?.addEventListener(ev, updateWeightsUI);
});
updateWeightsUI();

// Extra: big refresh toast hint
setTimeout(()=>{ toast('Need to re-apply? Use “Refresh output”.'); }, 1200);

// Teach Lasso once per session
if(!sessionStorage.getItem('hint_lasso')){
  setTimeout(()=>{ toast('Hint: Lasso in the editor can limit which inks are allowed in a region.'); }, 2400);
  sessionStorage.setItem('hint_lasso','1');
}
