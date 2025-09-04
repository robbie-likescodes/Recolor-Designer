/* Palette Mapper — Cup Print Helper (All-in-One, 2025-09-04)
   Big features:
   - Robust image loading (upload/camera/paste/drag-drop) + EXIF orientation, HEIC guard
   - Auto palette (Hybrid histogram + K-means), saved palettes, PMS/HEX codes + printer report
   - Per-color tolerance slider + per-color importance weight (priority)
   - Lasso regions with allowed palette subset (per-region constraints)
   - Mapping in Lab with global weights + per-color tolerance lock-in
   - Optional Floyd–Steinberg dithering
   - Texture Mode (Replace a chosen source color with a 2- or 3-color pattern)
       • Patterns: Checker, Bayer 2×2, Stripe, Stipple (random), and Luma-adaptive density
       • Density slider and optional luma-adaptive toggle
   - Halftone dots (cell/jitter/bg color) as alternative renderer
   - High-resolution export (PNG) with edge-sharpen (unsharp mask), optional scale (1×/2×/4×)
   - Vector export (SVG) using Vectorize (vector.js) or ImageTracer (fallback)
   - Full-screen editor w/ iPhone-friendly Eyedropper + Lasso + Pan, add color to palette
   - Projects (IndexedDB), palettes (localStorage)
   - Undo/Redo for palette/settings changes
   - Helpful Toast tips (esp. for tricky tools like Lasso)
*/

/* =============================== DOM refs (lazy, with fallback injection) =============================== */
const els = {
  // required canvases
  srcCanvas: document.getElementById('srcCanvas'),
  outCanvas: document.getElementById('outCanvas'),

  // loaders
  fileInput: document.getElementById('fileInput'),
  cameraInput: document.getElementById('cameraInput'),
  pasteBtn: document.getElementById('pasteBtn'),
  resetBtn: document.getElementById('resetBtn'),
  maxW: document.getElementById('maxW'),
  keepFullRes: document.getElementById('keepFullRes'),
  sharpenEdges: document.getElementById('sharpenEdges'),

  // palette
  paletteList: document.getElementById('paletteList'),
  addColor: document.getElementById('addColor'),
  clearColors: document.getElementById('clearColors'),
  loadExample: document.getElementById('loadExample'),
  savePalette: document.getElementById('savePalette'),
  clearSavedPalettes: document.getElementById('clearSavedPalettes'),
  savedPalettes: document.getElementById('savedPalettes'),
  kColors: document.getElementById('kColors'),
  autoExtract: document.getElementById('autoExtract'),

  // mapping
  wChroma: document.getElementById('wChroma'),
  wLight: document.getElementById('wLight'),
  wChromaOut: document.getElementById('wChromaOut'),
  wLightOut: document.getElementById('wLightOut'),
  useDither: document.getElementById('useDither'),
  bgMode: document.getElementById('bgMode'),
  applyBtn: document.getElementById('applyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),

  // halftone
  useHalftone: document.getElementById('useHalftone'),
  dotCell: document.getElementById('dotCell'),
  dotBg: document.getElementById('dotBg'),
  dotJitter: document.getElementById('dotJitter'),

  // codes/report
  colorCodeMode: document.getElementById('colorCodeMode'),
  codeList: document.getElementById('codeList'),
  exportReport: document.getElementById('exportReport'),
  mailtoLink: document.getElementById('mailtoLink'),

  // projects
  openProjects: document.getElementById('openProjects'),
  closeProjects: document.getElementById('closeProjects'),
  projectsPane: document.getElementById('projectsPane'),
  saveProject: document.getElementById('saveProject'),
  refreshProjects: document.getElementById('refreshProjects'),
  projectsList: document.getElementById('projectsList'),
  exportProject: document.getElementById('exportProject'),
  importProject: document.getElementById('importProject'),
  deleteProject: document.getElementById('deleteProject'),

  // full-screen editor
  openEditor: document.getElementById('openEditor'),
  editorOverlay: document.getElementById('editorOverlay'),
  toolEyedrop: document.getElementById('toolEyedrop'),
  toolLasso: document.getElementById('toolLasso'),
  toolPan: document.getElementById('toolPan'),
  editorDone: document.getElementById('editorDone'),
  editCanvas: document.getElementById('editCanvas'),
  editOverlay: document.getElementById('editOverlay'),
  editorPalette: document.getElementById('editorPalette'),
  lassoChecks: document.getElementById('lassoChecks'),
  lassoSave: document.getElementById('lassoSave'),
  lassoClear: document.getElementById('lassoClear'),
  eyeSwatch: document.getElementById('eyeSwatch'),
  eyeHex: document.getElementById('eyeHex'),
  eyeAdd: document.getElementById('eyeAdd'),
  eyeCancel: document.getElementById('eyeCancel'),
};

/* Inject Vector/Texture panel if missing (prevents “unresponsive button” issues when IDs aren’t in HTML) */
function ensureVectorAndTextureUI() {
  let mappingCard = document.querySelector('section.card h2:nth-of-type(3)')?.closest('.card');
  if (!mappingCard) mappingCard = document.querySelectorAll('.card')[2];

  // Texture / Replace Color Panel
  if (!document.getElementById('texturePanel')) {
    const wrap = document.createElement('section');
    wrap.className = 'card';
    wrap.innerHTML = `
      <h2>4) Texture / Replace one color</h2>
      <div id="texturePanel" class="row">
        <label>Target color
          <select id="txTarget"></select>
        </label>
        <label>Mode
          <select id="txMode">
            <option value="checker">Checker</option>
            <option value="bayer2">Bayer 2×2</option>
            <option value="stripe">Stripe</option>
            <option value="stipple">Stipple</option>
          </select>
        </label>
        <label>Mix A
          <select id="txA"></select>
        </label>
        <label>Mix B
          <select id="txB"></select>
        </label>
        <label class="check"><input id="txLumaAdaptive" type="checkbox" /> Luma-adaptive</label>
        <label>Density <input id="txDensity" type="range" min="0" max="100" value="50" /></label>
        <button id="txAdd" type="button">+ Add rule</button>
        <button id="txClear" class="ghost" type="button">Clear rules</button>
      </div>
      <div class="help">Replace a single mapped color with a 2-color texture using only palette colors. Density controls A:B ratio; luma-adaptive modulates by source brightness.</div>
      <div id="txRulesList" class="tiny-help"></div>
    `;
    mappingCard.parentNode.insertBefore(wrap, mappingCard.nextSibling);
  }

  // Vector Panel
  if (!document.getElementById('vectorPanel')) {
    const wrap = document.createElement('section');
    wrap.className = 'card';
    wrap.innerHTML = `
      <h2>5) Vector (SVG)</h2>
      <div id="vectorPanel" class="row">
        <label>Simplify <input id="vecSimplify" type="range" min="0" max="100" value="35" /></label>
        <label>Min Area <input id="vecMinArea" type="number" min="1" value="8" /></label>
        <label class="check"><input id="vecLockPalette" type="checkbox" checked /> Lock to current palette</label>
        <button id="downloadSvgBtn" type="button" disabled>Export SVG</button>
      </div>
      <div class="tiny-help">Uses <code>Vectorize</code> if present (vector.js), else falls back to <code>ImageTracer</code> if included.</div>
    `;
    mappingCard.parentNode.insertBefore(wrap, mappingCard.nextSibling.nextSibling);
  }

  // Wire local refs
  els.downloadSvgBtn = document.getElementById('downloadSvgBtn');
  els.vecSimplify = document.getElementById('vecSimplify');
  els.vecMinArea = document.getElementById('vecMinArea');
  els.vecLockPalette = document.getElementById('vecLockPalette');

  els.txTarget = document.getElementById('txTarget');
  els.txMode = document.getElementById('txMode');
  els.txA = document.getElementById('txA');
  els.txB = document.getElementById('txB');
  els.txDensity = document.getElementById('txDensity');
  els.txLumaAdaptive = document.getElementById('txLumaAdaptive');
  els.txAdd = document.getElementById('txAdd');
  els.txClear = document.getElementById('txClear');
  els.txRulesList = document.getElementById('txRulesList');
}

/* =============================== Canvases & Contexts =============================== */
const sctx = els.srcCanvas.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas.getContext('2d', { willReadFrequently:true });
sctx.imageSmoothingEnabled = false;
octx.imageSmoothingEnabled = false;

/* =============================== Global State =============================== */
const state = {
  fullBitmap: null,
  fullW: 0,
  fullH: 0,
  exifOrientation: 1,
  codeMode: 'pms',
  regions: [], // {type:'polygon', mask:Uint8Array, allowed:Set<number>} | {x0,y0,x1,y1, allowed:Set<number>}
  textureRules: [], // {targetIdx, mode, aIdx, bIdx, density(0..1), lumaAdaptive}
  selectedProjectId: null,
  undo: [],
  redo: [],
};

/* =============================== Toasts =============================== */
const Toast = {
  host: null,
  show(msg, ms=2200){
    if(!this.host){
      this.host = document.createElement('div');
      this.host.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:16px;display:grid;gap:8px;z-index:99999';
      document.body.appendChild(this.host);
    }
    const t=document.createElement('div');
    t.textContent=msg;
    t.style.cssText='background:#111826cc;border:1px solid #2a3243;color:#e8ecf3;padding:10px 12px;border-radius:10px;backdrop-filter:blur(8px)';
    this.host.appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .25s'; setTimeout(()=>t.remove(),250); }, ms);
  }
};

/* =============================== Storage (Palettes + Projects) =============================== */
const LS_KEYS = { PALETTES:'pm_saved_palettes_v2', PREFS:'pm_prefs_v2' };
const loadSavedPalettes = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS.PALETTES)||'[]'); } catch { return []; } };
const saveSavedPalettes = arr => localStorage.setItem(LS_KEYS.PALETTES, JSON.stringify(arr));
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS.PREFS)||'{}'); } catch { return {}; } };
const savePrefs = obj => localStorage.setItem(LS_KEYS.PREFS, JSON.stringify(obj));

