/* Palette Mapper — Cup Print Helper (APP.JS v10 • Part 1/2)
   Major additions in v10:
   - Per-color Tolerance (ΔE) + Importance (bias) sliders
   - Texture Mode: replace one color with 2-color patterns (checker/stripes/bayer/dots)
   - Edge-aware sharpen for small text/logo edges
   - SVG export hooks (vector.js / Imagetracer)
   - iPhone-friendly Eyedropper flow + toasts & first-use hints
   - Zoom/Pan in full-screen editor (pinch & drag)
   - Light Undo/Redo scaffolding
   NOTE: This file is split into two parts. Scroll to "/* === PART 2 INSERTION POINT === */"
*/

/////////////////////////////// DOM ///////////////////////////////
const els = {
  // Image & canvases
  fileInput: document.getElementById('fileInput'),
  cameraInput: document.getElementById('cameraInput'),
  pasteBtn: document.getElementById('pasteBtn'),
  resetBtn: document.getElementById('resetBtn'),
  maxW: document.getElementById('maxW'),
  keepFullRes: document.getElementById('keepFullRes'),
  sharpenEdges: document.getElementById('sharpenEdges'), // optional checkbox in some themes
  srcCanvas: document.getElementById('srcCanvas'),
  outCanvas: document.getElementById('outCanvas'),

  // Palette
  addColor: document.getElementById('addColor'),
  clearColors: document.getElementById('clearColors'),
  loadExample: document.getElementById('loadExample'),
  paletteList: document.getElementById('paletteList'),
  kColors: document.getElementById('kColors'),
  autoExtract: document.getElementById('autoExtract'),

  // Mapping options
  wChroma: document.getElementById('wChroma'),
  wLight: document.getElementById('wLight'),
  wChromaOut: document.getElementById('wChromaOut'),
  wLightOut: document.getElementById('wLightOut'),
  useDither: document.getElementById('useDither'),
  bgMode: document.getElementById('bgMode'),
  applyBtn: document.getElementById('applyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),

  // Halftone (existing; also reused by Texture Mode “dots”)
  useHalftone: document.getElementById('useHalftone'),
  dotCell: document.getElementById('dotCell'),
  dotBg: document.getElementById('dotBg'),
  dotJitter: document.getElementById('dotJitter'),

  // Projects + saved palettes
  openProjects: document.getElementById('openProjects'),
  closeProjects: document.getElementById('closeProjects'),
  projectsPane: document.getElementById('projectsPane'),
  saveProject: document.getElementById('saveProject'),
  refreshProjects: document.getElementById('refreshProjects'),
  projectsList: document.getElementById('projectsList'),
  exportProject: document.getElementById('exportProject'),
  importProject: document.getElementById('importProject'),
  deleteProject: document.getElementById('deleteProject'),
  savedPalettes: document.getElementById('savedPalettes'),
  savePalette: document.getElementById('savePalette'),
  clearSavedPalettes: document.getElementById('clearSavedPalettes'),

  // Full-screen editor
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

  // Codes UI
  colorCodeMode: document.getElementById('colorCodeMode'),
  codeList: document.getElementById('codeList'),

  // Report/Email
  exportReport: document.getElementById('exportReport'),
  mailtoLink: document.getElementById('mailtoLink'),

  // (New) Vector export controls — you’ll add the button in HTML in this update
  downloadSvgBtn: document.getElementById('downloadSvg'),    // optional if present
  exportScale: document.getElementById('exportScale')        // select: 1× / 2× / 4×
};

const sctx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
const octx = els.outCanvas.getContext('2d', { willReadFrequently: true });
sctx.imageSmoothingEnabled = false;
octx.imageSmoothingEnabled = false;

/////////////////////////////// Toasts ///////////////////////////////
const Toast = (()=> {
  let host = null, showing = false, queue = [];
  function ensureHost(){
    if(host) return;
    host = document.createElement('div');
    host.id = 'toasts';
    host.style.position = 'fixed';
    host.style.left = '50%';
    host.style.transform = 'translateX(-50%)';
    host.style.bottom = '18px';
    host.style.display = 'grid';
    host.style.gap = '8px';
    host.style.zIndex = '99999';
    document.body.appendChild(host);
  }
  function show(msg, ms=2200){
    ensureHost();
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.background = '#111826cc';
    el.style.border = '1px solid #22314a';
    el.style.color = '#e8ecf3';
    el.style.padding = '10px 12px';
    el.style.borderRadius = '10px';
    el.style.backdropFilter = 'blur(8px)';
    el.style.maxWidth = 'min(90vw, 520px)';
    queue.push({el, ms});
    pump();
  }
  function pump(){
    if(showing || !queue.length) return;
    showing = true;
    const {el, ms} = queue.shift();
    host.appendChild(el);
    setTimeout(()=>{
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(()=>{ try{ host.removeChild(el); }catch{} showing=false; pump(); }, 250);
    }, ms);
  }
  return { show };
})();

/////////////////////////////// State ///////////////////////////////
const state = {
  fullBitmap: null,
  fullW: 0,
  fullH: 0,
  exifOrientation: 1,
  selectedProjectId: null,
  codeMode: 'pms',    // 'pms' | 'hex'
  // Texture mode rules (post-pass)
  textureRules: [],   // {targetIndex, pattern, c1Index, c2Index, density, luminance}
  // Undo/Redo (lightweight)
  undo: [], redo: [],
  // Editor view transform
  view: { scale: 1, tx: 0, ty: 0 }
};

const regions = []; // lasso polygons / rects
const editor = {
  active:false, tool:'eyedrop',
  ectx:null, octx:null, lassoPts:[], lassoActive:false,
  eyedropTimer:null, currentHex:'#000000',
  // gestures
  dragging:false, lastX:0, lastY:0, pinchD:0, start: {scale:1, tx:0, ty:0}
};

/////////////////////////////// Constants & Utils ///////////////////////////////
const MAX_PREVIEW_WIDTH = 2000;
const CODE_MODES = { PMS: 'pms', HEX: 'hex' };
const clamp = (v, min, max) => (v < min ? min : (v > max ? max : v));
const hexToRgb = (hex) => { let h=(hex||'').trim(); if(!h.startsWith('#')) h='#'+h; const m=/^#([0-9a-f]{6})$/i.exec(h); if(!m) return null; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; };
const rgbToHex = (r,g,b) => '#' + [r,g,b].map(v=>clamp(v,0,255).toString(16).padStart(2,'0')).join('').toUpperCase();
const fmtMult = n => (Number(n)/100).toFixed(2)+'×';
const inRect = (x,y,r) => x>=r.x0 && x<=r.x1 && y>=r.y0 && y<=r.y1;
const normalizeRect = r => ({ x0:Math.min(r.x0,r.x1), y0:Math.min(r.y0,r.y1), x1:Math.max(r.x0,r.x1), y1:Math.max(r.y0,r.y1) });
const scaleRect = (r,sx,sy)=>({ x0:Math.floor(r.x0*sx), y0:Math.floor(r.y0*sy), x1:Math.floor(r.x1*sx), y1:Math.floor(r.y1*sy) });
const getOrientedDims = (o, w, h) => ([5,6,7,8].includes(o) ? {w:h, h:w} : {w, h});
const debounce = (fn, ms=200)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

/////////////////////////////// Storage ///////////////////////////////
const LS_KEYS = { PALETTES:'pm_saved_palettes_v2', PREFS:'pm_prefs_v2', HINTS:'pm_hints_v1' };
const loadSavedPalettes = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS.PALETTES)||'[]'); } catch { return []; } };
const saveSavedPalettes = arr => localStorage.setItem(LS_KEYS.PALETTES, JSON.stringify(arr));
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS.PREFS)||'{}'); } catch { return {}; } };
const savePrefs = obj => localStorage.setItem(LS_KEYS.PREFS, JSON.stringify(obj));
const loadHints = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS.HINTS)||'{}'); } catch { return {}; } };
const saveHints = obj => localStorage.setItem(LS_KEYS.HINTS, JSON.stringify(obj));

