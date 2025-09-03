/* Palette Mapper — Cup Print Helper (FULL JS, v8)
   Features:
   - Ultra-robust photo attach: Upload (Photo Library), Camera, Drag & Drop, Paste
   - HEIC/HEIF detection + guidance; EXIF orientation for JPEG fallback
   - Auto 10-color palette on load (hybrid histogram+K-means, catches minority colors)
   - Full-screen Editor (Eyedropper w/ preview+Add fix, Lasso regions w/ per-region palette)
   - Palette mapping in perceptual Lab + optional Floyd–Steinberg dithering
   - Halftone dots rendering (cell size, jitter, background) + region support
   - PMS/HEX toggle (default PMS) with nearest PMS lookup (JSON swatch lib)
   - Printer TXT report + email body generator (attach PNG/TXT manually)
   - Full-resolution exports (no blur) + imageSmoothing disabled where needed
   - Projects via IndexedDB (save/export/import/delete) + Saved palettes via localStorage
   - Mobile-friendly; non-passive pointer listeners to avoid iOS Safari highlights
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

  // Halftone
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

  // Legacy region card (kept for IDs)
  regionCard: document.querySelector('.card h2')?.textContent?.toLowerCase().includes('region')
              ? document.querySelector('.card h2')?.closest('.card') : null,
  regionMode: document.getElementById('regionMode'),
  regionClear: document.getElementById('regionClear'),
  regionConfig: document.getElementById('regionConfig'),

  // Full-screen editor overlay
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
};

const sctx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
const octx = els.outCanvas.getContext('2d', { willReadFrequently: true });
sctx.imageSmoothingEnabled = false;
octx.imageSmoothingEnabled = false;

/////////////////////////////// State ///////////////////////////////
const state = {
  fullBitmap: null,     // ImageBitmap or HTMLImageElement (original file)
  fullW: 0,
  fullH: 0,
  exifOrientation: 1,   // 1..8; 1=normal (only used in fallback path)
  selectedProjectId: null,
  codeMode: 'pms',      // 'pms' | 'hex'
};

const regions = []; // lasso polygons or (legacy) rects
/*
  Rect: { x0,y0,x1,y1, allowed:Set<number> }
  Poly: { type:'polygon', points:[[x,y]...](preview coords), mask:Uint8Array, allowed:Set<number> }
*/
const editor = {
  active:false, tool:'eyedrop',
  ectx:null, octx:null, lassoPts:[], lassoActive:false,
  eyedropTimer:null, currentHex:'#000000'
};

/////////////////////////////// Constants & Utils ///////////////////////////////
const MAX_PREVIEW_WIDTH = 2000;
const CODE_MODES = { PMS: 'pms', HEX: 'hex' };