const DB_NAME='palette_mapper_db', DB_STORE='projects';
function openDB(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB_NAME,1); r.onupgradeneeded=()=>{const db=r.result; if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE,{keyPath:'id',autoIncrement:true});}; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
async function dbPutProject(rec){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readwrite'); const st=tx.objectStore(DB_STORE); const r=st.put(rec); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
async function dbGetAll(){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readonly'); const st=tx.objectStore(DB_STORE); const r=st.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
async function dbGet(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readonly'); const st=tx.objectStore(DB_STORE); const r=st.get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
async function dbDelete(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readwrite'); const st=tx.objectStore(DB_STORE); const r=st.delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });}

/* =============================== HEIC + EXIF helpers =============================== */
function isHeicFile(file) {
  const name=(file.name||'').toLowerCase();
  const type=(file.type||'').toLowerCase();
  return name.endsWith('.heic')||name.endsWith('.heif')||type.includes('heic')||type.includes('heif');
}
function heicNotSupportedMessage() {
  alert(`This photo appears to be HEIC/HEIF, which this browser can't decode.\nUse JPG/PNG, or iPhone: Settings → Camera → Formats → “Most Compatible”.`);
}
function isLikelyJpeg(file){
  const t=(file.type||'').toLowerCase();
  const ext=(file.name||'').split('.').pop().toLowerCase();
  return t.includes('jpeg')||t.includes('jpg')||ext==='jpg'||ext==='jpeg';
}
// Minimal EXIF orientation
async function readJpegOrientation(file){
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function() {
      try {
        const view = new DataView(reader.result);
        if (view.getUint16(0, false) !== 0xFFD8) return resolve(1);
        let offset = 2; const length = view.byteLength;
        while (offset < length) {
          const marker = view.getUint16(offset, false); offset += 2;
          if (marker === 0xFFE1) {
            const exifLength = view.getUint16(offset, false); offset += 2;
            if (view.getUint32(offset, false) !== 0x45786966) break;
            offset += 6;
            const tiffOffset = offset;
            const little = view.getUint16(tiffOffset, false) === 0x4949;
            const get16 = (o) => view.getUint16(o, little);
            const get32 = (o) => view.getUint32(o, little);
            const firstIFD = get32(tiffOffset + 4);
            if (firstIFD < 8) return resolve(1);
            const dir = tiffOffset + firstIFD;
            const entries = get16(dir);
            for (let i=0;i<entries;i++){
              const e = dir + 2 + i*12;
              const tag = get16(e);
              if (tag === 0x0112) return resolve(get16(e+8) || 1);
            }
          } else if ((marker & 0xFF00) !== 0xFF00) break;
          else offset += view.getUint16(offset, false);
        }
      } catch {}
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0,256*1024));
  });
}
function getOrientedDims(o, w, h){ return ([5,6,7,8].includes(o) ? {w:h,h:w} : {w,h}); }
function drawImageWithOrientation(ctx, img, targetW, targetH, orientation){
  ctx.save();
  switch (orientation) {
    case 2: ctx.translate(targetW,0); ctx.scale(-1,1); break;
    case 3: ctx.translate(targetW,targetH); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0,targetH); ctx.scale(1,-1); break;
    case 5: ctx.rotate(0.5*Math.PI); ctx.scale(1,-1); break;
    case 6: ctx.rotate(0.5*Math.PI); ctx.translate(0,-targetW); break;
    case 7: ctx.rotate(0.5*Math.PI); ctx.translate(targetH,-targetW); ctx.scale(-1,1); break;
    case 8: ctx.rotate(-0.5*Math.PI); ctx.translate(-targetH,0); break;
  }
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img, 0, 0, targetW, targetH);
  ctx.restore();
}

/* =============================== Helpers =============================== */
const clamp = (v,min,max)=> v<min?min:(v>max?max:v);
const hexToRgb = (hex) => { let h=(hex||'').trim(); if(!h.startsWith('#')) h='#'+h; const m=/^#([0-9a-f]{6})$/i.exec(h); if(!m) return null; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; };
const rgbToHex = (r,g,b) => '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();

function srgbToLinear(u){ u/=255; return (u<=0.04045)? u/12.92 : Math.pow((u+0.055)/1.055,2.4); }
function rgbToXyz(r,g,b){ r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b);
  const x=r*0.4124564 + g*0.3575761 + b*0.1804375;
  const y=r*0.2126729 + g*0.7151522 + b*0.0721750;
  const z=r*0.0193339 + g*0.1191920 + b*0.9503041; return [x,y,z]; }
function xyzToLab(x,y,z){ const Xn=0.95047,Yn=1.0,Zn=1.08883; x/=Xn; y/=Yn; z/=Zn;
  const f=t=>(t>0.008856)?Math.cbrt(t):(7.787*t+16/116); const fx=f(x),fy=f(y),fz=f(z);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
function rgbToLab(r,g,b){ const [x,y,z]=rgbToXyz(r,g,b); return xyzToLab(x,y,z); }
function deltaE2Weighted(l1,l2,wL,wC){ const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2]; return wL*dL*dL + wC*(da*da+db*db); }