const DB_NAME='palette_mapper_db', DB_STORE='projects';
function openDB(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB_NAME,1); r.onupgradeneeded=()=>{const db=r.result; if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE,{keyPath:'id',autoIncrement:true});}; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
async function dbPutProject(rec){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readwrite'); const st=tx.objectStore(DB_STORE); const r=st.put(rec); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
async function dbGetAll(){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readonly'); const st=tx.objectStore(DB_STORE); const r=st.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
async function dbGet(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readonly'); const st=tx.objectStore(DB_STORE); const r=st.get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
async function dbDelete(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readwrite'); const st=tx.objectStore(DB_STORE); const r=st.delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });}

/////////////////////////////// HEIC & EXIF helpers ///////////////////////////////
function isHeicFile(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif') || type.includes('heic') || type.includes('heif');
}
function heicNotSupportedMessage() {
  alert(
`This photo appears to be HEIC/HEIF, which this browser can't decode into canvas.

Use a JPG/PNG, or on iPhone set: Settings → Camera → Formats → “Most Compatible”.`
  );
}
function isLikelyJpeg(file){
  const t=(file.type||'').toLowerCase();
  const ext=(file.name||'').split('.').pop().toLowerCase();
  return t.includes('jpeg') || t.includes('jpg') || ext==='jpg' || ext==='jpeg';
}
// Minimal EXIF orientation parse (same as before)
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
            if (view.getUint32(offset, false) !== 0x45786966) break; // "Exif"
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
    default: break;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, targetW, targetH);
  ctx.restore();
}

/////////////////////////////// Color math (sRGB → Lab) ///////////////////////////////
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
function deltaE2(l1,l2){ const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2]; return dL*dL + da*da + db*db; }
function deltaE2Weighted(l1,l2,wL=1,wC=1){
  const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2];
  return wL*dL*dL + wC*(da*da+db*db);
}
function buildPaletteLab(pal){ return pal.map(([r,g,b])=>({ rgb:[r,g,b], lab:rgbToLab(r,g,b) })); }

/////////////////////////////// PMS / HEX & report (unchanged logic) ///////////////////////////////
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

/////////////////////////////// Palette UI (with per-color tolerance & importance) ///////////////////////////////
/** Palette row DOM:
 *  Color | HEX | Tolerance ΔE | Importance | Remove
 *  - tolerance (ΔE) 2..40 (default 12)
 *  - importance (bias) 0..200% (default 100)
 */