const clamp = (v, min, max) => (v < min ? min : (v > max ? max : v));
const hexToRgb = (hex) => { let h=(hex||'').trim(); if(!h.startsWith('#')) h='#'+h; const m=/^#([0-9a-f]{6})$/i.exec(h); if(!m) return null; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; };
const rgbToHex = (r,g,b) => '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
const fmtMult = n => (Number(n)/100).toFixed(2)+'×';
const inRect = (x,y,r) => x>=r.x0 && x<=r.x1 && y>=r.y0 && y<=r.y1;
const normalizeRect = r => ({ x0:Math.min(r.x0,r.x1), y0:Math.min(r.y0,r.y1), x1:Math.max(r.x0,r.x1), y1:Math.max(r.y0,r.y1) });
const scaleRect = (r,sx,sy)=>({ x0:Math.floor(r.x0*sx), y0:Math.floor(r.y0*sy), x1:Math.floor(r.x1*sx), y1:Math.floor(r.y1*sy) });
const getOrientedDims = (o, w, h) => ([5,6,7,8].includes(o) ? {w:h, h:w} : {w, h});

/////////////////////////////// Storage ///////////////////////////////
const LS_KEYS = { PALETTES:'pm_saved_palettes_v1', PREFS:'pm_prefs_v1' };
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
// Minimal EXIF orientation parse (returns 1..8; 1 if unknown)
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

/////////////////////////////// Palette UI ///////////////////////////////
function addPaletteRow(hex='#FFFFFF'){
  const row=document.createElement('div'); row.className='palette-item';
  row.innerHTML=`
    <input type="color" value="${hex}" aria-label="color picker">
    <input type="text" value="${hex}" aria-label="hex code" placeholder="#RRGGBB">
    <button class="ghost remove" type="button">Remove</button>
  `;
  const colorInput=row.querySelector('input[type=color]');
  const hexInput=row.querySelector('input[type=text]');
  const delBtn=row.querySelector('.remove');
  const sync=(fromColor)=>{
    if(fromColor) hexInput.value = colorInput.value.toUpperCase();
    let v=hexInput.value.trim(); if(!v.startsWith('#')) v='#'+v;
    if(/^#([0-9A-Fa-f]{6})$/.test(v)){ colorInput.value=v; hexInput.value=v.toUpperCase(); }
  };
  colorInput.addEventListener('input',()=>{ sync(true); renderCodeList(); updateMailto(); persistPrefs(); });
  hexInput.addEventListener('change',()=>{ sync(false); renderCodeList(); updateMailto(); persistPrefs(); });
  delBtn.addEventListener('click',()=>{ row.remove(); renderCodeList(); updateMailto(); persistPrefs(); });
  els.paletteList.appendChild(row);
}
function getPalette(){
  const rows=[...els.paletteList.querySelectorAll('.palette-item')];
  const out=[]; for(const r of rows){ const hex=r.querySelector('input[type=text]').value.trim(); const rgb=hexToRgb(hex); if(rgb) out.push([rgb.r,rgb.g,rgb.b]); }
  return out;
}
function setPalette(hexes){ els.paletteList.innerHTML=''; hexes.forEach(h=>addPaletteRow(h)); }
function renderSavedPalettes(){
  if(!els.savedPalettes) return;
  const list=loadSavedPalettes(); els.savedPalettes.innerHTML='';
  list.forEach((p,idx)=>{ const div=document.createElement('div'); div.className='item';
    const sw=p.colors.map(h=>`<span title="${h}" style="display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid #334155;background:${h}"></span>`).join('');
    div.innerHTML=`<div><strong>${p.name||('Palette '+(idx+1))}</strong><br><small>${p.colors.join(', ')}</small></div><div>${sw}</div>`;
    div.addEventListener('click',()=>{ setPalette(p.colors); renderCodeList(); updateMailto(); persistPrefs(); });
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

  // Auto 10-color palette (hybrid)
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
        drawPreviewFromState(); toggleImageActions(true); return;
      }catch(e){ console.warn('createImageBitmap failed:', e); }
    }

    // Fallback: <img> + EXIF orientation for JPEG
    const url = objectUrlFor(file);
    try{
      const img = await loadImage(url);
      state.fullBitmap = img;
      state.fullW = img.naturalWidth || img.width; state.fullH = img.naturalHeight || img.height;
      if (isLikelyJpeg(file)) {
        try { state.exifOrientation = await readJpegOrientation(file); } catch {}
      } else { state.exifOrientation = 1; }
      drawPreviewFromState(); toggleImageActions(true);
    } finally {
      revokeUrl(url);
    }
  } catch(err){
    console.error('Image load error:', err);
    alert('Could not open that image. Try a JPG/PNG or a different photo.');
  } finally {
    // allow re-selecting same file
    if (els.fileInput) els.fileInput.value = '';
    if (els.cameraInput) els.cameraInput.value = '';
  }
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
function deltaE2Weighted(l1,l2,wL,wC){ const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2]; return wL*dL*dL + wC*(da*da+db*db); }
function buildPaletteLab(pal){ return pal.map(([r,g,b])=>({ rgb:[r,g,b], lab:rgbToLab(r,g,b) })); }

/////////////////////////////// Mapping (palette or halftone) ///////////////////////////////
function mapToPalette(imgData, palette, wL=1.0, wC=1.0, dither=false, bgMode='keep', effRegions=[]){
  const w=imgData.width, h=imgData.height, src=imgData.data;
  const out=new ImageData(w,h); out.data.set(src);

  if(bgMode!=='keep'){
    for(let i=0;i<src.length;i+=4){
      if(bgMode==='white'){ out.data[i+3]=255; }
      else if(bgMode==='transparent'){ if(src[i+3]<128) out.data[i+3]=0; }
    }
  }

  const palLab=buildPaletteLab(palette);
  const errR=dither?new Float32Array(w*h):null;
  const errG=dither?new Float32Array(w*h):null;
  const errB=dither?new Float32Array(w*h):null;

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx=y*w+x, i4=idx*4; if(out.data[i4+3]===0) continue;
      let r=out.data[i4], g=out.data[i4+1], b=out.data[i4+2];
      if(dither){ r=clamp(Math.round(r+errR[idx]),0,255); g=clamp(Math.round(g+errG[idx]),0,255); b=clamp(Math.round(b+errB[idx]),0,255); }

      let allowedSet=null;
      if(effRegions && effRegions.length){
        for(let ri=effRegions.length-1; ri>=0; ri--){
          const R=effRegions[ri];
          if(R.type==='polygon'){ if(R.mask[idx]){ allowedSet=R.allowed; break; } }
          else if(inRect(x,y,R)){ allowedSet=R.allowed; break; }
        }
      }

      const lab=rgbToLab(r,g,b);
      let best=0, bestD=Infinity;
      for(let p=0;p<palLab.length;p++){
        if(allowedSet && !allowedSet.has(p)) continue;
        const d2=deltaE2Weighted(lab,palLab[p].lab,wL,wC);
        if(d2<bestD){ bestD=d2; best=p; }
      }
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
  return out;
}

// Halftone helpers
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
function coverageBetweenColors(cellRGB, fgLab, bgLab, wL, wC) {
  const lab = rgbToLab(cellRGB.r, cellRGB.g, cellRGB.b);
  const dFg = Math.sqrt(deltaE2Weighted(lab, fgLab, wL, wC));
  const dBg = Math.sqrt(deltaE2Weighted(lab, bgLab, wL, wC));
  const eps = 1e-6, wFg = 1/Math.max(eps,dFg), wBg = 1/Math.max(eps,dBg);
  return wFg / (wFg + wBg);
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
function renderHalftone(ctx, imgData, palette, bgHex, cellSize=6, jitter=false, wL=1.0, wC=1.0, effRegions=[]){
  const w=imgData.width, h=imgData.height, data=imgData.data;
  const palLab=buildPaletteLab(palette);
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

/////////////////////////////// K-means + Hybrid Auto Palette ///////////////////////////////
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
function sampleImageDataForClustering(ctx, w, h, targetPixels = 120000) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / targetPixels)));
  const outW = Math.floor(w / step), outH = Math.floor(h / step);
  const sampled = new Uint8ClampedArray(outW * outH * 4);
  let si = 0;
  for (let y = 0; y < h; y += step) {
    const row = ctx.getImageData(0, y, w, 1).data;
    for (let x = 0; x < w; x += step) {
      const i = x * 4;
      sampled[si++] = row[i];
      sampled[si++] = row[i + 1];
      sampled[si++] = row[i + 2];
      sampled[si++] = row[i + 3];
    }
  }
  return sampled;
}
function countClusterSizes(centers, data) {
  const counts = new Array(centers.length).fill(0);
  const n = data.length / 4;
  for (let i = 0; i < n; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2], a = data[i*4+3];
    if (a === 0) continue;
    let best = 0, bestD = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const dr = r - centers[c][0], dg = g - centers[c][1], db = b - centers[c][2];
      const d = dr*dr + dg*dg + db*db;
      if (d < bestD) { bestD = d; best = c; }
    }
    counts[best]++;
  }
  return counts;
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

  // 1) 5-bit histogram
  const bins = new Map(); // 32x32x32 grid
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

  // 3) short K-means from seeds → k finals
  const dataForKm = new Uint8ClampedArray(w*h*4);
  dataForKm.set(img);
  const centers = kmeansFromSeeds(dataForKm, k, ranked, 8);
  const hexes = centers.map(([r,g,b])=>rgbToHex(r,g,b));
  setPalette(hexes);
}