/* =============================== Palette UI (with per-color sliders) =============================== */
function paletteRowHTML(hex='#FFFFFF', tol=12, weight=100, name='') {
  return `
    <div class="palette-item">
      <input type="color" value="${hex}">
      <input class="hex" type="text" value="${hex}" placeholder="#RRGGBB">
      <label class="mono">Tol <input class="tol" type="range" min="0" max="50" value="${tol}"><span class="tolOut">${tol}</span></label>
      <label class="mono">Weight <input class="w" type="range" min="50" max="200" value="${weight}"><span class="wOut">${weight}</span></label>
      <input class="nm" type="text" value="${name}" placeholder="name (opt)">
      <button class="ghost up" type="button">↑</button>
      <button class="ghost down" type="button">↓</button>
      <button class="remove" type="button">✕</button>
    </div>`;
}
function addPaletteRow(hex='#FFFFFF', tol=12, weight=100, name='') {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = paletteRowHTML(hex,tol,weight,name);
  const row = wrapper.firstElementChild;
  const color = row.querySelector('input[type=color]');
  const hexI  = row.querySelector('.hex');
  const tolI  = row.querySelector('.tol');
  const tolO  = row.querySelector('.tolOut');
  const wI    = row.querySelector('.w');
  const wO    = row.querySelector('.wOut');
  const up    = row.querySelector('.up');
  const down  = row.querySelector('.down');
  const del   = row.querySelector('.remove');

  const sync = (fromColor)=>{
    if(fromColor) hexI.value = color.value.toUpperCase();
    let v=hexI.value.trim(); if(!v.startsWith('#')) v='#'+v;
    if(/^#([0-9A-Fa-f]{6})$/.test(v)){ color.value=v; hexI.value=v.toUpperCase(); }
    refreshVectorSelectors();
    renderCodeList(); updateMailto(); persistPrefs();
  };
  color.addEventListener('input',()=>sync(true));
  hexI.addEventListener('change',()=>sync(false));
  tolI.addEventListener('input',()=>{ tolO.textContent=tolI.value; });
  wI.addEventListener('input',()=>{ wO.textContent=wI.value; });
  del.addEventListener('click',()=>{ row.remove(); refreshVectorSelectors(); renderCodeList(); updateMailto(); persistPrefs(); });
  up.addEventListener('click',()=>{ const prev = row.previousElementSibling; if(prev) row.parentNode.insertBefore(row, prev); refreshVectorSelectors(); });
  down.addEventListener('click',()=>{ const next = row.nextElementSibling; if(next) row.parentNode.insertBefore(next, row); refreshVectorSelectors(); });

  els.paletteList.appendChild(row);
}
function getPalette(){
  const rows=[...els.paletteList.querySelectorAll('.palette-item')];
  const out=[]; for(const r of rows){
    const hex=r.querySelector('.hex').value.trim();
    const rgb=hexToRgb(hex); if(!rgb) continue;
    const tol=parseInt(r.querySelector('.tol').value,10);
    const w  =parseInt(r.querySelector('.w').value,10);
    const name=(r.querySelector('.nm')?.value||'').trim();
    out.push({ hex: rgbToHex(rgb.r,rgb.g,rgb.b), rgb:[rgb.r,rgb.g,rgb.b], lab: rgbToLab(rgb.r,rgb.g,rgb.b), tol, weight:w, name });
  }
  return out;
}

/* =============================== Saved Palettes & Codes =============================== */
let PMS_LIB = [];
const PMS_CACHE = new Map(); // hex -> {name, hex, deltaE}
async function loadPmsJson(url='pms_solid_coated.json'){
  try { PMS_LIB = await (await fetch(url, {cache:'no-store'})).json(); }
  catch (e) { console.warn('PMS library not loaded', e); PMS_LIB = []; }
}
function nearestPms(hex){
  if (PMS_CACHE.has(hex)) return PMS_CACHE.get(hex);
  if (!PMS_LIB.length) { const out={name:'—',hex,deltaE:0}; PMS_CACHE.set(hex,out); return out; }
  const rgb = hexToRgb(hex); const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
  let best=null, bestD=Infinity;
  for (const sw of PMS_LIB){
    const r2 = hexToRgb(sw.hex); if(!r2) continue;
    const lab2 = rgbToLab(r2.r, r2.g, r2.b);
    const d = deltaE2Weighted(lab, lab2, 1, 1);
    if (d < bestD){ bestD = d; best = { name: sw.name, hex: sw.hex, deltaE: Math.sqrt(d) }; }
  }
  const out = best || { name:'—', hex, deltaE:0 };
  PMS_CACHE.set(hex, out);
  return out;
}
const CODE_MODES = { PMS:'pms', HEX:'hex' };
function currentPaletteCodes(){
  return getPalette().map(c=>{
    if (state.codeMode === CODE_MODES.HEX) return { hex:c.hex, label:c.hex, swatchHex:c.hex };
    const p = nearestPms(c.hex);
    return { hex:c.hex, label:`${p.name} (${p.hex}) ΔE≈${p.deltaE.toFixed(1)}`, swatchHex:p.hex };
  });
}
function renderCodeList(){
  const box = els.codeList; if(!box) return;
  const rows = currentPaletteCodes().map((c,i)=>(
    `<div class="row"><span class="sw" style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #334155;background:${c.swatchHex}"></span>${i+1}. ${c.label}</div>`
  ));
  box.innerHTML = rows.join('') || '<em>No colors</em>';
}
function buildPrinterReportByMode(){
  const items = currentPaletteCodes();
  const lines = [
    'Project: Palette Mapper output',
    `Colors used: ${items.length}`,
    `Code mode: ${state.codeMode.toUpperCase()}`,
    '',
    ...items.map((c,i)=>`${i+1}. ${c.label}`)
  ];
  return lines.join('\n');
}
function updateMailto(){
  const to=''; // optional
  const subject=encodeURIComponent(state.codeMode===CODE_MODES.PMS?'Print job: artwork + PMS palette':'Print job: artwork + HEX palette');
  const preview=buildPrinterReportByMode().split('\n').slice(0,24).join('\n');
  const body=encodeURIComponent(`Hi,\n\nPlease find attached the artwork PNG and palette list.\n\nReport (preview):\n${preview}\n\nThanks!`);
  if(els.mailtoLink) els.mailtoLink.href = `mailto:${to}?subject=${subject}&body=${body}`;
}

/* =============================== Auto Palette (Hybrid) =============================== */
function autoPaletteFromCanvasHybrid(canvas, k = 10) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0,0,w,h).data;

  // 5-bit histogram
  const bins = new Map();
  for (let i = 0; i < img.length; i += 4) {
    const a = img[i+3]; if (a < 16) continue;
    const r = img[i]>>3, g = img[i+1]>>3, b = img[i+2]>>3;
    const key = (r<<10)|(g<<5)|b;
    bins.set(key, (bins.get(key)||0) + 1);
  }
  const seedsCount = Math.min(48, Math.max(k*4, k+4));
  const ranked = [...bins.entries()]
    .sort((a,b)=>b[1]-a[1])
    .slice(0, seedsCount)
    .map(([key])=>{
      const r = ((key>>10)&31)<<3, g=((key>>5)&31)<<3, b=(key&31)<<3;
      return [r,g,b];
    });

  // K-means (centers from ranked)
  const centers = kmeansFromSeeds(img, k, ranked, 8);
  els.paletteList.innerHTML='';
  centers.forEach(([r,g,b])=> addPaletteRow(rgbToHex(r,g,b), 12, 100, 'auto'));
  renderCodeList(); updateMailto(); persistPrefs(); refreshVectorSelectors();
}
function kmeansFromSeeds(data, k, seeds, iters=8){
  const picked=[]; for(let i=0;i<k;i++) picked.push(seeds[Math.floor((i+0.5)*seeds.length/k)]);
  const centers = picked.map(c=>c.slice());
  const n=data.length/4;
  const counts=new Array(k).fill(0); const sums=new Array(k).fill(0).map(()=>[0,0,0]);
  for(let it=0; it<iters; it++){
    counts.fill(0); for(const s of sums){ s[0]=s[1]=s[2]=0; }
    for(let i=0;i<n;i++){
      const a=data[i*4+3]; if(a===0) continue;
      const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
      let best=0, bestD=Infinity;
      for(let c=0;c<k;c++){ const dr=r-centers[c][0], dg=g-centers[c][1], db=b-centers[c][2]; const d=dr*dr+dg*dg+db*db; if(d<bestD){ bestD=d; best=c; } }
      counts[best]++; sums[best][0]+=r; sums[best][1]+=g; sums[best][2]+=b;
    }
    for(let c=0;c<k;c++){ if(counts[c]>0){ centers[c][0]=Math.round(sums[c][0]/counts[c]); centers[c][1]=Math.round(sums[c][1]/counts[c]); centers[c][2]=Math.round(sums[c][2]/counts[c]); } }
  }
  return centers;
}

/* =============================== Regions (Lasso) =============================== */
const editor = { active:false, ectx:null, octx:null, lassoPts:[], lassoActive:false, eyedropTimer:null, currentHex:'#000000' };
function rasterizePolygonToMask(points, targetW, targetH){
  const tmp=document.createElement('canvas'); tmp.width=targetW; tmp.height=targetH; const tctx=tmp.getContext('2d');
  tctx.clearRect(0,0,targetW,targetH); tctx.fillStyle='#fff'; tctx.beginPath();
  const p0=points[0]; tctx.moveTo(Math.round(p0[0]), Math.round(p0[1]));
  for(let i=1;i<points.length;i++){ const p=points[i]; tctx.lineTo(Math.round(p[0]), Math.round(p[1])); }
  tctx.closePath(); tctx.fill();
  const img=tctx.getImageData(0,0,targetW,targetH).data; const mask=new Uint8Array(targetW*targetH);
  for(let i=0;i<mask.length;i++) mask[i]=img[i*4+3]>0?1:0;
  return mask;
}

/* =============================== Mapping Core =============================== */
function allowedAt(x, y, w, effRegions){
  let allowed=null; if (effRegions && effRegions.length){
    const idx=y*w+x;
    for (let ri=effRegions.length-1; ri>=0; ri--){
      const R=effRegions[ri];
      if (R.type==='polygon'){ if (R.mask[idx]){ allowed=R.allowed; break; } }
      else if (x>=R.x0 && x<=R.x1 && y>=R.y0 && y<=R.y1){ allowed=R.allowed; break; }
    }
  } return allowed;
}

function mapToPalette_WithPerColorTol(imgData, paletteObjs, wL=1.0, wC=1.0, dither=false, bgMode='keep', effRegions=[]){
  const w=imgData.width, h=imgData.height, src=imgData.data;
  const out=new ImageData(w,h); out.data.set(src);

  if(bgMode!=='keep'){
    for(let i=0;i<src.length;i+=4){
      if(bgMode==='white'){ out.data[i+3]=255; }
      else if(bgMode==='transparent'){ if(src[i+3]<128) out.data[i+3]=0; }
    }
  }

  const errR=dither?new Float32Array(w*h):null;
  const errG=dither?new Float32Array(w*h):null;
  const errB=dither?new Float32Array(w*h):null;

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx=y*w+x, i4=idx*4; if(out.data[i4+3]===0) continue;
      let r=out.data[i4], g=out.data[i4+1], b=out.data[i4+2];
      if(dither){ r=clamp(Math.round(r+errR[idx]),0,255); g=clamp(Math.round(g+errG[idx]),0,255); b=clamp(Math.round(b+errB[idx]),0,255); }
      const lab=rgbToLab(r,g,b);

      const allowed = allowedAt(x,y,w,effRegions);

      // 1) Per-color tolerance “lock-in”: if within ΔE <= tol, choose that color directly.
      let lockIdx=-1, lockD=Infinity;
      for(let p=0;p<paletteObjs.length;p++){
        if(allowed && !allowed.has(p)) continue;
        const d = Math.sqrt(deltaE2Weighted(lab,paletteObjs[p].lab,wL,wC));
        if(d<=paletteObjs[p].tol && d<lockD){ lockD=d; lockIdx=p; }
      }
      let best = lockIdx;
      // 2) Otherwise, choose by weighted distance (per-color importance/weight lowers distance)
      if(best<0){
        let bestD=Infinity;
        for(let p=0;p<paletteObjs.length;p++){
          if(allowed && !allowed.has(p)) continue;
          const baseD = deltaE2Weighted(lab,paletteObjs[p].lab,wL,wC);
          const weight = paletteObjs[p].weight/100; // 1.0 default; >1 favors this color
          const d2 = baseD / Math.max(0.05, weight);
          if(d2<bestD){ bestD=d2; best=p; }
        }
      }
      const [nr,ng,nb]=paletteObjs[best].rgb;
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
  return out;
}