function addPaletteRow(hex='#FFFFFF', tol=12, weight=100){
  const row=document.createElement('div'); row.className='palette-item';
  row.innerHTML=`
    <input class="pi-color" type="color" value="${hex}" aria-label="color picker">
    <input class="pi-hex"   type="text"  value="${hex}" aria-label="hex code" placeholder="#RRGGBB">
    <label class="pi-tol-wrap">Tol ΔE
      <input class="pi-tol" type="range" min="2" max="40" value="${tol}">
      <span class="pi-tol-out mono">${tol}</span>
    </label>
    <label class="pi-w-wrap">Importance
      <input class="pi-w" type="range" min="0" max="200" value="${weight}">
      <span class="pi-w-out mono">${weight}%</span>
    </label>
    <button class="ghost remove" type="button">Remove</button>
  `;
  const colorInput=row.querySelector('.pi-color');
  const hexInput=row.querySelector('.pi-hex');
  const tolInput=row.querySelector('.pi-tol');
  const tolOut=row.querySelector('.pi-tol-out');
  const wInput=row.querySelector('.pi-w');
  const wOut=row.querySelector('.pi-w-out');
  const delBtn=row.querySelector('.remove');

  function syncFromColor(){
    hexInput.value = colorInput.value.toUpperCase();
    tolOut.textContent = tolInput.value;
    wOut.textContent = wInput.value + '%';
    persistPrefs(); renderCodeList(); updateMailto(); requestPreviewUpdate();
  }
  function syncFromHex(){
    let v=hexInput.value.trim(); if(!v.startsWith('#')) v='#'+v;
    if(/^#([0-9A-Fa-f]{6})$/.test(v)){ colorInput.value=v; hexInput.value=v.toUpperCase(); persistPrefs(); renderCodeList(); updateMailto(); requestPreviewUpdate(); }
  }

  colorInput.addEventListener('input', syncFromColor);
  hexInput.addEventListener('change', syncFromHex);
  tolInput.addEventListener('input', ()=>{ tolOut.textContent=tolInput.value; requestPreviewUpdate(); persistPrefs(); });
  wInput.addEventListener('input', ()=>{ wOut.textContent=wInput.value+'%'; requestPreviewUpdate(); persistPrefs(); });
  delBtn.addEventListener('click',()=>{ row.remove(); renderCodeList(); updateMailto(); persistPrefs(); requestPreviewUpdate(); });

  els.paletteList.appendChild(row);
}
function getPalette(){
  const rows=[...els.paletteList.querySelectorAll('.palette-item')];
  const out=[]; for(const r of rows){
    const hex=(r.querySelector('.pi-hex')?.value||'').trim();
    const rgb=hexToRgb(hex);
    const tol = parseInt(r.querySelector('.pi-tol')?.value||'12',10);
    const w   = parseInt(r.querySelector('.pi-w')?.value||'100',10);
    if(rgb) out.push([rgb.r,rgb.g,rgb.b, tol, w]);
  }
  return out;
}
function setPalette(hexesOrObjects){
  els.paletteList.innerHTML='';
  for(const item of hexesOrObjects){
    if(typeof item === 'string'){ addPaletteRow(item, 12, 100); }
    else if(Array.isArray(item)){ // [hex, tol, weight]
      addPaletteRow(item[0], item[1]??12, item[2]??100);
    }else if(item && item.hex){ addPaletteRow(item.hex, item.tol??12, item.weight??100); }
  }
}
function renderSavedPalettes(){
  if(!els.savedPalettes) return;
  const list=loadSavedPalettes(); els.savedPalettes.innerHTML='';
  list.forEach((p,idx)=>{ const div=document.createElement('div'); div.className='item';
    const sw=p.colors.map(h=>`<span class="sw" title="${h}" style="display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid #334155;background:${h}"></span>`).join('');
    div.innerHTML=`<div><strong>${p.name||('Palette '+(idx+1))}</strong><br><small>${(p.colors||[]).join(', ')}</small></div><div>${sw}</div>`;
    div.addEventListener('click',()=>{ setPalette((p.colors||[]).map(h=>[h,12,100])); renderCodeList(); updateMailto(); persistPrefs(); requestPreviewUpdate(); });
    els.savedPalettes.appendChild(div);
  });
}

/////////////////////////////// Image preview + auto-palette ///////////////////////////////
function drawPreviewFromState(){
  const bmp = state.fullBitmap; if(!bmp) return;
  let w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const orient = state.exifOrientation || 1;
  ({w, h} = getOrientedDims(orient, w, h));
  if (w > MAX_PREVIEW_WIDTH) { const s = MAX_PREVIEW_WIDTH / w; w=Math.round(w*s); h=Math.round(h*s); }
  els.srcCanvas.width = w; els.srcCanvas.height = h;
  sctx.clearRect(0,0,w,h); sctx.imageSmoothingEnabled=false;

  if (orient === 1 && bmp instanceof ImageBitmap) {
    sctx.drawImage(bmp,0,0,w,h);
  } else {
    drawImageWithOrientation(sctx, bmp, w, h, orient);
  }

  els.outCanvas.width = w; els.outCanvas.height = h;
  octx.clearRect(0,0,w,h); octx.imageSmoothingEnabled=false;
  els.downloadBtn.disabled = true;

  setTimeout(() => { try { autoPaletteFromCanvasHybrid(els.srcCanvas, 10); renderCodeList(); updateMailto(); } catch(e){ console.warn('autoPalette failed', e); } }, 0);
}
function toggleImageActions(enable){
  els.applyBtn.disabled=!enable;
  if(els.autoExtract) els.autoExtract.disabled=!enable;
  els.resetBtn.disabled=!enable;
}

/////////////////////////////// Robust Attachment ///////////////////////////////
function objectUrlFor(file){ return URL.createObjectURL(file); }
function revokeUrl(url){ try{ URL.revokeObjectURL(url); }catch{} }
function loadImage(url){
  return new Promise((resolve,reject)=>{
    const img=new Image(); img.decoding='async';
    img.onload=()=>resolve(img); img.onerror=(e)=>reject(e);
    img.src=url;
  });
}
async function handleFile(file, source='file'){
  try{
    if(!file) return;
    if (isHeicFile(file)) { heicNotSupportedMessage(); return; }

    state.exifOrientation = 1;

    if (typeof createImageBitmap === 'function') {
      try{
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        state.fullBitmap = bmp; state.fullW = bmp.width; state.fullH = bmp.height; state.exifOrientation = 1;
        drawPreviewFromState(); toggleImageActions(true);
        Toast.show('Image loaded • Open the editor to pick colors (Long-press to sample).');
        return;
      }catch(e){ console.warn('createImageBitmap failed:', e); }
    }

    const url = objectUrlFor(file);
    try{
      const img = await loadImage(url);
      state.fullBitmap = img;
      state.fullW = img.naturalWidth || img.width; state.fullH = img.naturalHeight || img.height;
      if (isLikelyJpeg(file)) {
        try { state.exifOrientation = await readJpegOrientation(file); } catch {}
      } else { state.exifOrientation = 1; }
      drawPreviewFromState(); toggleImageActions(true);
      Toast.show('Image loaded • Open the editor to pick colors (Long-press to sample).');
    } finally {
      revokeUrl(url);
    }
  } catch(err){
    console.error('Image load error:', err);
    alert('Could not open that image. Try a JPG/PNG or a different photo.');
  } finally {
    if (els.fileInput) els.fileInput.value = '';
    if (els.cameraInput) els.cameraInput.value = '';
  }
}

/////////////////////////////// Hybrid Auto-Palette (same approach) ///////////////////////////////
function kmeans(data,k=5,iters=10){
  const n=data.length/4;
  const centers=[]; for(let c=0;c<k;c++){ const idx=Math.floor((c+0.5)*n/k); centers.push([data[idx*4],data[idx*4+1],data[idx*4+2]]); }
  const counts=new Array(k).fill(0); const sums=new Array(k).fill(0).map(()=>[0,0,0]);
  for(let it=0;it<iters;it++){
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
function kmeansFromSeeds(data, k, seeds, iters=8){
  const picked = [];
  for (let i=0;i<k;i++) picked.push(seeds[Math.floor((i+0.5)*seeds.length/k)]);
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
function autoPaletteFromCanvasHybrid(canvas, k = 10) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0,0,w,h).data;

  // 5-bit histogram (32^3 bins)
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

  const centers = kmeansFromSeeds(img, k, ranked, 8);
  const hexes = centers.map(([r,g,b])=>rgbToHex(r,g,b));
  // default tolerances/weights
  setPalette(hexes.map(h=>[h,12,100]));
}

/////////////////////////////// Codes UI + Report + Email ///////////////////////////////
function currentPaletteCodes(){
  // returns [{hex, label, swatchHex}]
  return getPalette().map(([r,g,b])=>{
    const hex = rgbToHex(r,g,b);
    if (state.codeMode === CODE_MODES.HEX) {
      return { hex, label: hex, swatchHex: hex };
    } else {
      const p = nearestPms(hex);
      return { hex, label: `${p.name} (${p.hex}) ΔE≈${p.deltaE.toFixed(1)}`, swatchHex: p.hex };
    }
  });
}
function renderCodeList(){
  const box = els.codeList;
  if (!box) return;
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
  const to = '';
  const subject = encodeURIComponent(
    state.codeMode === CODE_MODES.PMS ? 'Print job: artwork + PMS palette' : 'Print job: artwork + HEX palette'
  );
  const preview = buildPrinterReportByMode().split('\n').slice(0, 24).join('\n');
  const body = encodeURIComponent(
`Hi,

Please find attached the artwork PNG (full resolution) and a ${
    state.codeMode === CODE_MODES.PMS ? 'PMS' : 'HEX'
} palette list.

${
  state.codeMode === CODE_MODES.PMS
    ? 'PMS matches are nearest by Lab distance; please confirm on press.'
    : 'HEX listed for reference; if you need PMS matches, switch the code mode to PMS.'
}

Report (preview):
${preview}

Thanks!`
  );
  if (els.mailtoLink) els.mailtoLink.href = `mailto:${to}?subject=${subject}&body=${body}`;
}

/////////////////////////////// Editor (full-screen) — Part 1 setup ///////////////////////////////
function setToolActive(id){ ['toolEyedrop','toolLasso','toolPan'].forEach(x=>{ const b=document.getElementById(x); if(!b) return; (x===id)? b.classList.add('active'):b.classList.remove('active'); }); }
function renderEditorPalette(){
  if(!els.editorPalette) return; els.editorPalette.innerHTML='';
  getPalette().forEach(([r,g,b])=>{ const sw=document.createElement('span'); sw.className='sw'; sw.style.background=rgbToHex(r,g,b); els.editorPalette.appendChild(sw); });
}
function buildLassoChecks(){
  if(!els.lassoChecks) return; els.lassoChecks.innerHTML='';
  getPalette().forEach((rgb,idx)=>{ const hex=rgbToHex(rgb[0],rgb[1],rgb[2]);
    const label=document.createElement('label'); label.innerHTML=`<input type="checkbox" checked>
      <span class="sw" style="width:16px;height:16px;border-radius:4px;border:1px solid #334155;display:inline-block;background:${hex}"></span> ${hex}`;
    els.lassoChecks.appendChild(label);
  });
}
function openEditor(){
  if(!state.fullBitmap){ alert('Load an image first.'); return; }
  els.editorOverlay?.classList.remove('hidden'); els.editorOverlay?.setAttribute('aria-hidden','false'); editor.active=true;

  const sidebar = document.querySelector('.editor-right');
  if (sidebar) { sidebar.style.zIndex = 3; sidebar.style.position = 'relative'; }
  if (els.editOverlay) els.editOverlay.style.zIndex = 1;

  const vw=window.innerWidth, vh=window.innerHeight; const rightW=(vw>900)?320:0, toolbarH=46;
  els.editCanvas.width=vw-rightW; els.editCanvas.height=vh-toolbarH;
  els.editOverlay.width=els.editCanvas.width; els.editOverlay.height=els.editCanvas.height;
  editor.ectx=els.editCanvas.getContext('2d',{willReadFrequently:true});
  editor.octx=els.editOverlay.getContext('2d',{willReadFrequently:true});
  editor.ectx.imageSmoothingEnabled=false; editor.octx.imageSmoothingEnabled=false;

  // Reset view transform
  state.view = { scale: 1, tx: 0, ty: 0 };

  redrawEditor();
  editor.tool='eyedrop'; setToolActive('toolEyedrop');
  editor.lassoPts=[]; editor.lassoActive=false; drawLassoStroke(false);
  editor.eyedropTimer=null; editor.currentHex='#000000';
  renderEditorPalette(); buildLassoChecks();

  // First-use hints
  const hints = loadHints();
  if(!hints.editor){
    Toast.show('Tip: Long-press to sample; “Add” puts it in your palette.');
    Toast.show('Lasso: draw a loop → pick allowed colors → Save region.');
    hints.editor = true; saveHints(hints);
  }

  enableEditorEyedrop();
  enableEditorGestures();
}
function closeEditor(){
  if(!editor.active) return;
  disableEditorEyedrop(); disableEditorLasso(); disableEditorGestures();
  editor.active=false; els.editorOverlay?.classList.add('hidden'); els.editorOverlay?.setAttribute('aria-hidden','true');
}
els.openEditor?.addEventListener('click', openEditor);
els.editorDone?.addEventListener('click', closeEditor);
els.toolEyedrop?.addEventListener('click', ()=>{ editor.tool='eyedrop'; setToolActive('toolEyedrop'); disableEditorLasso(); enableEditorEyedrop(); Toast.show('Eyedrop: long-press to pick; tap “Add” to store.'); });
els.toolLasso?.addEventListener('click', ()=>{ editor.tool='lasso'; setToolActive('toolLasso'); disableEditorEyedrop(); enableEditorLasso(); Toast.show('Lasso: draw a closed loop, then “Save region”.'); });
els.toolPan?.addEventListener('click', ()=>{ editor.tool='pan'; setToolActive('toolPan'); disableEditorEyedrop(); disableEditorLasso(); Toast.show('Pan/Zoom: drag to move, pinch to zoom.'); });

function pickAtEditor(evt){
  const rect=els.editCanvas.getBoundingClientRect();
  // inverse transform to sample source correctly when zoomed/panned
  const xCanvas = (evt.clientX-rect.left) * els.editCanvas.width / rect.width;
  const yCanvas = (evt.clientY-rect.top ) * els.editCanvas.height/ rect.height;
  const x = Math.floor((xCanvas - state.view.tx) / state.view.scale);
  const y = Math.floor((yCanvas - state.view.ty) / state.view.scale);
  const d=editor.ectx.getImageData(clamp(x,0,els.editCanvas.width-1), clamp(y,0,els.editCanvas.height-1),1,1).data;
  return rgbToHex(d[0],d[1],d[2]);
}
function showEye(hex){ if(els.eyeSwatch) els.eyeSwatch.style.background=hex; if(els.eyeHex) els.eyeHex.textContent=hex; }
function eyedropStart(evt){ evt.preventDefault(); clearTimeout(editor.eyedropTimer);
  editor.eyedropTimer=setTimeout(()=>{ editor.currentHex=pickAtEditor(evt); showEye(editor.currentHex);
    const rect=els.editCanvas.getBoundingClientRect();
    const xCanvas = (evt.clientX-rect.left) * els.editCanvas.width / rect.width;
    const yCanvas = (evt.clientY-rect.top ) * els.editCanvas.height/ rect.height;
    editor.octx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height);
    editor.octx.strokeStyle='#93c5fd'; editor.octx.lineWidth=2; editor.octx.beginPath(); editor.octx.arc(xCanvas,yCanvas,14,0,Math.PI*2); editor.octx.stroke();
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
els.eyeAdd?.addEventListener('click', ()=>{
  if (!editor.currentHex || !/^#([0-9A-F]{6})$/i.test(editor.currentHex)) {
    const cx = Math.floor(els.editCanvas.width/2);
    const cy = Math.floor(els.editCanvas.height/2);
    const d = editor.ectx.getImageData(cx,cy,1,1).data;
    editor.currentHex = rgbToHex(d[0],d[1],d[2]);
    showEye(editor.currentHex);
  }
  addPaletteRow(editor.currentHex, 12, 100);
  renderEditorPalette(); buildLassoChecks(); renderCodeList(); updateMailto(); persistPrefs(); requestPreviewUpdate();
  Toast.show('Added to palette. Adjust Tolerance & Importance below.');
});
els.eyeCancel?.addEventListener('click', ()=>{ editor.octx?.clearRect(0,0,els.editOverlay.width,els.editOverlay.height); });

/////////////////////////////// Lasso (mask rasterization kept; save in PART 2) ///////////////////////////////
function drawLassoStroke(close=false){
  const ctx=editor.octx; if(!ctx) return; ctx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height);
  if(editor.lassoPts.length<2) return;
  ctx.lineWidth=2; ctx.strokeStyle='#93c5fd'; ctx.fillStyle='rgba(147,197,253,0.15)';
  ctx.beginPath(); ctx.moveTo(editor.lassoPts[0][0],editor.lassoPts[0][1]);
  for(let i=1;i<editor.lassoPts.length;i++) ctx.lineTo(editor.lassoPts[i][0],editor.lassoPts[i][1]);
  if(close) ctx.closePath(); ctx.stroke(); if(close) ctx.fill();
}
function rasterizePolygonToMask(points, targetW, targetH){
  const tmp=document.createElement('canvas'); tmp.width=targetW; tmp.height=targetH; const tctx=tmp.getContext('2d');
  const sW=els.editCanvas.width, sH=els.editCanvas.height; const rx=targetW/sW, ry=targetH/sH;
  tctx.clearRect(0,0,targetW,targetH); tctx.fillStyle='#fff'; tctx.beginPath();
  const p0=points[0]; tctx.moveTo(Math.round(p0[0]*rx), Math.round(p0[1]*ry));
  for(let i=1;i<points.length;i++){ const p=points[i]; tctx.lineTo(Math.round(p[0]*rx), Math.round(p[1]*ry)); }
  tctx.closePath(); tctx.fill();
  const img=tctx.getImageData(0,0,targetW,targetH).data; const mask=new Uint8Array(targetW*targetH);
  for(let i=0;i<mask.length;i++) mask[i]=img[i*4+3]>0?1:0;
  return mask;
}
function enableEditorLasso(){
  els.lassoSave.disabled=true; els.lassoClear.disabled=false;
  els.editCanvas.addEventListener('pointerdown', lassoBegin, {passive:false});
  els.editCanvas.addEventListener('pointermove', lassoMove, {passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.addEventListener(ev, lassoEnd, {passive:false}));
}
function disableEditorLasso(){
  els.editCanvas.removeEventListener('pointerdown', lassoBegin);
  els.editCanvas.removeEventListener('pointermove', lassoMove);
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.removeEventListener(ev, lassoEnd));
}
function lassoBegin(evt){ if(editor.tool!=='lasso') return; evt.preventDefault(); editor.lassoPts=[]; editor.lassoActive=true; addLassoPoint(evt); drawLassoStroke(false); }
function addLassoPoint(evt){
  const rect=els.editCanvas.getBoundingClientRect();
  const x=Math.max(0,Math.min(els.editCanvas.width,  Math.round((evt.clientX-rect.left)*els.editCanvas.width /rect.width  )));
  const y=Math.max(0,Math.min(els.editCanvas.height, Math.round((evt.clientY-rect.top )*els.editCanvas.height/rect.height )));
  editor.lassoPts.push([x,y]);
}
function lassoMove(evt){ if(!editor.lassoActive) return; evt.preventDefault(); addLassoPoint(evt); drawLassoStroke(false); }
function lassoEnd(evt){ if(!editor.lassoActive) return; evt.preventDefault(); editor.lassoActive=false; drawLassoStroke(true); els.lassoSave.disabled=false; }
els.lassoClear?.addEventListener('click', ()=>{ editor.lassoPts=[]; drawLassoStroke(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true; });
els.lassoSave?.addEventListener('click', ()=>{
  if(!editor.lassoPts.length) return;
  const allowed=new Set();
  [...els.lassoChecks.querySelectorAll('input[type=checkbox]')].forEach((cb,i)=>{ if(cb.checked) allowed.add(i); });
  const mask=rasterizePolygonToMask(editor.lassoPts, els.srcCanvas.width, els.srcCanvas.height);
  regions.push({ type:'polygon', points: editor.lassoPts.map(p=>[p[0],p[1]]), mask, allowed });
  Toast.show('Region saved. Pixels inside will only map to the checked colors.');
  editor.lassoPts=[]; drawLassoStroke(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true;
  requestPreviewUpdate();
});

/////////////////////////////// Editor Gestures: Pan & Pinch ///////////////////////////////
function enableEditorGestures(){
  const c = els.editCanvas;
  c.addEventListener('pointerdown', onPointerDown, {passive:false});
  c.addEventListener('pointermove', onPointerMove, {passive:false});
  c.addEventListener('pointerup', onPointerUp, {passive:false});
  c.addEventListener('pointercancel', onPointerUp, {passive:false});
  c.addEventListener('wheel', onWheel, {passive:false});
}
function disableEditorGestures(){
  const c = els.editCanvas;
  c.removeEventListener('pointerdown', onPointerDown);
  c.removeEventListener('pointermove', onPointerMove);
  c.removeEventListener('pointerup', onPointerUp);
  c.removeEventListener('pointercancel', onPointerUp);
  c.removeEventListener('wheel', onWheel);
}
let activePointers = new Map();
function onPointerDown(e){ if(editor.tool!=='pan') return; e.preventDefault(); cSet(e); if(activePointers.size===1){ editor.dragging=true; editor.lastX=e.clientX; editor.lastY=e.clientY; editor.start = {...state.view}; } }
function onPointerMove(e){
  if(editor.tool!=='pan') return; e.preventDefault(); cSet(e);
  if(activePointers.size===2){
    const pts=[...activePointers.values()];
    const d= Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
    if(!editor.pinchD) editor.pinchD=d;
    const scale = clamp(editor.start.scale * (d / editor.pinchD), 0.25, 8);
    const cx=(pts[0].x+pts[1].x)/2, cy=(pts[0].y+pts[1].y)/2;
    const dx = (cx - editor.lastX), dy=(cy - editor.lastY);
    state.view.scale = scale;
    state.view.tx = editor.start.tx + dx;
    state.view.ty = editor.start.ty + dy;
    redrawEditor();
  } else if(editor.dragging){
    const dx = e.clientX - editor.lastX;
    const dy = e.clientY - editor.lastY;
    state.view.tx = editor.start.tx + dx;
    state.view.ty = editor.start.ty + dy;
    redrawEditor();
  }
}
function onPointerUp(e){ if(editor.tool!=='pan') return; e.preventDefault(); cDel(e); if(activePointers.size<2) editor.pinchD=0; if(activePointers.size===0){ editor.dragging=false; } }
function onWheel(e){
  if(editor.tool!=='pan') return; e.preventDefault();
  const delta = Math.sign(e.deltaY) * -0.1;
  const newScale = clamp(state.view.scale * (1+delta), 0.25, 8);
  // Zoom around cursor
  const rect=els.editCanvas.getBoundingClientRect();
  const cx=(e.clientX-rect.left)*els.editCanvas.width/rect.width;
  const cy=(e.clientY-rect.top )*els.editCanvas.height/rect.height;
  const sx = cx - (cx - state.view.tx) * (newScale/state.view.scale);
  const sy = cy - (cy - state.view.ty) * (newScale/state.view.scale);
  state.view.scale = newScale; state.view.tx = sx; state.view.ty = sy;
  redrawEditor();
}
function cSet(e){ activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY}); }
function cDel(e){ activePointers.delete(e.pointerId); }

function redrawEditor(){
  const w=els.editCanvas.width, h=els.editCanvas.height;
  editor.ectx.clearRect(0,0,w,h);
  editor.ectx.save();
  editor.ectx.imageSmoothingEnabled=false;
  editor.ectx.translate(state.view.tx, state.view.ty);
  editor.ectx.scale(state.view.scale, state.view.scale);
  editor.ectx.drawImage(els.srcCanvas,0,0,els.srcCanvas.width,els.srcCanvas.height);
  editor.ectx.restore();
}

/////////////////////////////// Edge-aware Sharpen (kernel only; applied in PART 2) ///////////////////////////////
function unsharpMaskEdgeAware(imageData, amount=0.35, edgeT=28){
  const w=imageData.width, h=imageData.height, src=imageData.data;
  const out=new ImageData(w,h);
  out.data.set(src);

  // Sobel edge magnitude
  const gx=[-1,0,1,-2,0,2,-1,0,1];
  const gy=[-1,-2,-1,0,0,0,1,2,1];
  const mag=new Uint16Array(w*h);
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      let sxr=0, sxg=0, sxb=0, syr=0, syg=0, syb=0, k=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++,k++){
          const i=((y+dy)*w+(x+dx))*4, gxl=gx[k], gyl=gy[k];
          sxr += src[i]*gxl; sxg += src[i+1]*gxl; sxb += src[i+2]*gxl;
          syr += src[i]*gyl; syg += src[i+1]*gyl; syb += src[i+2]*gyl;
        }
      }
      const m = (Math.abs(sxr)+Math.abs(sxg)+Math.abs(sxb)+Math.abs(syr)+Math.abs(syg)+Math.abs(syb))/6;
      mag[y*w+x] = m;
    }
  }

  // Simple sharpen kernel only where edges are strong
  const k3=[0,-1,0,-1,5,-1,0,-1,0];
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      if(mag[y*w+x] < edgeT) continue; // only sharpen on edges
      let r=0,g=0,b=0, ki=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++,ki++){
          const i=((y+dy)*w+(x+dx))*4, kv=k3[ki];
          r += src[i] * kv; g += src[i+1] * kv; b += src[i+2] * kv;
        }
      }
      const o=(y*w+x)*4;
      out.data[o  ] = clamp((1-amount)*src[o  ] + amount*r, 0,255);
      out.data[o+1] = clamp((1-amount)*src[o+1] + amount*g, 0,255);
      out.data[o+2] = clamp((1-amount)*src[o+2] + amount*b, 0,255);
      out.data[o+3] = src[o+3];
    }
  }
  return out;
}