/////////////////////////////// PMS / HEX display & reporting ///////////////////////////////
let PMS_LIB = [];
const PMS_CACHE = new Map(); // hex -> {name, hex, deltaE}

async function loadPmsJson(url='pms_solid_coated.json'){
  try {
    PMS_LIB = await (await fetch(url, {cache:'no-store'})).json();
  } catch (e) {
    console.warn('PMS library not loaded', e);
    PMS_LIB = [];
  }
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
  const to = ''; // optional default printer email
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

/////////////////////////////// Editor (full-screen) ///////////////////////////////
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

  // Ensure editor sidebar is above overlay so buttons are clickable (z-index via style hook)
  const sidebar = document.querySelector('.editor-right');
  if (sidebar) { sidebar.style.zIndex = 3; sidebar.style.position = 'relative'; }
  if (els.editOverlay) els.editOverlay.style.zIndex = 1;

  const vw=window.innerWidth, vh=window.innerHeight; const rightW=(vw>900)?320:0, toolbarH=50;
  els.editCanvas.width=vw-rightW; els.editCanvas.height=vh-toolbarH;
  els.editOverlay.width=els.editCanvas.width; els.editOverlay.height=els.editCanvas.height;
  editor.ectx=els.editCanvas.getContext('2d',{willReadFrequently:true});
  editor.octx=els.editOverlay.getContext('2d',{willReadFrequently:true});
  editor.ectx.imageSmoothingEnabled=false;
  editor.octx.imageSmoothingEnabled=false;

  // Draw the current preview into editor space
  editor.ectx.clearRect(0,0,els.editCanvas.width,els.editCanvas.height);
  editor.ectx.drawImage(els.srcCanvas,0,0,els.editCanvas.width,els.editCanvas.height);

  editor.tool='eyedrop'; setToolActive('toolEyedrop');
  editor.lassoPts=[]; editor.lassoActive=false; drawLassoStroke(false);
  editor.eyedropTimer=null; editor.currentHex='#000000';
  renderEditorPalette(); buildLassoChecks();
  enableEditorEyedrop();
}
function closeEditor(){
  if(!editor.active) return;
  disableEditorEyedrop(); disableEditorLasso();
  editor.active=false; els.editorOverlay?.classList.add('hidden'); els.editorOverlay?.setAttribute('aria-hidden','true');
}
els.openEditor?.addEventListener('click', openEditor);
els.editorDone?.addEventListener('click', closeEditor);
els.toolEyedrop?.addEventListener('click', ()=>{ editor.tool='eyedrop'; setToolActive('toolEyedrop'); disableEditorLasso(); enableEditorEyedrop(); });
els.toolLasso?.addEventListener('click', ()=>{ editor.tool='lasso'; setToolActive('toolLasso'); disableEditorEyedrop(); enableEditorLasso(); });
els.toolPan?.addEventListener('click', ()=>{ editor.tool='pan'; setToolActive('toolPan'); disableEditorEyedrop(); disableEditorLasso(); });

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
els.eyeAdd?.addEventListener('click', ()=>{
  if (!editor.currentHex || !/^#([0-9A-F]{6})$/i.test(editor.currentHex)) {
    const cx = Math.floor(els.editCanvas.width/2);
    const cy = Math.floor(els.editCanvas.height/2);
    const d = editor.ectx.getImageData(cx,cy,1,1).data;
    editor.currentHex = rgbToHex(d[0],d[1],d[2]);
    showEye(editor.currentHex);
  }
  addPaletteRow(editor.currentHex);
  renderEditorPalette(); buildLassoChecks(); renderCodeList(); updateMailto(); persistPrefs();
});
els.eyeCancel?.addEventListener('click', ()=>{ editor.octx?.clearRect(0,0,els.editOverlay.width,els.editOverlay.height); });