/* =============================== Texture Mode (replace one color with pattern) =============================== */
function refreshVectorSelectors(){
  // also used for texture dropdowns
  const pal = getPalette();
  const opts = pal.map((c,i)=>`<option value="${i}">${i+1}. ${c.name||c.hex}</option>`).join('');
  if(els.txTarget) els.txTarget.innerHTML = opts;
  if(els.txA) els.txA.innerHTML = opts;
  if(els.txB) els.txB.innerHTML = opts;
}
function listTextureRules(){
  if(!els.txRulesList) return;
  const pal=getPalette();
  els.txRulesList.innerHTML = state.textureRules.length
    ? state.textureRules.map((r,idx)=>`${idx+1}) ${pal[r.targetIdx]?.hex||'?'} → ${r.mode} with ${pal[r.aIdx]?.hex||'?'} & ${pal[r.bIdx]?.hex||'?'} · density=${Math.round(r.density*100)}% ${r.lumaAdaptive?'(luma-adaptive)':''}`).join('<br>')
    : '<em>No texture rules</em>';
}
function applyTextureRules(imgData, paletteObjs, srcRefData=null){
  // srcRefData: optional original image data for luma-adaptive
  const w=imgData.width,h=imgData.height, d=imgData.data;
  const palHexToIdx = new Map(paletteObjs.map((p,i)=>[p.hex,i]));
  // quick id for target pixel’s palette index
  const getIdx = (r,g,b)=>{
    const hex = rgbToHex(r,g,b);
    return palHexToIdx.has(hex) ? palHexToIdx.get(hex) : -1;
  };

  // tiny Bayer 2x2
  const bayer2 = [[0,2],[3,1]]; const b2div = 4;

  for(const rule of state.textureRules){
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i4=(y*w+x)*4; if(d[i4+3]===0) continue;
        const pi = getIdx(d[i4],d[i4+1],d[i4+2]);
        if(pi!==rule.targetIdx) continue;

        // density threshold
        let thr = rule.density; // 0..1
        if(rule.lumaAdaptive && srcRefData){
          const s = srcRefData.data[i4]*0.2126 + srcRefData.data[i4+1]*0.7152 + srcRefData.data[i4+2]*0.0722;
          const l = 1 - (s/255); // darker = more of A (assume A is darker)
          thr = clamp( (rule.density*0.5 + l*0.5), 0, 1 );
        }

        let chooseA = false;
        switch(rule.mode){
          case 'checker': chooseA = ((x+y)&1)===0 ? true : false; break;
          case 'bayer2':  chooseA = ( (bayer2[y&1][x&1]/b2div) < thr ); break;
          case 'stripe':  chooseA = ((x>>0) % 4) < Math.round(thr*4); break; // 0..3 bands
          case 'stipple': chooseA = (Math.random() < thr); break;
          default: chooseA = (Math.random() < thr); break;
        }
        const pick = chooseA ? rule.aIdx : rule.bIdx;
        const [nr,ng,nb] = paletteObjs[pick].rgb;
        d[i4]=nr; d[i4+1]=ng; d[i4+2]=nb; // alpha unchanged
      }
    }
  }
  return imgData;
}

/* =============================== Halftone (unchanged core) =============================== */
function avgColorInCell(data, w, h, x0, y0, sz) {
  let r=0,g=0,b=0,a=0,count=0;
  const x1=Math.min(w, x0+sz), y1=Math.min(h, y0+sz);
  for (let y=y0; y<y1; y++) {
    let i=(y*w + x0)*4;
    for (let x=x0; x<x1; x++, i+=4) {
      const A=data[i+3]; if (A===0) continue;
      r+=data[i]; g+=data[i+1]; b+=data[i+2]; a+=A; count++;
    }
  }
  if (count===0) return {r:255,g:255,b:255,a:0};
  return { r:Math.round(r/count), g:Math.round(g/count), b:Math.round(b/count), a:Math.round(a/count) };
}
function renderHalftone(ctx, imgData, paletteObjs, bgHex, cellSize=6, jitter=false, wL=1.0, wC=1.0, effRegions=[]){
  const w=imgData.width, h=imgData.height, data=imgData.data;
  const pal=paletteObjs;
  const bg=hexToRgb(bgHex)||{r:255,g:255,b:255}; const bgLab=rgbToLab(bg.r,bg.g,b.b);

  ctx.save(); ctx.fillStyle=rgbToHex(bg.r,bg.g,bg.b); ctx.fillRect(0,0,w,h);

  for(let y=0;y<h;y+=cellSize){
    for(let x=0;x<w;x+=cellSize){
      const cell=avgColorInCell(data,w,h,x,y,cellSize); if(cell.a===0) continue;
      const cxPix = clamp(Math.floor(x+cellSize*0.5),0,w-1);
      const cyPix = clamp(Math.floor(y+cellSize*0.5),0,h-1);
      const allowed = allowedAt(cxPix, cyPix, w, effRegions);

      const lab=rgbToLab(cell.r,cell.g,cell.b);
      let best=0, bestD=Infinity, found=false;
      for(let p=0;p<pal.length;p++){
        if(allowed && !allowed.has(p)) continue;
        const d2=deltaE2Weighted(lab,pal[p].lab,wL,wC);
        if(d2<bestD){ bestD=d2; best=p; found=true; }
      }
      if(!found && pal.length) best=0;

      const fg=pal[best];
      // coverage heuristic
      const dFg = Math.sqrt(deltaE2Weighted(lab, fg.lab, wL, wC));
      const dBg = Math.sqrt(deltaE2Weighted(lab, bgLab, wL, wC));
      const eps=1e-6, wFg=1/Math.max(eps,dFg), wBg=1/Math.max(eps,dBg);
      const cov = wFg/(wFg+wBg);

      const maxR=(cellSize*0.5), radius=Math.max(0.4, Math.sqrt(cov)*maxR);
      let cx=x+cellSize*0.5, cy=y+cellSize*0.5;
      if(jitter){ const j=cellSize*0.15; cx+=(Math.random()*2-1)*j; cy+=(Math.random()*2-1)*j; }
      ctx.fillStyle=fg.hex;
      ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
}

/* =============================== Unsharp (edge sharpen) =============================== */
function unsharpMask(imageData, amount=0.35){
  const w=imageData.width, h=imageData.height, src=imageData.data;
  const out=new ImageData(w,h);
  out.data.set(src);
  const k=[0,-1,0,-1,5,-1,0,-1,0];
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      let r=0,g=0,b=0,ki=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++,ki++){
          const i=((y+dy)*w+(x+dx))*4, kv=k[ki];
          r += src[i  ] * kv;
          g += src[i+1] * kv;
          b += src[i+2] * kv;
        }
      }
      const o=(y*w+x)*4;
      out.data[o  ] = clamp(Math.round((1-amount)*src[o  ] + amount*r),0,255);
      out.data[o+1] = clamp(Math.round((1-amount)*src[o+1] + amount*g),0,255);
      out.data[o+2] = clamp(Math.round((1-amount)*src[o+2] + amount*b),0,255);
      out.data[o+3] = src[o+3];
    }
  }
  return out;
}

/* =============================== Image Loading =============================== */
function objectUrlFor(file){ return URL.createObjectURL(file); }
function revokeUrl(url){ try{ URL.revokeObjectURL(url); }catch{} }
function loadImageEl(url){ return new Promise((resolve,reject)=>{ const img=new Image(); img.decoding='async'; img.onload=()=>resolve(img); img.onerror=(e)=>reject(e); img.src=url; }); }
async function handleFile(file){
  try{
    if(!file) return;
    if (isHeicFile(file)) { heicNotSupportedMessage(); return; }
    state.exifOrientation = 1;

    // Fast path
    if (typeof createImageBitmap === 'function') {
      try{
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        state.fullBitmap = bmp; state.fullW = bmp.width; state.fullH = bmp.height; state.exifOrientation = 1;
        drawPreviewFromState(); toggleImageActions(true); Toast.show('Image loaded'); return;
      }catch(e){ console.warn('createImageBitmap failed:', e); }
    }
    // Fallback
    const url = objectUrlFor(file);
    try{
      const img = await loadImageEl(url);
      state.fullBitmap = img;
      state.fullW = img.naturalWidth || img.width; state.fullH = img.naturalHeight || img.height;
      if (isLikelyJpeg(file)) { try { state.exifOrientation = await readJpegOrientation(file); } catch {} }
      else state.exifOrientation = 1;
      drawPreviewFromState(); toggleImageActions(true); Toast.show('Image loaded');
    } finally { revokeUrl(url); }
  } catch(err){
    console.error('Image load error:', err);
    alert('Could not open that image. Try a JPG/PNG.');
  } finally {
    if (els.fileInput) els.fileInput.value='';
    if (els.cameraInput) els.cameraInput.value='';
  }
}
function drawPreviewFromState(){
  const bmp = state.fullBitmap; if(!bmp) return;
  let w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const orient = state.exifOrientation || 1;
  ({w, h} = getOrientedDims(orient, w, h));
  // keep preview modest
  const MAX_PREVIEW_WIDTH = 2000;
  if (w > MAX_PREVIEW_WIDTH) { const s = MAX_PREVIEW_WIDTH / w; w=Math.round(w*s); h=Math.round(h*s); }
  els.srcCanvas.width = w; els.srcCanvas.height = h;
  sctx.clearRect(0,0,w,h); sctx.imageSmoothingEnabled=false;
  if (orient === 1 && bmp instanceof ImageBitmap) sctx.drawImage(bmp,0,0,w,h);
  else drawImageWithOrientation(sctx, bmp, w, h, orient);

  els.outCanvas.width = w; els.outCanvas.height = h;
  octx.clearRect(0,0,w,h); octx.imageSmoothingEnabled=false;
  els.downloadBtn.disabled = true;
  if (els.downloadSvgBtn) els.downloadSvgBtn.disabled = true;

  // Auto palette on load (10 colors)
  setTimeout(()=>{ try{ autoPaletteFromCanvasHybrid(els.srcCanvas, 10); }catch(e){ console.warn('autoPalette failed',e);} }, 0);
}
function toggleImageActions(enable){
  if(els.applyBtn) els.applyBtn.disabled=!enable;
  if(els.autoExtract) els.autoExtract.disabled=!enable;
  if(els.resetBtn) els.resetBtn.disabled=!enable;
}