/////////////////////////////// Mapping preview trigger ///////////////////////////////
const requestPreviewUpdate = debounce(()=> {
  // PART 2 will implement: runPaletteMapPreview()
  if(!els.srcCanvas.width) return;
  if(!getPalette().length) return;
  try { runPaletteMapPreview(); } catch(e){ console.warn('preview map pending PART 2', e); }
}, 140);

/////////////////////////////// Wire basic UI (file inputs, palette, codes) ///////////////////////////////
function updateWeightsUI(){ if(els.wChromaOut) els.wChromaOut.textContent=fmtMult(els.wChroma.value); if(els.wLightOut) els.wLightOut.textContent=fmtMult(els.wLight.value); }
function bindEvents(){
  // Upload inputs
  els.fileInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f,'file'); });
  els.cameraInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f,'camera'); });

  // Drag & Drop
  const prevent=(e)=>{ e.preventDefault(); e.stopPropagation(); };
  ['dragenter','dragover','dragleave','drop'].forEach(ev=>{ window.addEventListener(ev, prevent, { passive:false }); });
  window.addEventListener('drop', (e)=>{ const dt=e.dataTransfer; const f=dt && dt.files && dt.files[0]; if(f) handleFile(f,'drop'); }, { passive:false });

  // Paste button
  els.pasteBtn?.addEventListener('click', async ()=>{
    if(!navigator.clipboard || !navigator.clipboard.read){ alert('Clipboard image paste not supported on this browser. Use Upload instead.'); return; }
    try{
      const items=await navigator.clipboard.read();
      for(const item of items){ for(const type of item.types){ if(type.startsWith('image/')){ const blob=await item.getType(type); await handleFile(blob,'paste'); return; } } }
      alert('No image in clipboard.');
    }catch{ alert('Clipboard read failed. Try Upload instead.'); }
  });
  // Ctrl+V paste
  document.addEventListener('paste', async (e)=>{
    try{
      let file=null;
      if(e.clipboardData && e.clipboardData.items){
        for(const it of e.clipboardData.items){ if(it.type && it.type.startsWith('image/')){ file=it.getAsFile(); break; } }
      }
      if(file){ e.preventDefault(); await handleFile(file,'paste'); }
    }catch(err){ console.warn('paste error',err); }
  });

  // Reset
  els.resetBtn?.addEventListener('click', ()=>{ if(!state.fullBitmap) return; drawPreviewFromState(); });

  // Palette
  els.addColor?.addEventListener('click', ()=>{ addPaletteRow('#FFFFFF', 12, 100); renderCodeList(); updateMailto(); persistPrefs(); requestPreviewUpdate(); });
  els.clearColors?.addEventListener('click', ()=>{ els.paletteList.innerHTML=''; renderCodeList(); updateMailto(); persistPrefs(); requestPreviewUpdate(); });
  els.loadExample?.addEventListener('click', ()=>{ setPalette(['#FFFFFF','#B3753B','#5B3A21','#D22C2C','#1D6E2E'].map(h=>[h,12,100])); renderCodeList(); updateMailto(); persistPrefs(); requestPreviewUpdate(); });
  els.savePalette?.addEventListener('click', ()=>{
    const name=prompt('Save palette as (optional name):') || `Palette ${Date.now()}`;
    const colors=getPalette().map(([r,g,b])=>rgbToHex(r,g,b));
    const list=loadSavedPalettes(); list.unshift({name, colors});
    saveSavedPalettes(list.slice(0,50)); renderSavedPalettes();
  });
  els.clearSavedPalettes?.addEventListener('click', ()=>{
    if(!confirm('Clear all saved palettes?')) return; saveSavedPalettes([]); renderSavedPalettes();
  });

  // Manual extractor
  els.autoExtract?.addEventListener('click', ()=>{
    if(!els.srcCanvas.width){ alert('Load an image first.'); return; }
    const k=clamp(parseInt(els.kColors.value||'5',10),2,16);
    const img=sctx.getImageData(0,0,els.srcCanvas.width,els.srcCanvas.height);
    const centers=kmeans(img.data,k,10); setPalette(centers.map(([r,g,b])=>[rgbToHex(r,g,b),12,100]));
    renderCodeList(); updateMailto(); persistPrefs(); requestPreviewUpdate();
  });

  // Weight outputs (kept for global Lab weight; still useful)
  ['input','change'].forEach(ev=>{ els.wChroma?.addEventListener(ev, updateWeightsUI); els.wLight?.addEventListener(ev, updateWeightsUI); });

  // APPLY (full-res) & Download wired in PART 2
}