// Lasso
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
els.lassoClear?.addEventListener('click', ()=>{ editor.lassoPts=[]; drawLassoStroke(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true; });
els.lassoSave?.addEventListener('click', ()=>{
  if(!editor.lassoPts.length) return;
  const allowed=new Set();
  [...els.lassoChecks.querySelectorAll('input[type=checkbox]')].forEach((cb,i)=>{ if(cb.checked) allowed.add(i); });
  const mask=rasterizePolygonToMask(editor.lassoPts, els.srcCanvas.width, els.srcCanvas.height);
  regions.push({ type:'polygon', points: editor.lassoPts.map(p=>[p[0],p[1]]), mask, allowed });
  alert('Lasso region saved.');
  editor.lassoPts=[]; drawLassoStroke(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true;
});

/////////////////////////////// Codes UI + Report + Email ///////////////////////////////
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

/////////////////////////////// UI Actions ///////////////////////////////
function updateWeightsUI(){ if(els.wChromaOut) els.wChromaOut.textContent=fmtMult(els.wChroma.value); if(els.wLightOut) els.wLightOut.textContent=fmtMult(els.wLight.value); }

function bindEvents(){
  // Upload inputs
  els.fileInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f,'file'); });
  els.cameraInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f,'camera'); });

  // Drag & Drop (desktop)
  const prevent=(e)=>{ e.preventDefault(); e.stopPropagation(); };
  ['dragenter','dragover','dragleave','drop'].forEach(ev=>{
    window.addEventListener(ev, prevent, { passive:false });
  });
  window.addEventListener('drop', (e)=>{
    const dt=e.dataTransfer; const f=dt && dt.files && dt.files[0];
    if(f) handleFile(f,'drop');
  }, { passive:false });

  // Paste button (desktop)
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

  // Reset/preview resize
  els.resetBtn?.addEventListener('click', ()=>{ if(!state.fullBitmap) return; drawPreviewFromState(); });
  els.maxW?.addEventListener('change', ()=>{ if(state.fullBitmap) drawPreviewFromState(); });

  // Palette
  els.addColor?.addEventListener('click', ()=>{ addPaletteRow('#FFFFFF'); renderCodeList(); updateMailto(); persistPrefs(); });
  els.clearColors?.addEventListener('click', ()=>{ els.paletteList.innerHTML=''; renderCodeList(); updateMailto(); persistPrefs(); });
  els.loadExample?.addEventListener('click', ()=>{ setPalette(['#FFFFFF','#B3753B','#5B3A21','#D22C2C','#1D6E2E']); renderCodeList(); updateMailto(); persistPrefs(); });
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
    const centers=kmeans(img.data,k,10); setPalette(centers.map(([r,g,b])=>rgbToHex(r,g,b)));
    renderCodeList(); updateMailto(); persistPrefs();
  });

  // Weights out
  ['input','change'].forEach(ev=>{ els.wChroma?.addEventListener(ev, updateWeightsUI); els.wLight?.addEventListener(ev, updateWeightsUI); });

  // Apply mapping
  els.applyBtn?.addEventListener('click', async ()=>{
    const pal=getPalette(); if(!pal.length){ alert('Add at least one color to the palette.'); return; }
    const wL=parseInt(els.wLight.value,10)/100, wC=parseInt(els.wChroma.value,10)/100;
    const dither=!!els.useDither.checked, bgMode=els.bgMode.value;

    // Build processing canvas (preview or full res)
    let procCanvas, pctx, usingFull=false;
    if(els.keepFullRes.checked && state.fullBitmap){
      usingFull=true;
      const baseW=state.fullW, baseH=state.fullH, o=state.exifOrientation||1;
      const {w:ow, h:oh} = getOrientedDims(o, baseW, baseH);
      procCanvas=document.createElement('canvas'); procCanvas.width=ow; procCanvas.height=oh;
      pctx=procCanvas.getContext('2d',{willReadFrequently:true});
      pctx.imageSmoothingEnabled=false;
      if (o===1 && state.fullBitmap instanceof ImageBitmap){
        pctx.drawImage(state.fullBitmap,0,0,ow,oh);
      } else {
        drawImageWithOrientation(pctx, state.fullBitmap, ow, oh, o);
      }
    } else {
      procCanvas=els.srcCanvas; pctx=procCanvas.getContext('2d',{willReadFrequently:true});
      pctx.imageSmoothingEnabled=false;
    }

    // Effective regions (scale to full if needed)
    let effectiveRegions=[];
    if(regions.length){
      if(usingFull){
        const sx=procCanvas.width/els.srcCanvas.width, sy=procCanvas.height/els.srcCanvas.height;
        effectiveRegions = regions.map(r=>{
          if(r.type==='polygon'){
            const full=scaleMask(r.mask, els.srcCanvas.width, els.srcCanvas.height, procCanvas.width, procCanvas.height);
            return { type:'polygon', mask:full, allowed:r.allowed };
          } else { return { ...scaleRect(normalizeRect(r), sx, sy), allowed:r.allowed }; }
        });
      } else {
        effectiveRegions = regions.map(r=> r.type==='polygon' ? { type:'polygon', mask:r.mask, allowed:r.allowed } : normalizeRect(r));
      }
    }

    if (els.useHalftone?.checked) {
      const srcData = pctx.getImageData(0,0,procCanvas.width,procCanvas.height);
      const cell=clamp(parseInt(els.dotCell?.value||'6',10),3,64);
      const bgHex=(els.dotBg?.value||'#FFFFFF').toUpperCase();
      const jitter=!!els.dotJitter?.checked;

      pctx.clearRect(0,0,procCanvas.width,procCanvas.height);
      renderHalftone(pctx, srcData, pal, bgHex, cell, jitter, wL, wC, effectiveRegions);

      if(usingFull){
        const previewW=Math.min(procCanvas.width, parseInt(els.maxW.value,10));
        const scale=previewW/procCanvas.width;
        els.outCanvas.width=Math.round(procCanvas.width*scale); els.outCanvas.height=Math.round(procCanvas.height*scale);
        octx.clearRect(0,0,els.outCanvas.width,els.outCanvas.height);
        octx.imageSmoothingEnabled=false;
        octx.drawImage(procCanvas,0,0,els.outCanvas.width,els.outCanvas.height);
        els.outCanvas._fullImageData = pctx.getImageData(0,0,procCanvas.width,procCanvas.height);
      } else {
        const outData=pctx.getImageData(0,0,procCanvas.width,procCanvas.height);
        els.outCanvas.width=outData.width; els.outCanvas.height=outData.height; octx.putImageData(outData,0,0);
        els.outCanvas._fullImageData = outData;
      }
      els.downloadBtn.disabled=false; return;
    }

    // Pixel mapping path
    const imgData=pctx.getImageData(0,0,procCanvas.width,procCanvas.height);
    const out=mapToPalette(imgData,pal,wL,wC,dither,bgMode,effectiveRegions);

    if(usingFull){
      const previewW=Math.min(procCanvas.width, parseInt(els.maxW.value,10));
      const scale=previewW/procCanvas.width;
      els.outCanvas.width=Math.round(procCanvas.width*scale); els.outCanvas.height=Math.round(procCanvas.height*scale);
      const off=(typeof OffscreenCanvas!=='undefined')? new OffscreenCanvas(procCanvas.width,procCanvas.height) : Object.assign(document.createElement('canvas'),{width:procCanvas.width,height:procCanvas.height});
      const offCtx=off.getContext('2d'); offCtx.imageSmoothingEnabled=false; offCtx.putImageData(out,0,0);
      let bmp; if(off.convertToBlob){ const blob=await off.convertToBlob(); bmp=await createImageBitmap(blob); } else { const blob=await new Promise(res=>off.toBlob(res)); bmp=await createImageBitmap(blob); }
      octx.clearRect(0,0,els.outCanvas.width,els.outCanvas.height); octx.imageSmoothingEnabled=false; octx.drawImage(bmp,0,0,els.outCanvas.width,els.outCanvas.height);
      els.outCanvas._fullImageData=out;
    } else {
      els.outCanvas.width=out.width; els.outCanvas.height=out.height; octx.putImageData(out,0,0); els.outCanvas._fullImageData=out;
    }
    els.downloadBtn.disabled=false;
  });

  // Download PNG (full-res if available)
  els.downloadBtn?.addEventListener('click', ()=>{
    const out=els.outCanvas._fullImageData;
    if(out){
      const c=document.createElement('canvas'); c.width=out.width; c.height=out.height;
      const cx=c.getContext('2d',{ willReadFrequently:true }); cx.imageSmoothingEnabled=false;
      cx.putImageData(out,0,0);
      c.toBlob(blob=>{ const a=document.createElement('a'); a.download='mapped_fullres.png'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }, 'image/png');
    } else {
      const c=document.createElement('canvas'); c.width=els.outCanvas.width; c.height=els.outCanvas.height;
      const cx=c.getContext('2d'); cx.imageSmoothingEnabled=false; cx.drawImage(els.outCanvas,0,0);
      c.toBlob(blob=>{ const a=document.createElement('a'); a.download='mapped_preview.png'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }, 'image/png');
    }
  });

  // Projects pane & actions
  els.openProjects?.addEventListener('click', ()=>setPane(true));
  els.closeProjects?.addEventListener('click', ()=>setPane(false));
  els.refreshProjects?.addEventListener('click', refreshProjectsList);

  els.saveProject?.addEventListener('click', async ()=>{
    if(!state.fullBitmap){ alert('Load an image first.'); return; }
    const name=prompt('Project name?')||`Project ${Date.now()}`;

    // Save oriented original as PNG (so re-load has correct rotation)
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

  // Desktop alt-click sampler on the preview
  els.srcCanvas.addEventListener('click',(evt)=>{
    if(!evt.altKey) return;
    const rect=els.srcCanvas.getBoundingClientRect();
    const x=Math.floor((evt.clientX-rect.left)*els.srcCanvas.width/rect.width);
    const y=Math.floor((evt.clientY-rect.top )*els.srcCanvas.height/rect.height);
    const d=sctx.getImageData(x,y,1,1).data; addPaletteRow(rgbToHex(d[0],d[1],d[2]));
    renderCodeList(); updateMailto(); persistPrefs();
  });
}

/////////////////////////////// Settings & Persistence ///////////////////////////////
function getCurrentSettings(){
  return {
    palette: getPalette().map(([r,g,b])=>rgbToHex(r,g,b)),
    maxW: parseInt(els.maxW.value,10),
    keepFullRes: !!els.keepFullRes.checked,
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
  };
}
function applySettings(s){
  if(!s) return;
  if(s.palette) setPalette(s.palette);
  if(s.maxW) els.maxW.value=s.maxW;
  if('keepFullRes' in s) els.keepFullRes.checked=!!s.keepFullRes;
  if(s.wChroma) els.wChroma.value=s.wChroma;
  if(s.wLight) els.wLight.value=s.wLight;
  if('useDither' in s) els.useDither.checked=!!s.useDither;
  if(s.bgMode) els.bgMode.value=s.bgMode;
  if('useHalftone' in s) els.useHalftone.checked=!!s.useHalftone;
  if(s.dotCell) els.dotCell.value=s.dotCell;
  if(s.dotBg) els.dotBg.value=s.dotBg;
  if('dotJitter' in s) els.dotJitter.checked=!!s.dotJitter;
  if(s.codeMode) state.codeMode = (s.codeMode === CODE_MODES.HEX ? CODE_MODES.HEX : CODE_MODES.PMS);
  updateWeightsUI();
  regions.length=0;
  if(s.regions && Array.isArray(s.regions)){
    s.regions.forEach(r=>{
      if(r.type==='polygon'){ const mask=rasterizePolygonToMask(r.points, els.srcCanvas.width, els.srcCanvas.height); regions.push({ type:'polygon', points:r.points, mask, allowed:new Set(r.allowed||[]) }); }
      else { regions.push({ x0:r.x0,y0:r.y0,x1:r.x1,y1:r.y1, allowed:new Set(r.allowed||[]) }); }
    });
  }
}
function persistPrefs(){
  const p = {
    lastPalette: getPalette().map(([r,g,b])=>rgbToHex(r,g,b)),
    keepFullRes: els.keepFullRes.checked,
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
async function init(){
  try{
    // Hide legacy region UI on main page
    if(els.regionCard) els.regionCard.style.display='none';
    if(els.regionMode){ els.regionMode.checked=false; els.regionMode.disabled=true; }
    if(els.regionClear){ els.regionClear.disabled=true; }
    if(els.regionConfig){ els.regionConfig.hidden=true; }

    // Load prefs
    const prefs=loadPrefs();
    if(prefs.lastPalette) setPalette(prefs.lastPalette); else setPalette(['#FFFFFF','#000000']);
    if(prefs.keepFullRes!==undefined) els.keepFullRes.checked=!!prefs.keepFullRes;
    if(prefs.maxW) els.maxW.value=prefs.maxW;
    if(prefs.wChroma) els.wChroma.value=prefs.wChroma;
    if(prefs.wLight) els.wLight.value=prefs.wLight;
    if(prefs.bgMode) els.bgMode.value=prefs.bgMode;
    if(prefs.useDither!==undefined) els.useDither.checked=!!prefs.useDither;
    if(prefs.useHalftone!==undefined) els.useHalftone.checked=!!prefs.useHalftone;
    if(prefs.dotCell) els.dotCell.value=prefs.dotCell;
    if(prefs.dotBg) els.dotBg.value=prefs.dotBg;
    if(prefs.dotJitter!==undefined) els.dotJitter.checked=!!prefs.dotJitter;
    state.codeMode = (prefs.codeMode === CODE_MODES.HEX ? CODE_MODES.HEX : CODE_MODES.PMS);
    if (els.colorCodeMode) els.colorCodeMode.value = state.codeMode;

    updateWeightsUI(); renderSavedPalettes();

    // Load PMS library once
    await loadPmsJson();

    // Wire codes UI now that PMS is available
    wireCodesUI();

    refreshProjectsList();
    toggleImageActions(!!state.fullBitmap);
  }catch(e){ console.error('Init error:', e); }
}

bindEvents();
window.addEventListener('load', init);

/////////////////////////////// Helpers (mask scaling) ///////////////////////////////
function scaleMask(mask,w0,h0,w1,h1){
  const c0=document.createElement('canvas'); c0.width=w0; c0.height=h0; const x0=c0.getContext('2d'); const id0=x0.createImageData(w0,h0);
  for(let i=0;i<w0*h0;i++){ const k=i*4; id0.data[k]=255; id0.data[k+1]=255; id0.data[k+2]=255; id0.data[k+3]=mask[i]?255:0; }
  x0.putImageData(id0,0,0);
  const c1=document.createElement('canvas'); c1.width=w1; c1.height=h1; const x1=c1.getContext('2d'); x1.imageSmoothingEnabled=false; x1.drawImage(c0,0,0,w0,h0,0,0,w1,h1);
  const out=new Uint8Array(w1*h1); const id1=x1.getImageData(0,0,w1,h1).data; for(let i=0;i<w1*h1;i++) out[i]=id1[i*4+3]>0?1:0; return out;
}