/* =============================== APPLY: Full-res pipeline =============================== */
function scaleMask(mask,w0,h0,w1,h1){
  const c0=document.createElement('canvas'); c0.width=w0; c0.height=h0; const x0=c0.getContext('2d'); const id0=x0.createImageData(w0,h0);
  for(let i=0;i<w0*h0;i++){ const k=i*4; id0.data[k]=255; id0.data[k+1]=255; id0.data[k+2]=255; id0.data[k+3]=mask[i]?255:0; }
  x0.putImageData(id0,0,0);
  const c1=document.createElement('canvas'); c1.width=w1; c1.height=h1; const x1=c1.getContext('2d'); x1.imageSmoothingEnabled=false; x1.drawImage(c0,0,0,w0,h0,0,0,w1,h1);
  const out=new Uint8Array(w1*h1); const id1=x1.getImageData(0,0,w1,h1).data; for(let i=0;i<w1*h1;i++) out[i]=id1[i*4+3]>0?1:0; return out;
}
function buildEffectiveRegions(procW,procH){
  if(!state.regions.length) return [];
  const srcW=els.srcCanvas.width, srcH=els.srcCanvas.height;
  if (procW===srcW && procH===srcH) {
    return state.regions.map(r=>{
      if(r.type==='polygon') return { type:'polygon', mask:r.mask, allowed:r.allowed };
      return { x0:r.x0,y0:r.y0,x1:r.x1,y1:r.y1, allowed:r.allowed };
    });
  }
  const sx=procW/srcW, sy=procH/srcH;
  return state.regions.map(r=>{
    if(r.type==='polygon'){
      const full=scaleMask(r.mask, srcW, srcH, procW, procH);
      return { type:'polygon', mask:full, allowed:r.allowed };
    }else{
      return { x0:Math.floor(r.x0*sx), y0:Math.floor(r.y0*sy), x1:Math.floor(r.x1*sx), y1:Math.floor(r.y1*sy), allowed:r.allowed };
    }
  });
}

function applyMappingPipeline(){
  const pal=getPalette(); if(!pal.length){ alert('Add at least one color.'); return; }
  const wL=parseInt(els.wLight.value,10)/100, wC=parseInt(els.wChroma.value,10)/100;
  const dither=!!els.useDither.checked, bgMode=els.bgMode.value;

  // 1) Full size processing canvas
  let procCanvas, pctx;
  let usingFull = !!els.keepFullRes?.checked && state.fullBitmap;
  if (usingFull) {
    const baseW = state.fullW, baseH = state.fullH, o = state.exifOrientation || 1;
    const dims = getOrientedDims(o, baseW, baseH);
    procCanvas = document.createElement('canvas');
    procCanvas.width  = dims.w;
    procCanvas.height = dims.h;
    pctx = procCanvas.getContext('2d', { willReadFrequently:true });
    pctx.imageSmoothingEnabled = false;
    if (o === 1 && state.fullBitmap instanceof ImageBitmap) pctx.drawImage(state.fullBitmap, 0, 0);
    else drawImageWithOrientation(pctx, state.fullBitmap, dims.w, dims.h, o);
  } else {
    procCanvas=els.srcCanvas;
    pctx=procCanvas.getContext('2d', { willReadFrequently:true });
    pctx.imageSmoothingEnabled=false;
  }

  // 2) Regions scaled to proc size
  const effRegions = buildEffectiveRegions(procCanvas.width, procCanvas.height);

  const srcData = pctx.getImageData(0,0,procCanvas.width,procCanvas.height);

  // 3) Rendering: halftone OR palette map
  let outFull;
  if (els.useHalftone?.checked) {
    pctx.clearRect(0,0,procCanvas.width,procCanvas.height);
    const cell=clamp(parseInt(els.dotCell?.value||'6',10),3,64);
    const bgHex=(els.dotBg?.value||'#FFFFFF').toUpperCase();
    const jitter=!!els.dotJitter?.checked;
    renderHalftone(pctx, srcData, pal, bgHex, cell, jitter, wL, wC, effRegions);
    outFull = pctx.getImageData(0,0,procCanvas.width,procCanvas.height);
  } else {
    outFull = mapToPalette_WithPerColorTol(srcData, pal, wL, wC, dither, bgMode, effRegions);
    // Texture pass (replace a color)
    if (state.textureRules.length){
      outFull = applyTextureRules(outFull, pal, srcData);
    }
    if (els.sharpenEdges && els.sharpenEdges.checked) outFull = unsharpMask(outFull, 0.35);
  }

  // 4) Downscaled preview (sharp)
  const previewW = Math.min(procCanvas.width, parseInt(els.maxW.value||'1400',10));
  const scale    = previewW / procCanvas.width;
  els.outCanvas.width  = Math.round(procCanvas.width  * scale);
  els.outCanvas.height = Math.round(procCanvas.height * scale);
  octx.clearRect(0,0,els.outCanvas.width,els.outCanvas.height);
  octx.imageSmoothingEnabled = false;

  const tmp = document.createElement('canvas');
  tmp.width = outFull.width;
  tmp.height = outFull.height;
  const tctx = tmp.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = false;
  tctx.putImageData(outFull, 0, 0);

  octx.drawImage(tmp, 0, 0, els.outCanvas.width, els.outCanvas.height);

  els.outCanvas._fullImageData = outFull;
  els.downloadBtn.disabled = false;
  if (els.downloadSvgBtn) els.downloadSvgBtn.disabled = false;
  Toast.show('Mapping applied');
}

/* =============================== Export PNG (scale ×1/×2/×4) =============================== */
function exportPNG(scale=1){
  const full = els.outCanvas._fullImageData;
  if (!full) { alert('Nothing to export yet.'); return; }
  const c = document.createElement('canvas');
  c.width  = full.width * scale;
  c.height = full.height * scale;
  const cx = c.getContext('2d', { willReadFrequently:true });
  cx.imageSmoothingEnabled = false;

  // Draw sharp
  const tmp=document.createElement('canvas'); tmp.width=full.width; tmp.height=full.height;
  tmp.getContext('2d').putImageData(full,0,0);
  cx.drawImage(tmp,0,0,tmp.width,tmp.height,0,0,c.width,c.height);

  c.toBlob(blob=>{
    const a=document.createElement('a');
    a.download=`mapped_fullres${scale>1?`@${scale}x`:''}.png`;
    a.href=URL.createObjectURL(blob);
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  }, 'image/png');
}

/* =============================== Export SVG =============================== */
async function exportSVG(){
  const full=els.outCanvas._fullImageData;
  if(!full){ alert('Nothing to export yet.'); return; }
  // options
  const simplify = (parseInt(els.vecSimplify?.value||'35',10))/100; // 0..1
  const minArea = parseInt(els.vecMinArea?.value||'8',10);
  const lockPal = !!els.vecLockPalette?.checked;
  let svg = '';

  if (window.Vectorize && typeof window.Vectorize.imageDataToSvg==='function'){
    svg = await window.Vectorize.imageDataToSvg(full, {
      simplify,
      minPathArea: minArea,
      palette: lockPal ? getPalette().map(p=>p.hex) : null
    });
  } else if (window.ImageTracer && typeof window.ImageTracer.imagedataToSVG==='function'){
    svg = window.ImageTracer.imagedataToSVG(full, {
      // approximate options
      ltres: Math.max(0.5, simplify*2),
      qtres: Math.max(0.5, simplify*2),
      pathomit: minArea,
      numberofcolors: lockPal ? getPalette().length : 16,
      // lock palette via "palette" hex -> rgb list if available
      palette: lockPal ? getPalette().map(p=>({r:p.rgb[0],g:p.rgb[1],b:p.rgb[2]})) : undefined
    });
  } else {
    alert('No vectorizer found. Include vector.js (Vectorize) or ImageTracer.');
    return;
  }

  const blob=new Blob([svg],{type:'image/svg+xml'});
  const a=document.createElement('a'); a.download='mapped.svg'; a.href=URL.createObjectURL(blob);
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}