/////////////////////////////// Settings & Persistence ///////////////////////////////
function getCurrentSettings(){
  return {
    palette: getPalette().map(([r,g,b,tol,weight])=>({ hex: rgbToHex(r,g,b), tol, weight })),
    maxW: parseInt(els.maxW.value,10),
    keepFullRes: !!els.keepFullRes.checked,
    sharpenEdges: !!(els.sharpenEdges && els.sharpenEdges.checked),
    wChroma: parseInt(els.wChroma.value,10),
    wLight: parseInt(els.wLight.value,10),
    useDither: !!els.useDither.checked,
    bgMode: els.bgMode.value,
    useHalftone: !!els.useHalftone?.checked,
    dotCell: parseInt(els.dotCell?.value||'6',10),
    dotBg: els.dotBg?.value || '#FFFFFF',
    dotJitter: !!els.dotJitter?.checked,
    codeMode: state.codeMode,
    regions: regions.map(r=>{
      if(r.type==='polygon'){ return { type:'polygon', points:r.points, allowed:Array.from(r.allowed) }; }
      return { type:'rect', x0:r.x0,y0:r.y0,x1:r.x1,y1:r.y1, allowed:Array.from(r.allowed) };
    }),
    textureRules: state.textureRules.slice()
  };
}
function applySettings(s){
  if(!s) return;
  if(s.palette) setPalette(s.palette.map(p=>[p.hex, p.tol??12, p.weight??100]));
  if(s.maxW) els.maxW.value=s.maxW;
  if('keepFullRes' in s) els.keepFullRes.checked=!!s.keepFullRes;
  if('sharpenEdges' in s && els.sharpenEdges) els.sharpenEdges.checked=!!s.sharpenEdges;
  if(s.wChroma) els.wChroma.value=s.wChroma;
  if(s.wLight) els.wLight.value=s.wLight;
  if('useDither' in s) els.useDither.checked=!!s.useDither;
  if(s.bgMode) els.bgMode.value=s.bgMode;
  if('useHalftone' in s) els.useHalftone.checked=!!s.useHalftone;
  if(s.dotCell) els.dotCell.value=s.dotCell;
  if(s.dotBg) els.dotBg.value=s.dotBg;
  if('dotJitter' in s) els.dotJitter.checked=!!s.dotJitter;
  if(s.codeMode) state.codeMode = (s.codeMode === CODE_MODES.HEX ? CODE_MODES.HEX : CODE_MODES.PMS);
  if(Array.isArray(s.textureRules)) state.textureRules = s.textureRules.slice();
  updateWeightsUI();
  regions.length=0;
  if(s.regions && Array.isArray(s.regions)){
    s.regions.forEach(r=>{
      if(r.type==='polygon'){ const mask=rasterizePolygonToMask(r.points, els.srcCanvas.width, els.srcCanvas.height); regions.push({ type:'polygon', points:r.points, mask, allowed:new Set(r.allowed||[]) }); }
      else { regions.push({ x0:r.x0,y0:r.y0,x1:r.x1,y1:r.y1, allowed:new Set(r.allowed||[]) }); }
    });
  }
  requestPreviewUpdate();
}
function persistPrefs(){
  const p = {
    lastPalette: getPalette().map(([r,g,b,tol,weight])=>({hex:rgbToHex(r,g,b), tol, weight})),
    keepFullRes: els.keepFullRes.checked,
    sharpenEdges: !!(els.sharpenEdges && els.sharpenEdges.checked),
    maxW: parseInt(els.maxW.value,10),
    wChroma: parseInt(els.wChroma.value,10),
    wLight: parseInt(els.wLight.value,10),
    bgMode: els.bgMode.value,
    useDither: els.useDither.checked,
    useHalftone: els.useHalftone?.checked,
    dotCell: parseInt(els.dotCell?.value||'6',10),
    dotBg: els.dotBg?.value||'#FFFFFF',
    dotJitter: !!els.dotJitter?.checked,
    codeMode: state.codeMode,
  };
  savePrefs(p);
}
async function loadProject(id){
  const rec=await dbGet(id); if(!rec){ alert('Project not found.'); return; }
  const url = URL.createObjectURL(rec.imageBlob);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);
  state.fullBitmap=img; state.fullW=img.naturalWidth||img.width; state.fullH=img.naturalHeight||img.height; state.exifOrientation=1;
  drawPreviewFromState(); toggleImageActions(true); applySettings(rec.settings); state.selectedProjectId=id;
}