/* =============================== Editor (Eyedrop/Lasso/Pan) =============================== */
function openEditor(){
  if(!state.fullBitmap){ alert('Load an image first.'); return; }
  els.editorOverlay?.classList.remove('hidden'); els.editorOverlay?.setAttribute('aria-hidden','false'); editor.active=true;

  const vw=window.innerWidth, vh=window.innerHeight; const rightW=(vw>900)?320:0, toolbarH=46;
  els.editCanvas.width=vw-rightW; els.editCanvas.height=vh-toolbarH;
  els.editOverlay.width=els.editCanvas.width; els.editOverlay.height=els.editCanvas.height;
  editor.ectx=els.editCanvas.getContext('2d',{willReadFrequently:true});
  editor.octx=els.editOverlay.getContext('2d',{willReadFrequently:true});
  editor.ectx.imageSmoothingEnabled=false; editor.octx.imageSmoothingEnabled=false;

  editor.ectx.clearRect(0,0,els.editCanvas.width,els.editCanvas.height);
  editor.ectx.drawImage(els.srcCanvas,0,0,els.editCanvas.width,els.editCanvas.height);

  editor.tool='eyedrop'; setToolActive('toolEyedrop');
  editor.lassoPts=[]; editor.lassoActive=false; drawLassoStroke(false);
  editor.eyedropTimer=null; editor.currentHex='#000000';
  renderEditorPalette(); buildLassoChecks();
  enableEditorEyedrop();
  Toast.show('Eyedrop: press & hold to sample. Lasso: draw region then Save.');
}
function closeEditor(){
  if(!editor.active) return;
  disableEditorEyedrop(); disableEditorLasso();
  editor.active=false; els.editorOverlay?.classList.add('hidden'); els.editorOverlay?.setAttribute('aria-hidden','true');
}
function setToolActive(id){ ['toolEyedrop','toolLasso','toolPan'].forEach(x=>{ const b=document.getElementById(x); if(!b) return; (x===id)? b.classList.add('active'):b.classList.remove('active'); }); }
function renderEditorPalette(){
  if(!els.editorPalette) return; els.editorPalette.innerHTML='';
  getPalette().forEach(c=>{ const sw=document.createElement('span'); sw.className='sw'; sw.style.background=c.hex; sw.title=c.name||c.hex; els.editorPalette.appendChild(sw); });
}
function buildLassoChecks(){
  if(!els.lassoChecks) return; els.lassoChecks.innerHTML='';
  getPalette().forEach((c,idx)=>{ const label=document.createElement('label'); label.innerHTML=`<input type="checkbox" checked>
      <span class="sw" style="width:16px;height:16px;border:1px solid #334155;border-radius:4px;display:inline-block;background:${c.hex}"></span> ${c.name||c.hex}`;
    els.lassoChecks.appendChild(label);
  });
}

/* Eyedrop */
function pickAtEditor(evt){
  const rect=els.editCanvas.getBoundingClientRect();
  const x=Math.floor((evt.clientX-rect.left)*els.editCanvas.width/rect.width);
  const y=Math.floor((evt.clientY-rect.top )*els.editCanvas.height/rect.height);
  const d=editor.ectx.getImageData(x,y,1,1).data;
  return rgbToHex(d[0],d[1],d[2]);
}
function showEye(hex){ if(els.eyeSwatch) els.eyeSwatch.style.background=hex; if(els.eyeHex) els.eyeHex.textContent=hex; }
function eyedropStart(evt){ evt.preventDefault(); clearTimeout(editor.eyedropTimer);
  editor.eyedropTimer=setTimeout(()=>{ editor.currentHex=pickAtEditor(evt); showEye(editor.currentHex);
    const rect=els.editCanvas.getBoundingClientRect();
    const cx=(evt.clientX-rect.left)*els.editCanvas.width/rect.width;
    const cy=(evt.clientY-rect.top )*els.editCanvas.height/rect.height;
    editor.octx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height);
    editor.octx.strokeStyle='#93c5fd'; editor.octx.lineWidth=2; editor.octx.beginPath(); editor.octx.arc(cx,cy,14,0,Math.PI*2); editor.octx.stroke();
  },250);
}
function eyedropMove(evt){ if(editor.eyedropTimer===null) return; evt.preventDefault(); editor.currentHex=pickAtEditor(evt); showEye(editor.currentHex); }
function eyedropEnd(evt){ evt.preventDefault(); clearTimeout(editor.eyedropTimer); editor.eyedropTimer=null; }
function enableEditorEyedrop(){
  els.editCanvas.addEventListener('pointerdown', eyedropStart, {passive:false});
  els.editCanvas.addEventListener('pointermove', eyedropMove, {passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.addEventListener(ev, eyedropEnd, {passive:false}));
}
function disableEditorEyedrop(){
  els.editCanvas.removeEventListener('pointerdown', eyedropStart);
  els.editCanvas.removeEventListener('pointermove', eyedropMove);
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.removeEventListener(ev, eyedropEnd));
}
els?.eyeAdd?.addEventListener('click', ()=>{
  if (!editor.currentHex || !/^#([0-9A-F]{6})$/i.test(editor.currentHex)) {
    const cx = Math.floor(els.editCanvas.width/2);
    const cy = Math.floor(els.editCanvas.height/2);
    const d = editor.ectx.getImageData(cx,cy,1,1).data;
    editor.currentHex = rgbToHex(d[0],d[1],d[2]);
    showEye(editor.currentHex);
  }
  addPaletteRow(editor.currentHex, 12, 100, 'picked');
  renderEditorPalette(); buildLassoChecks(); renderCodeList(); updateMailto(); persistPrefs();
});
els?.eyeCancel?.addEventListener('click', ()=>{ editor.octx?.clearRect(0,0,els.editOverlay.width,els.editOverlay.height); });

/* Lasso */
function enableEditorLasso(){
  els.lassoSave.disabled=true; els.lassoClear.disabled=false;
  els.editCanvas.addEventListener('pointerdown', lassoBegin, {passive:false});
  els.editCanvas.addEventListener('pointermove', lassoMove, {passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.addEventListener(ev, lassoEnd, {passive:false}));
  Toast.show('Draw your region. Tap Save region to constrain allowed colors.');
}
function disableEditorLasso(){
  els.editCanvas.removeEventListener('pointerdown', lassoBegin);
  els.editCanvas.removeEventListener('pointermove', lassoMove);
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.removeEventListener(ev, lassoEnd));
}
function lassoBegin(evt){ evt.preventDefault(); editor.lassoPts=[]; editor.lassoActive=true; addLassoPoint(evt); drawLassoStroke(false); }
function addLassoPoint(evt){
  const rect=els.editCanvas.getBoundingClientRect();
  const x=Math.max(0,Math.min(els.editCanvas.width,  Math.round((evt.clientX-rect.left)*els.editCanvas.width /rect.width  )));
  const y=Math.max(0,Math.min(els.editCanvas.height, Math.round((evt.clientY-rect.top )*els.editCanvas.height/rect.height )));
  editor.lassoPts.push([x,y]);
}
function lassoMove(evt){ if(!editor.lassoActive) return; evt.preventDefault(); addLassoPoint(evt); drawLassoStroke(false); }
function lassoEnd(evt){ if(!editor.lassoActive) return; evt.preventDefault(); editor.lassoActive=false; drawLassoStroke(true); els.lassoSave.disabled=false; }
function drawLassoStroke(close=false){
  const ctx=editor.octx; if(!ctx) return; ctx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height);
  if(editor.lassoPts.length<2) return;
  ctx.lineWidth=2; ctx.strokeStyle='#93c5fd'; ctx.fillStyle='rgba(147,197,253,0.15)';
  ctx.beginPath(); ctx.moveTo(editor.lassoPts[0][0],editor.lassoPts[0][1]);
  for(let i=1;i<editor.lassoPts.length;i++) ctx.lineTo(editor.lassoPts[i][0],editor.lassoPts[i][1]);
  if(close) ctx.closePath(); ctx.stroke(); if(close) ctx.fill();
}
els?.lassoClear?.addEventListener('click', ()=>{ editor.lassoPts=[]; drawLassoStroke(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true; });
els?.lassoSave?.addEventListener('click', ()=>{
  if(!editor.lassoPts.length) return;
  const allowed=new Set();
  [...els.lassoChecks.querySelectorAll('input[type=checkbox]')].forEach((cb,i)=>{ if(cb.checked) allowed.add(i); });
  // map points to srcCanvas resolution
  const sx = els.srcCanvas.width/els.editCanvas.width;
  const sy = els.srcCanvas.height/els.editCanvas.height;
  const ptsFull = editor.lassoPts.map(p=>[Math.round(p[0]*sx), Math.round(p[1]*sy)]);
  const mask=rasterizePolygonToMask(ptsFull, els.srcCanvas.width, els.srcCanvas.height);
  state.regions.push({ type:'polygon', points:ptsFull, mask, allowed });
  alert('Lasso region saved.');
  editor.lassoPts=[]; drawLassoStroke(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true;
});

/* =============================== Buttons / Events =============================== */
function updateWeightsUI(){
  if(els.wChromaOut) els.wChromaOut.textContent = (Number(els.wChroma.value)/100).toFixed(2)+'×';
  if(els.wLightOut) els.wLightOut.textContent = (Number(els.wLight.value)/100).toFixed(2)+'×';
}
function bindEvents(){
  // upload/camera
  els.fileInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); });
  els.cameraInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); });

  // paste
  els.pasteBtn?.addEventListener('click', async ()=>{
    if(!navigator.clipboard || !navigator.clipboard.read){ alert('Clipboard image paste not supported.'); return; }
    try{
      const items=await navigator.clipboard.read();
      for(const item of items){ for(const type of item.types){ if(type.startsWith('image/')){ const blob=await item.getType(type); await handleFile(blob); return; } } }
      alert('No image in clipboard.');
    }catch{ alert('Clipboard read failed.'); }
  });
  // drag & drop
  const prevent=(e)=>{ e.preventDefault(); e.stopPropagation(); };
  ['dragenter','dragover','dragleave','drop'].forEach(ev=>{ window.addEventListener(ev, prevent, { passive:false }); });
  window.addEventListener('drop', (e)=>{ const dt=e.dataTransfer; const f=dt && dt.files && dt.files[0]; if(f) handleFile(f); }, { passive:false });

  // reset
  els.resetBtn?.addEventListener('click', ()=>{ if(state.fullBitmap) drawPreviewFromState(); });

  // palette basic
  els.addColor?.addEventListener('click', ()=>{ addPaletteRow('#FFFFFF',12,100,''); renderCodeList(); updateMailto(); persistPrefs(); refreshVectorSelectors(); });
  els.clearColors?.addEventListener('click', ()=>{ els.paletteList.innerHTML=''; renderCodeList(); updateMailto(); persistPrefs(); refreshVectorSelectors(); });
  els.loadExample?.addEventListener('click', ()=>{ els.paletteList.innerHTML=''; ['#FFFFFF','#B3753B','#5B3A21','#D22C2C','#1D6E2E'].forEach(h=>addPaletteRow(h,12,100,'')); renderCodeList(); updateMailto(); persistPrefs(); refreshVectorSelectors(); });
  els.savePalette?.addEventListener('click', ()=>{
    const name=prompt('Save palette as (optional name):') || `Palette ${Date.now()}`;
    const colors=getPalette().map(p=>p.hex);
    const list=loadSavedPalettes(); list.unshift({name, colors});
    saveSavedPalettes(list.slice(0,50)); renderSavedPalettes();
  });
  els.clearSavedPalettes?.addEventListener('click', ()=>{ if(!confirm('Clear all saved palettes?')) return; saveSavedPalettes([]); renderSavedPalettes(); });

  // auto extract
  els.autoExtract?.addEventListener('click', ()=>{ if(!els.srcCanvas.width){ alert('Load an image first.'); return; } const k=clamp(parseInt(els.kColors.value||'6',10),2,16); autoPaletteFromCanvasHybrid(els.srcCanvas,k); });

  // mapping weights
  ['input','change'].forEach(ev=>{ els.wChroma?.addEventListener(ev, updateWeightsUI); els.wLight?.addEventListener(ev, updateWeightsUI); });

  // apply
  els.applyBtn?.addEventListener('click', applyMappingPipeline);

  // download PNG
  els.downloadBtn?.addEventListener('click', ()=>{
    const scale = Number(prompt('Export scale? 1, 2, or 4', '1')) || 1;
    exportPNG([1,2,4].includes(scale)?scale:1);
  });

  // vector export
  els.downloadSvgBtn?.addEventListener('click', exportSVG);

  // codes UI
  if (els.colorCodeMode){
    els.colorCodeMode.value = state.codeMode;
    els.colorCodeMode.addEventListener('change', ()=>{
      state.codeMode = els.colorCodeMode.value === 'hex' ? CODE_MODES.HEX : CODE_MODES.PMS;
      persistPrefs();
      renderCodeList();
      updateMailto();
    });
  }
  els.exportReport?.addEventListener('click', ()=>{
    const txt = buildPrinterReportByMode();
    const blob = new Blob([txt], {type:'text/plain'});
    const a = document.createElement('a');
    a.download = state.codeMode === CODE_MODES.PMS ? 'pms_report.txt' : 'hex_report.txt';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  });

  // projects pane + actions
  els.openProjects?.addEventListener('click', ()=>setPane(true));
  els.closeProjects?.addEventListener('click', ()=>setPane(false));
  els.refreshProjects?.addEventListener('click', refreshProjectsList);

  els.saveProject?.addEventListener('click', async ()=>{
    if(!state.fullBitmap){ alert('Load an image first.'); return; }
    const name=prompt('Project name?')||`Project ${Date.now()}`;
    // oriented original snapshot
    const o=state.exifOrientation||1;
    const {w:ow,h:oh}=getOrientedDims(o,state.fullW,state.fullH);
    const tmp=document.createElement('canvas'); tmp.width=ow; tmp.height=oh; const tc=tmp.getContext('2d'); tc.imageSmoothingEnabled=false;
    if (o===1 && state.fullBitmap instanceof ImageBitmap) tc.drawImage(state.fullBitmap,0,0,ow,oh);
    else drawImageWithOrientation(tc, state.fullBitmap, ow, oh, o);
    const blob=await new Promise(res=>tmp.toBlob(res,'image/png',0.92));
    const rec={ id: state.selectedProjectId||undefined, name, createdAt:Date.now(), updatedAt:Date.now(), settings:getCurrentSettings(), imageBlob:blob };
    const id=await dbPutProject(rec); state.selectedProjectId=id; await refreshProjectsList(); alert('Saved.');
  });
  els.exportProject?.addEventListener('click', async ()=>{
    const id=state.selectedProjectId; if(!id){ alert('Select a project first.'); return; }
    const rec=await dbGet(id); if(!rec){ alert('Project not found.'); return; }
    const b64=await blobToBase64(rec.imageBlob);
    const out={ name:rec.name, createdAt:rec.createdAt, updatedAt:rec.updatedAt, settings:rec.settings, imageBase64:b64 };
    const blob=new Blob([JSON.stringify(out)],{type:'application/json'}); const a=document.createElement('a'); a.download=(rec.name||'project')+'.json'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  });
  els.importProject?.addEventListener('change', async (e)=>{
    const f=e.target.files?.[0]; if(!f) return; const text=await f.text();
    try{
      const obj=JSON.parse(text);
      if(!obj.imageBase64 || !obj.settings){ alert('Invalid project file.'); return; }
      const blob=base64ToBlob(obj.imageBase64);
      const rec={ name:obj.name||`Imported ${Date.now()}`, createdAt:obj.createdAt||Date.now(), updatedAt:Date.now(), settings:obj.settings, imageBlob:blob };
      const id=await dbPutProject(rec); await refreshProjectsList(); await loadProject(id); setPane(false); alert('Imported.');
    }catch{ alert('Invalid JSON.'); } finally { e.target.value=''; }
  });
  els.deleteProject?.addEventListener('click', async ()=>{
    const id=state.selectedProjectId; if(!id){ alert('Select a project then Delete.'); return; }
    if(!confirm('Delete selected project?')) return; await dbDelete(id); state.selectedProjectId=null; await refreshProjectsList();
  });

  // editor buttons
  els.openEditor?.addEventListener('click', openEditor);
  els.editorDone?.addEventListener('click', closeEditor);
  els.toolEyedrop?.addEventListener('click', ()=>{ setToolActive('toolEyedrop'); disableEditorLasso(); enableEditorEyedrop(); });
  els.toolLasso?.addEventListener('click', ()=>{ setToolActive('toolLasso'); disableEditorEyedrop(); enableEditorLasso(); });
  els.toolPan?.addEventListener('click', ()=>{ setToolActive('toolPan'); disableEditorEyedrop(); disableEditorLasso(); Toast.show('Pan: two-finger drag / trackpad drag.'); });

  // texture UI
  els.txAdd?.addEventListener('click', ()=>{
    const t = parseInt(els.txTarget.value,10);
    const a = parseInt(els.txA.value,10);
    const b = parseInt(els.txB.value,10);
    if(isNaN(t)||isNaN(a)||isNaN(b)){ alert('Select target and mix colors.'); return; }
    state.textureRules.push({
      targetIdx:t, aIdx:a, bIdx:b,
      mode: els.txMode.value||'checker',
      density: clamp(parseInt(els.txDensity.value||'50',10)/100,0,1),
      lumaAdaptive: !!els.txLumaAdaptive.checked
    });
    listTextureRules();
    Toast.show('Texture rule added — Apply mapping to see it.');
  });
  els.txClear?.addEventListener('click', ()=>{ state.textureRules.length=0; listTextureRules(); Toast.show('Texture rules cleared'); });
}