/////////////////////////////// Blob utils ///////////////////////////////
function blobToBase64(blob){ return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.readAsDataURL(blob); }); }
function base64ToBlob(b64){ const byteChars=atob(b64); const len=byteChars.length; const bytes=new Uint8Array(len); for(let i=0;i<len;i++) bytes[i]=byteChars.charCodeAt(i); return new Blob([bytes],{type:'image/png'}); }

/////////////////////////////// Projects Pane ///////////////////////////////
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

/////////////////////////////// Init ///////////////////////////////
function wireCodesUI(){
  if (els.colorCodeMode) {
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

  // Keep mailto up to date when palette changes
  const observer = new MutationObserver(()=>{ renderCodeList(); updateMailto(); });
  observer.observe(els.paletteList, { childList:true, subtree:true });

  renderCodeList();
  updateMailto();
}
function bindProjectsUI(){
  els.openProjects?.addEventListener('click', ()=>setPane(true));
  els.closeProjects?.addEventListener('click', ()=>setPane(false));
  els.refreshProjects?.addEventListener('click', refreshProjectsList);

  els.saveProject?.addEventListener('click', async ()=>{
    if(!state.fullBitmap){ alert('Load an image first.'); return; }
    const name=prompt('Project name?')||`Project ${Date.now()}`;
    const o=state.exifOrientation||1;
    const {w:ow,h:oh}=getOrientedDims(o,state.fullW,state.fullH);
    const tmp=document.createElement('canvas'); tmp.width=ow; tmp.height=oh; const tc=tmp.getContext('2d');
    tc.imageSmoothingEnabled=false;
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
}
async function init(){
  try{
    const prefs=loadPrefs();
    if(prefs.lastPalette) setPalette(prefs.lastPalette.map(p=>[p.hex, p.tol??12, p.weight??100])); else setPalette(['#FFFFFF','#000000'].map(h=>[h,12,100]));
    if(prefs.keepFullRes!==undefined) els.keepFullRes.checked=!!prefs.keepFullRes;
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

    updateWeightsUI(); renderSavedPalettes();

    await loadPmsJson();
    wireCodesUI();
    refreshProjectsList();
    toggleImageActions(!!state.fullBitmap);

    bindEvents();
    bindProjectsUI();

    // First-use hint on Lasso/Texture
    const hints = loadHints();
    if(!hints.texture){
      Toast.show('Texture Mode: pick a target color and replace it with a 2-color pattern. (Controls in Mapping section)');
      hints.texture = true; saveHints(hints);
    }
  }catch(e){ console.error('Init error:', e); }
}
window.addEventListener('load', init);

/////////////////////////////// Per-color aware mapping core ///////////////////////////////
/** Build a palette descriptor with per-color tolerance & importance bias
 *  Returns: [{rgb:[r,g,b], lab:[L,a,b], tol2:number, weight:number}]
 */
function buildPerColorPalette(){
  return getPalette().map(([r,g,b,tol,weight])=>{
    return {
      rgb:[r,g,b],
      lab: rgbToLab(r,g,b),
      tol2: (tol||12)*(tol||12),
      weight: Math.max(1, weight||100) // 1..200
    };
  });
}

/** Choose nearest palette index considering:
 *    - global Lab weights (wL, wC)
 *    - per-color importance (distance / (weight/100))
 *    - optional region constraint (allowed Set of palette indices)
 *    - optional per-color tolerance cutoff (prefer within tol first)
 */
function choosePaletteIndex(labPix, pal, wL, wC, allowed){
  let best = -1, bestD = Infinity;
  // two-pass: try to satisfy tolerance first
  let bestTol = -1, bestTolD = Infinity;
  for (let i=0;i<pal.length;i++){
    if (allowed && !allowed.has(i)) continue;
    const p = pal[i];
    const d2 = deltaE2Weighted(labPix, p.lab, wL, wC);
    const biased = d2 / (p.weight/100); // higher weight => feels "closer"
    if (d2 <= p.tol2 && biased < bestTolD){ bestTolD = biased; bestTol = i; }
    if (biased < bestD){ bestD = biased; best = i; }
  }
  return (bestTol >= 0) ? bestTol : best;
}

/** Floyd–Steinberg with per-color aware quantizer */
function mapToPalettePerColor(imgData, pal, wL=1, wC=1, dither=false, bgMode='keep', effRegions=[]){
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

      // region constraint
      let allowedSet=null;
      if(effRegions && effRegions.length){
        for(let ri=effRegions.length-1; ri>=0; ri--){
          const R=effRegions[ri];
          if(R.type==='polygon'){ if(R.mask[idx]){ allowedSet=R.allowed; break; } }
          else if(inRect(x,y,R)){ allowedSet=R.allowed; break; }
        }
      }

      const lab=rgbToLab(r,g,b);
      const pIndex = choosePaletteIndex(lab, pal, wL, wC, allowedSet);
      const [nr,ng,nb] = pal[pIndex].rgb;
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

/////////////////////////////// Texture Mode (replace one color with patterns) ///////////////////////////////
// Small pattern helpers
const Bayer4 = [
  [0, 8, 2,10],
  [12, 4,14, 6],
  [3,11, 1, 9],
  [15, 7,13, 5]
];
function patternValue(name, x, y){
  switch(name){
    case 'checker': return ((x&1) ^ (y&1)) ? 1 : 0;
    case 'stripes': return (y & 1) ? 1 : 0;
    case 'bayer4':  return Bayer4[y&3][x&3] / 15; // 0..1
    case 'dots':    {
      // circular mask per 4x4 cell
      const cx=(x&3)-1.5, cy=(y&3)-1.5;
      const r2=cx*cx+cy*cy;
      return r2 < 1.4 ? 1 : 0;
    }
    default: return ((x+y)&1)?1:0;
  }
}
/** Apply post-pass texture rules:
 *  rules: {targetIndex, pattern:'checker'|'stripes'|'bayer4'|'dots', c1Index, c2Index, density:0..1, luminance:boolean}
 *  If luminance===true, density is derived from source luminance (before quantization) rather than fixed density.
 */
function applyTextureRules(imgData, pal, rules, srcRefData=null){
  if(!rules || !rules.length) return imgData;
  const w=imgData.width, h=imgData.height, out=imgData.data;
  const ref = srcRefData ? srcRefData.data : out;

  // Build reverse map hex->index for speed
  const idxOfHex = new Map(pal.map((p,i)=>[rgbToHex(p.rgb[0],p.rgb[1],p.rgb[2]), i]));

  for(const rule of rules){
    const { targetIndex, pattern, c1Index, c2Index, density=0.5, luminance=false } = rule;
    const c1 = pal[c1Index]?.rgb || [0,0,0];
    const c2 = pal[c2Index]?.rgb || [255,255,255];
    const targetHex = pal[targetIndex] ? rgbToHex(...pal[targetIndex].rgb) : null;

    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i4=(y*w+x)*4;
        if(out[i4+3]===0) continue;

        // Is this pixel currently the target palette color?
        const pixHex = rgbToHex(out[i4], out[i4+1], out[i4+2]);
        if(targetHex && pixHex !== targetHex) continue;

        let thr = density;
        if(luminance){
          // derive from source luminance (use ref buffer which may be pre-quantized source)
          const R=ref[i4], G=ref[i4+1], B=ref[i4+2];
          const L = 0.2126*R + 0.7152*G + 0.0722*B; // 0..255
          thr = 1 - (L/255); // darker -> more of c1 (assume c1 is darker)
        }

        const p = patternValue(pattern||'checker', x, y);
        const chooseC1 = (typeof p === 'number') ? (p < thr) : (!!p && thr>=0.5);

        const rgb = chooseC1 ? c1 : c2;
        out[i4]=rgb[0]; out[i4+1]=rgb[1]; out[i4+2]=rgb[2];
      }
    }
  }
  return imgData;
}

/////////////////////////////// Halftone (from earlier build, adapted) ///////////////////////////////
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
function allowedAt(x, y, w, effRegions){
  let allowed=null; if (effRegions && effRegions.length){
    const idx=y*w+x;
    for (let ri=effRegions.length-1; ri>=0; ri--){
      const R=effRegions[ri];
      if (R.type==='polygon'){ if (R.mask[idx]){ allowed=R.allowed; break; } }
      else if (inRect(x,y,R)){ allowed=R.allowed; break; }
    }
  } return allowed;
}
function coverageBetweenColors(cellRGB, fgLab, bgLab, wL, wC) {
  const lab = rgbToLab(cellRGB.r, cellRGB.g, cellRGB.b);
  const dFg = Math.sqrt(deltaE2Weighted(lab, fgLab, wL, wC));
  const dBg = Math.sqrt(deltaE2Weighted(lab, bgLab, wL, wC));
  const eps = 1e-6, wFg = 1/Math.max(eps,dFg), wBg = 1/Math.max(eps,dBg);
  return wFg / (wFg + wBg);
}
function renderHalftone(ctx, imgData, paletteRGB, bgHex, cellSize=6, jitter=false, wL=1.0, wC=1.0, effRegions=[]){
  const w=imgData.width, h=imgData.height, data=imgData.data;
  const palLab=paletteRGB.map(([r,g,b])=>({rgb:[r,g,b], lab:rgbToLab(r,g,b)}));
  const bg=hexToRgb(bgHex)||{r:255,g:255,b:255}; const bgLab=rgbToLab(bg.r,bg.g,b.b);

  ctx.save();
  ctx.fillStyle = rgbToHex(bg.r,bg.g,bg.b);
  ctx.fillRect(0,0,w,h);

  for(let y=0;y<h;y+=cellSize){
    for(let x=0;x<w;x+=cellSize){
      const cell=avgColorInCell(data,w,h,x,y,cellSize); if(cell.a===0) continue;
      const cxPix = clamp(Math.floor(x+cellSize*0.5),0,w-1);
      const cyPix = clamp(Math.floor(y+cellSize*0.5),0,h-1);
      const allowed = allowedAt(cxPix, cyPix, w, effRegions);

      const lab=rgbToLab(cell.r,cell.g,cell.b);
      let best=0, bestD=Infinity, found=false;
      for(let p=0;p<palLab.length;p++){
        if(allowed && !allowed.has(p)) continue;
        const d2=deltaE2Weighted(lab,palLab[p].lab,wL,wC);
        if(d2<bestD){ bestD=d2; best=p; found=true; }
      }
      if(!found && palLab.length) best=0;

      const fg=palLab[best];
      const cov=coverageBetweenColors(cell, fg.lab, bgLab, wL, wC);
      const maxR=(cellSize*0.5), radius=Math.max(0.4, Math.sqrt(cov)*maxR);
      let cx=x+cellSize*0.5, cy=y+cellSize*0.5;
      if(jitter){ const j=cellSize*0.15; cx+=(Math.random()*2-1)*j; cy+=(Math.random()*2-1)*j; }
      ctx.fillStyle=rgbToHex(fg.rgb[0],fg.rgb[1],fg.rgb[2]);
      ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
}

/////////////////////////////// Preview runner ///////////////////////////////
function buildEffectiveRegionsFor(canvasW, canvasH){
  if(!regions.length) return [];
  // here masks are already at preview resolution (saved from editor using srcCanvas dims)
  return regions.map(r=>{
    if(r.type==='polygon'){ return { type:'polygon', mask:r.mask, allowed:r.allowed }; }
    return normalizeRect(r);
  });
}

function runPaletteMapPreview(){
  const w=els.srcCanvas.width, h=els.srcCanvas.height;
  if(!w||!h) return;
  const src = sctx.getImageData(0,0,w,h);
  const pal = buildPerColorPalette();
  const wL=parseInt(els.wLight.value,10)/100, wC=parseInt(els.wChroma.value,10)/100;
  const dither=!!els.useDither.checked, bgMode=els.bgMode.value;
  const effRegions = buildEffectiveRegionsFor(w,h);

  // Quantize to palette (preview)
  let mapped = mapToPalettePerColor(src, pal, wL, wC, dither, bgMode, effRegions);

  // Optional edge-aware sharpen for preview (small amount, keeps UI snappy)
  if (els.sharpenEdges && els.sharpenEdges.checked){
    mapped = unsharpMaskEdgeAware(mapped, 0.3, 28);
  }

  // Apply texture rules (post-pass) on the preview buffer
  if (state.textureRules && state.textureRules.length){
    applyTextureRules(mapped, pal, state.textureRules, src);
  }

  // Render to outCanvas
  els.outCanvas.width = w;
  els.outCanvas.height = h;
  octx.putImageData(mapped, 0, 0);

  // save for exports if we’re not going to recompute — still recompute at full-res on Apply
  els.outCanvas._previewImageData = mapped;
}

/////////////////////////////// Full-res Apply & Export ///////////////////////////////
function scaleMask(mask,w0,h0,w1,h1){
  const c0=document.createElement('canvas'); c0.width=w0; c0.height=h0; const x0=c0.getContext('2d'); const id0=x0.createImageData(w0,h0);
  for(let i=0;i<w0*h0;i++){ const k=i*4; id0.data[k]=255; id0.data[k+1]=255; id0.data[k+2]=255; id0.data[k+3]=mask[i]?255:0; }
  x0.putImageData(id0,0,0);
  const c1=document.createElement('canvas'); c1.width=w1; c1.height=h1; const x1=c1.getContext('2d'); x1.imageSmoothingEnabled=false; x1.drawImage(c0,0,0,w0,h0,0,0,w1,h1);
  const out=new Uint8Array(w1*h1); const id1=x1.getImageData(0,0,w1,h1).data; for(let i=0;i<w1*h1;i++) out[i]=id1[i*4+3]>0?1:0; return out;
}

function applyFullRes(){
  const pal = buildPerColorPalette();
  if(!pal.length){ alert('Add at least one color.'); return; }

  // Build processing canvas at oriented full size OR preview size
  let procCanvas, pctx;
  let usingFull = !!els.keepFullRes.checked && state.fullBitmap;
  let baseW, baseH, orient = state.exifOrientation||1;

  if(usingFull){
    const dims = getOrientedDims(orient, state.fullW, state.fullH);
    baseW=dims.w; baseH=dims.h;
    procCanvas = document.createElement('canvas');
    procCanvas.width  = baseW;
    procCanvas.height = baseH;
    pctx = procCanvas.getContext('2d', { willReadFrequently:true });
    pctx.imageSmoothingEnabled = false;
    if (orient === 1 && state.fullBitmap instanceof ImageBitmap) {
      pctx.drawImage(state.fullBitmap, 0, 0);
    } else {
      drawImageWithOrientation(pctx, state.fullBitmap, baseW, baseH, orient);
    }
  } else {
    procCanvas = els.srcCanvas;
    baseW = procCanvas.width; baseH = procCanvas.height;
    pctx = procCanvas.getContext('2d', { willReadFrequently:true });
    pctx.imageSmoothingEnabled=false;
  }

  // Effective regions scaled to processing canvas resolution
  let effectiveRegions=[];
  if(regions.length){
    if(usingFull){
      const sx=baseW/els.srcCanvas.width, sy=baseH/els.srcCanvas.height;
      effectiveRegions = regions.map(r=>{
        if(r.type==='polygon'){
          const full=scaleMask(r.mask, els.srcCanvas.width, els.srcCanvas.height, baseW, baseH);
          return { type:'polygon', mask:full, allowed:r.allowed };
        } else { return { ...scaleRect(normalizeRect(r), sx, sy), allowed:r.allowed }; }
      });
    } else {
      effectiveRegions = regions.map(r=> r.type==='polygon' ? { type:'polygon', mask:r.mask, allowed:r.allowed } : normalizeRect(r));
    }
  }

  const wL=parseInt(els.wLight.value,10)/100, wC=parseInt(els.wChroma.value,10)/100;
  const dither=!!els.useDither.checked, bgMode=els.bgMode.value;

  // Compute
  const srcData = pctx.getImageData(0,0,baseW,baseH);
  let outFull = mapToPalettePerColor(srcData, pal, wL, wC, dither, bgMode, effectiveRegions);

  // Edge-aware sharpen option
  if (els.sharpenEdges && els.sharpenEdges.checked){
    outFull = unsharpMaskEdgeAware(outFull, 0.35, 28);
  }

  // Texture rules (post-pass)
  if (state.textureRules && state.textureRules.length){
    applyTextureRules(outFull, pal, state.textureRules, srcData);
  }

  // If halftone box is checked, render dots instead of flat palette
  if (els.useHalftone?.checked){
    pctx.clearRect(0,0,baseW,baseH);
    const cell=clamp(parseInt(els.dotCell?.value||'6',10),3,64);
    const bgHex=(els.dotBg?.value||'#FFFFFF').toUpperCase();
    const jitter=!!els.dotJitter?.checked;
    renderHalftone(pctx, outFull, pal.map(p=>p.rgb), bgHex, cell, jitter, wL, wC, effectiveRegions);
    // capture raster
    outFull = pctx.getImageData(0,0,baseW,baseH);
  }

  // Save on outCanvas as preview-scaled view, but _fullImageData holds full res
  const previewW = Math.min(baseW, parseInt(els.maxW.value,10));
  const scale    = previewW / baseW;
  els.outCanvas.width  = Math.round(baseW  * scale);
  els.outCanvas.height = Math.round(baseH * scale);
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

  Toast.show('Mapping applied. Use “Download PNG” for export.');
}

/////////////////////////////// Exports ///////////////////////////////
function exportPng(){
  const full = els.outCanvas._fullImageData || els.outCanvas._previewImageData;
  if (!full) { alert('Nothing to export yet. Click “Apply mapping” first.'); return; }

  // optional scale up
  const scaleSel = els.exportScale && parseInt(els.exportScale.value, 10) || 1;
  const c = document.createElement('canvas');
  c.width  = full.width * scaleSel;
  c.height = full.height * scaleSel;
  const cx = c.getContext('2d', { willReadFrequently:true });
  cx.imageSmoothingEnabled = false;

  // put full data on temp then scale draw
  const tmp = document.createElement('canvas');
  tmp.width=full.width; tmp.height=full.height;
  tmp.getContext('2d').putImageData(full,0,0);
  cx.drawImage(tmp, 0,0, c.width, c.height);

  c.toBlob(blob=>{
    const a=document.createElement('a');
    a.download='mapped_fullres.png';
    a.href=URL.createObjectURL(blob);
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
  }, 'image/png');
}

async function exportSvg(){
  // Requires vector.js (custom) or ImageTracer available globally
  const full = els.outCanvas._fullImageData || els.outCanvas._previewImageData;
  if (!full) { alert('Nothing to vectorize yet. Apply mapping first.'); return; }

  // Prefer custom Vectorize if present
  if (window.Vectorize && typeof window.Vectorize.imageDataToSvg === 'function'){
    const svgText = await window.Vectorize.imageDataToSvg(full, { palette:getPalette().map(([r,g,b])=>rgbToHex(r,g,b)) });
    const blob = new Blob([svgText], {type:'image/svg+xml'});
    const a = document.createElement('a');
    a.download = 'mapped.svg';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    return;
  }

  // Fallback to ImageTracer (if included)
  if (window.ImageTracer){
    // Draw ImageData to a canvas for ImageTracer
    const c=document.createElement('canvas'); c.width=full.width; c.height=full.height;
    c.getContext('2d').putImageData(full,0,0);
    const opt = window.ImageTracer.getoptions ? window.ImageTracer.getoptions() : {};
    // lock palette if available
    opt.pal = { 'custom': getPalette().map(([r,g,b])=>({r,g,b,a:255})) };
    opt.palettes = [ 'custom' ];
    const svgstr = window.ImageTracer.imagedataToSVG(full, opt);
    const blob = new Blob([svgstr], {type:'image/svg+xml'});
    const a = document.createElement('a');
    a.download='mapped.svg';
    a.href=URL.createObjectURL(blob);
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    return;
  }

  alert('Vector export requires vector.js or ImageTracer to be included.');
}

/////////////////////////////// UI wiring for Apply / Download ///////////////////////////////
els.applyBtn?.addEventListener('click', applyFullRes);
els.downloadBtn?.addEventListener('click', exportPng);
els.downloadSvgBtn?.addEventListener('click', exportSvg);

/////////////////////////////// Undo/Redo (light) ///////////////////////////////
function pushUndo(){
  state.undo.push(JSON.stringify(getCurrentSettings()));
  // clear redo when new change
  state.redo.length = 0;
}
function doUndo(){
  if(!state.undo.length) return;
  const cur = JSON.stringify(getCurrentSettings());
  state.redo.push(cur);
  const prev = state.undo.pop();
  try{ applySettings(JSON.parse(prev)); }catch(e){}
}
function doRedo(){
  if(!state.redo.length) return;
  const cur = JSON.stringify(getCurrentSettings());
  state.undo.push(cur);
  const next = state.redo.pop();
  try{ applySettings(JSON.parse(next)); }catch(e){}
}
window.addEventListener('keydown', (e)=>{
  if((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z'){ e.preventDefault(); doUndo(); }
  if((e.ctrlKey||e.metaKey) && (e.shiftKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); doRedo(); }
});

/////////////////////////////// Live preview on slider changes ///////////////////////////////
['input','change'].forEach(ev=>{
  els.wChroma?.addEventListener(ev, requestPreviewUpdate);
  els.wLight?.addEventListener(ev, requestPreviewUpdate);
  els.useDither?.addEventListener(ev, requestPreviewUpdate);
  els.bgMode?.addEventListener(ev, requestPreviewUpdate);
  els.sharpenEdges?.addEventListener(ev, requestPreviewUpdate);
  els.useHalftone?.addEventListener(ev, requestPreviewUpdate);
  els.dotCell?.addEventListener(ev, requestPreviewUpdate);
  els.dotBg?.addEventListener(ev, requestPreviewUpdate);
  els.dotJitter?.addEventListener(ev, requestPreviewUpdate);
});

/////////////////////////////// Done ///////////////////////////////
Toast.show('Ready. Adjust per-color “Tol ΔE” & “Importance”, then Apply.', 2600);