/* =============================== Projects Pane & Helpers =============================== */
function setPane(open){ if(!els.projectsPane) return; els.projectsPane.classList.toggle('open',open); els.projectsPane.setAttribute('aria-hidden',String(!open)); }
async function refreshProjectsList(){
  if(!els.projectsList) return; const arr=await dbGetAll(); arr.sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));
  els.projectsList.innerHTML=''; arr.forEach(rec=>{
    const div=document.createElement('div'); div.className='item'; const d=new Date(rec.updatedAt||rec.createdAt);
    div.innerHTML=`<div><strong>${rec.name||('Project '+rec.id)}</strong><br><small>${d.toLocaleString()}</small></div><div><button class="ghost" data-id="${rec.id}" type="button">Load</button></div>`;
    div.addEventListener('click',()=>{ state.selectedProjectId=rec.id; [...els.projectsList.children].forEach(ch=>ch.classList.remove('selected')); div.classList.add('selected'); });
    div.querySelector('button').addEventListener('click', async (e)=>{ e.stopPropagation(); await loadProject(rec.id); setPane(false); });
    els.projectsList.appendChild(div);
  });
}
async function loadProject(id){
  const rec=await dbGet(id); if(!rec){ alert('Project not found.'); return; }
  const url = URL.createObjectURL(rec.imageBlob);
  const img = await loadImageEl(url);
  URL.revokeObjectURL(url);
  state.fullBitmap=img; state.fullW=img.naturalWidth||img.width; state.fullH=img.naturalHeight||img.height; state.exifOrientation=1;
  drawPreviewFromState(); toggleImageActions(true); applySettings(rec.settings); state.selectedProjectId=id;
}

/* =============================== Settings Persist =============================== */
function getCurrentSettings(){
  return {
    palette: getPalette().map(p=>({hex:p.hex,tol:p.tol,weight:p.weight,name:p.name})),
    maxW: parseInt(els.maxW?.value||'1400',10),
    keepFullRes: !!els.keepFullRes?.checked,
    sharpenEdges: !!els.sharpenEdges?.checked,
    wChroma: parseInt(els.wChroma?.value||'100',10),
    wLight: parseInt(els.wLight?.value||'100',10),
    useDither: !!els.useDither?.checked,
    bgMode: els.bgMode?.value||'keep',
    useHalftone: !!els.useHalftone?.checked,
    dotCell: parseInt(els.dotCell?.value||'6',10),
    dotBg: els.dotBg?.value||'#FFFFFF',
    dotJitter: !!els.dotJitter?.checked,
    codeMode: state.codeMode,
    regions: state.regions.map(r=> r.type==='polygon'
      ? { type:'polygon', points:r.points, allowed:Array.from(r.allowed) }
      : { type:'rect', x0:r.x0,y0:r.y0,x1:r.x1,y1:r.y1, allowed:Array.from(r.allowed) }),
    textureRules: state.textureRules.map(r=>({...r})),
  };
}
function applySettings(s){
  if(!s) return;
  if(s.palette){ els.paletteList.innerHTML=''; s.palette.forEach(p=>addPaletteRow(p.hex, p.tol??12, p.weight??100, p.name||'')); }
  if(s.maxW) els.maxW.value=s.maxW;
  if('keepFullRes' in s && els.keepFullRes) els.keepFullRes.checked=!!s.keepFullRes;
  if('sharpenEdges' in s && els.sharpenEdges) els.sharpenEdges.checked=!!s.sharpenEdges;
  if(s.wChroma) els.wChroma.value=s.wChroma;
  if(s.wLight) els.wLight.value=s.wLight;
  if('useDither' in s) els.useDither.checked=!!s.useDither;
  if(s.bgMode) els.bgMode.value=s.bgMode;
  if('useHalftone' in s && els.useHalftone) els.useHalftone.checked=!!s.useHalftone;
  if(s.dotCell && els.dotCell) els.dotCell.value=s.dotCell;
  if(s.dotBg && els.dotBg) els.dotBg.value=s.dotBg;
  if('dotJitter' in s && els.dotJitter) els.dotJitter.checked=!!s.dotJitter;
  if(s.codeMode) state.codeMode = (s.codeMode === CODE_MODES.HEX ? CODE_MODES.HEX : CODE_MODES.PMS);
  if(Array.isArray(s.textureRules)) state.textureRules = s.textureRules.map(r=>({...r}));
  updateWeightsUI();
  // rebuild regions at current preview resolution
  state.regions.length=0;
  if(s.regions && Array.isArray(s.regions)){
    s.regions.forEach(r=>{
      if(r.type==='polygon'){
        const mask=rasterizePolygonToMask(r.points, els.srcCanvas.width, els.srcCanvas.height);
        state.regions.push({ type:'polygon', points:r.points, mask, allowed:new Set(r.allowed||[]) });
      } else {
        state.regions.push({ x0:r.x0,y0:r.y0,x1:r.x1,y1:r.y1, allowed:new Set(r.allowed||[]) });
      }
    });
  }
  renderCodeList(); updateMailto(); refreshVectorSelectors(); listTextureRules();
}
function persistPrefs(){
  const p = {
    lastPalette: getPalette().map(p=>({hex:p.hex,tol:p.tol,weight:p.weight,name:p.name})),
    keepFullRes: !!els.keepFullRes?.checked,
    sharpenEdges: !!els.sharpenEdges?.checked,
    maxW: parseInt(els.maxW?.value||'1400',10),
    wChroma: parseInt(els.wChroma?.value||'100',10),
    wLight: parseInt(els.wLight?.value||'100',10),
    bgMode: els.bgMode?.value||'keep',
    useDither: !!els.useDither?.checked,
    useHalftone: !!els.useHalftone?.checked,
    dotCell: parseInt(els.dotCell?.value||'6',10),
    dotBg: els.dotBg?.value||'#FFFFFF',
    dotJitter: !!els.dotJitter?.checked,
    codeMode: state.codeMode,
  };
  savePrefs(p);
}

/* =============================== Small utils =============================== */
function blobToBase64(blob){ return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.readAsDataURL(blob); }); }
function base64ToBlob(b64){ const byteChars=atob(b64); const len=byteChars.length; const bytes=new Uint8Array(len); for(let i=0;i<len;i++) bytes[i]=byteChars.charCodeAt(i); return new Blob([bytes],{type:'image/png'}); }

/* =============================== Saved Palettes UI =============================== */
function renderSavedPalettes(){
  if(!els.savedPalettes) return;
  const list=loadSavedPalettes(); els.savedPalettes.innerHTML='';
  list.forEach((p,idx)=>{ const div=document.createElement('div'); div.className='item';
    const sw=p.colors.map(h=>`<span class="sw" title="${h}" style="display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid #334155;background:${h}"></span>`).join('');
    div.innerHTML=`<div><strong>${p.name||('Palette '+(idx+1))}</strong><br><small>${p.colors.join(', ')}</small></div><div>${sw}</div>`;
    div.addEventListener('click',()=>{ els.paletteList.innerHTML=''; p.colors.forEach(h=>addPaletteRow(h,12,100,'')); renderCodeList(); updateMailto(); persistPrefs(); refreshVectorSelectors(); });
    els.savedPalettes.appendChild(div);
  });
}

/* =============================== INIT =============================== */
async function init(){
  ensureVectorAndTextureUI();
  updateWeightsUI();

  // Load prefs
  try{
    const prefs=loadPrefs();
    if(prefs.lastPalette){ els.paletteList.innerHTML=''; prefs.lastPalette.forEach(p=>addPaletteRow(p.hex, p.tol??12, p.weight??100, p.name||'')); }
    else { addPaletteRow('#FFFFFF',12,100,'White'); addPaletteRow('#000000',12,120,'Black'); }
    if(prefs.keepFullRes!==undefined && els.keepFullRes) els.keepFullRes.checked=!!prefs.keepFullRes;
    if(prefs.sharpenEdges!==undefined && els.sharpenEdges) els.sharpenEdges.checked=!!prefs.sharpenEdges;
    if(prefs.maxW) els.maxW.value=prefs.maxW;
    if(prefs.wChroma) els.wChroma.value=prefs.wChroma;
    if(prefs.wLight) els.wLight.value=prefs.wLight;
    if(prefs.bgMode) els.bgMode.value=prefs.bgMode;
    if(prefs.useDither!==undefined) els.useDither.checked=!!prefs.useDither;
    if(prefs.useHalftone!==undefined && els.useHalftone) els.useHalftone.checked=!!prefs.useHalftone;
    if(prefs.dotCell && els.dotCell) els.dotCell.value=prefs.dotCell;
    if(prefs.dotBg && els.dotBg) els.dotBg.value=prefs.dotBg;
    if(prefs.dotJitter!==undefined && els.dotJitter) els.dotJitter.checked=!!prefs.dotJitter;
    state.codeMode = (prefs.codeMode === CODE_MODES.HEX ? CODE_MODES.HEX : CODE_MODES.PMS);
    if (els.colorCodeMode) els.colorCodeMode.value = state.codeMode;
  }catch(e){ console.error('Prefs load error', e); }

  // Load PMS DB (for codes)
  await loadPmsJson();

  // Wire codes UI after PMS is ready
  renderCodeList(); updateMailto();

  // Saved palettes list
  renderSavedPalettes();

  // Refresh texture and vector selectors
  refreshVectorSelectors();
  listTextureRules();

  // Events last (ensures all injected elements exist)
  bindEvents();

  // Enable buttons if an image is already present (rare)
  toggleImageActions(!!state.fullBitmap);

  Toast.show('Tip: Use “Open full-screen editor” → Eyedrop to add palette colors quickly.');
}
window.addEventListener('load', init);
