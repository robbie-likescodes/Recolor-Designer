/* Palette Mapper — Cup Print Helper
   FULL JS (Restored Manual Replacements + Suggest by Hue/Luma + Vector Export hooks)
   -------------------------------------------------------------------------------
   Works with the HTML you already have plus these extra controls:
   - <button id="suggestByHueLuma">Suggest by Hue & Luma</button>
   - <table><tbody id="rulesTbody"></tbody></table>
   - <button id="addRuleBtn">+ Add replacement</button>
   - <button id="refreshMapBtn">Refresh Mapping</button>
   - <button id="exportSvgBtn" disabled>Export SVG</button>
   If any are missing, the app will still run (features are just hidden).
*/

/////////////////////////////// DOM ///////////////////////////////
const els = {
  // Image & canvases
  fileInput:        document.getElementById('fileInput'),
  cameraInput:      document.getElementById('cameraInput'),
  pasteBtn:         document.getElementById('pasteBtn'),
  resetBtn:         document.getElementById('resetBtn'),

  maxW:             document.getElementById('maxW'),
  keepFullRes:      document.getElementById('keepFullRes'),
  sharpenEdges:     document.getElementById('sharpenEdges'), // optional

  srcCanvas:        document.getElementById('srcCanvas'),
  outCanvas:        document.getElementById('outCanvas'),

  // Palette
  addColor:         document.getElementById('addColor'),
  clearColors:      document.getElementById('clearColors'),
  loadExample:      document.getElementById('loadExample'),
  paletteList:      document.getElementById('paletteList'),
  kColors:          document.getElementById('kColors'),
  autoExtract:      document.getElementById('autoExtract'),

  // Mapping weights & options
  wChroma:          document.getElementById('wChroma'),
  wLight:           document.getElementById('wLight'),
  wChromaOut:       document.getElementById('wChromaOut'),
  wLightOut:        document.getElementById('wLightOut'),
  useDither:        document.getElementById('useDither'),
  bgMode:           document.getElementById('bgMode'),
  applyBtn:         document.getElementById('applyBtn'),
  downloadBtn:      document.getElementById('downloadBtn'),

  // Halftone (optional section)
  useHalftone:      document.getElementById('useHalftone'),
  dotCell:          document.getElementById('dotCell'),
  dotBg:            document.getElementById('dotBg'),
  dotJitter:        document.getElementById('dotJitter'),

  // Projects
  openProjects:     document.getElementById('openProjects'),
  closeProjects:    document.getElementById('closeProjects'),
  projectsPane:     document.getElementById('projectsPane'),
  saveProject:      document.getElementById('saveProject'),
  refreshProjects:  document.getElementById('refreshProjects'),
  projectsList:     document.getElementById('projectsList'),
  exportProject:    document.getElementById('exportProject'),
  importProject:    document.getElementById('importProject'),
  deleteProject:    document.getElementById('deleteProject'),

  // Codes
  colorCodeMode:    document.getElementById('colorCodeMode'),
  codeList:         document.getElementById('codeList'),
  exportReport:     document.getElementById('exportReport'),
  mailtoLink:       document.getElementById('mailtoLink'),

  // Full-screen editor
  openEditor:       document.getElementById('openEditor'),
  editorOverlay:    document.getElementById('editorOverlay'),
  toolEyedrop:      document.getElementById('toolEyedrop'),
  toolLasso:        document.getElementById('toolLasso'),
  toolPan:          document.getElementById('toolPan'),
  editorDone:       document.getElementById('editorDone'),
  editCanvas:       document.getElementById('editCanvas'),
  editOverlay:      document.getElementById('editOverlay'),
  editorPalette:    document.getElementById('editorPalette'),
  lassoChecks:      document.getElementById('lassoChecks'),
  lassoSave:        document.getElementById('lassoSave'),
  lassoClear:       document.getElementById('lassoClear'),
  eyeSwatch:        document.getElementById('eyeSwatch'),
  eyeHex:           document.getElementById('eyeHex'),
  eyeAdd:           document.getElementById('eyeAdd'),
  eyeCancel:        document.getElementById('eyeCancel'),

  // NEW / restored controls
  suggestByHueLuma: document.getElementById('suggestByHueLuma'),
  rulesTbody:       document.getElementById('rulesTbody'),
  addRuleBtn:       document.getElementById('addRuleBtn'),
  refreshMapBtn:    document.getElementById('refreshMapBtn'),
  exportSvgBtn:     document.getElementById('exportSvgBtn'),
};

const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently: true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently: true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

/////////////////////////////// Toasts ///////////////////////////////
function toast(msg, ms=1800){
  let host = document.getElementById('toasts');
  if(!host){
    host = document.createElement('div');
    host.id = 'toasts';
    host.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:20px;display:grid;gap:8px;z-index:99999';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'background:#111826dd;border:1px solid #2a3243;color:#e8ecf3;padding:10px 12px;border-radius:10px;backdrop-filter:blur(8px);box-shadow:0 6px 16px rgba(0,0,0,.35)';
  host.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .25s'; setTimeout(()=>host.removeChild(t),250); }, ms);
}

/////////////////////////////// State ///////////////////////////////
const state = {
  fullBitmap: null,
  fullW: 0,
  fullH: 0,
  exifOrientation: 1,
  selectedProjectId: null,
  codeMode: 'pms',
  // Replacement rules (single source of truth for Texture/Replacement feature)
  // rule: { id, enabled, targetHex, inks:[hex], pattern, density (0..1) }
  replacements: [],
  // Cached last src data for suggestions / clustering
  lastSrcImageData: null,
};

/////////////////////////////// Utils ///////////////////////////////
const clamp = (v, a, b)=> v<a? a : v>b? b : v;
const hexToRgb = hex => {
  if(!hex) return null;
  let h = hex.trim();
  if (!h.startsWith('#')) h = '#'+h;
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if(!m) return null;
  const n = parseInt(m[1],16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
};
const rgbToHex = (r,g,b)=> '#' + [r,g,b].map(v=>clamp(v,0,255).toString(16).padStart(2,'0')).join('').toUpperCase();
const uid = (p='r_') => p + Math.random().toString(36).slice(2,9);

function srgbToLinear(u){ u/=255; return (u<=0.04045)? u/12.92 : Math.pow((u+0.055)/1.055,2.4); }
function rgbToXyz(r,g,b){ r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b);
  return [ r*0.4124564 + g*0.3575761 + b*0.1804375,
           r*0.2126729 + g*0.7151522 + b*0.0721750,
           r*0.0193339 + g*0.1191920 + b*0.9503041 ];
}
function xyzToLab(x,y,z){
  const Xn=0.95047,Yn=1.0,Zn=1.08883; x/=Xn; y/=Yn; z/=Zn;
  const f=t=>(t>0.008856)?Math.cbrt(t):(7.787*t+16/116);
  const fx=f(x), fy=f(y), fz=f(z);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
function rgbToLab(r,g,b){ const [x,y,z]=rgbToXyz(r,g,b); return xyzToLab(x,y,z); }
function deltaE2Weighted(l1,l2,wL,wC){ const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2]; return wL*dL*dL + wC*(da*da+db*db); }

// small helpers
function getPalette(){
  const rows = [...(els.paletteList?.querySelectorAll('.palette-item')||[])];
  const out=[]; for(const r of rows){
    const hex = (r.querySelector('input[type=text]')?.value || '').trim();
    const rgb = hexToRgb(hex);
    if(rgb) out.push([rgb.r,rgb.g,rgb.b]);
  }
  return out;
}
function setPalette(hexes){
  if(!els.paletteList) return;
  els.paletteList.innerHTML='';
  hexes.forEach(addPaletteRow);
  renderCodeList(); updateMailto();
}
function addPaletteRow(hex='#FFFFFF'){
  const r = document.createElement('div');
  r.className='palette-item';
  r.innerHTML = `
    <input type="color" value="${hex}" aria-label="color">
    <input type="text" value="${hex}" aria-label="hex code" placeholder="#RRGGBB">
    <button class="ghost remove" type="button">Remove</button>
  `;
  const color=r.querySelector('input[type=color]');
  const text=r.querySelector('input[type=text]');
  const del = r.querySelector('.remove');
  const sync=(fromColor)=>{
    if(fromColor) text.value = color.value.toUpperCase();
    let v=text.value.trim(); if(!v.startsWith('#')) v='#'+v;
    if(/^#([0-9A-Fa-f]{6})$/.test(v)){ color.value=v; text.value=v.toUpperCase(); }
  };
  color.addEventListener('input',()=>{ sync(true); renderCodeList(); updateMailto(); });
  text.addEventListener('change',()=>{ sync(false); renderCodeList(); updateMailto(); });
  del.addEventListener('click',()=>{ r.remove(); renderCodeList(); updateMailto(); });
  els.paletteList?.appendChild(r);
}

/////////////////////////////// PMS (optional) ///////////////////////////////
let PMS_LIB = [];
const PMS_CACHE = new Map();
async function loadPmsJson(url='pms_solid_coated.json'){
  try { PMS_LIB = await (await fetch(url, {cache:'no-store'})).json(); }
  catch { PMS_LIB = []; }
}
function nearestPms(hex){
  if(PMS_CACHE.has(hex)) return PMS_CACHE.get(hex);
  const rgb = hexToRgb(hex);
  if(!rgb || !PMS_LIB.length){ const out={name:'—',hex,deltaE:0}; PMS_CACHE.set(hex,out); return out; }
  const lab=rgbToLab(rgb.r,rgb.g,rgb.b);
  let best=null, bestD=Infinity;
  for(const sw of PMS_LIB){
    const r2 = hexToRgb(sw.hex); if(!r2) continue;
    const lab2 = rgbToLab(r2.r,r2.g,r2.b);
    const d = deltaE2Weighted(lab,lab2,1,1);
    if(d<bestD){ bestD=d; best={name:sw.name,hex:sw.hex,deltaE:Math.sqrt(d)}; }
  }
  const out = best || {name:'—',hex,deltaE:0};
  PMS_CACHE.set(hex,out);
  return out;
}

function currentPaletteCodes(){
  return getPalette().map(([r,g,b])=>{
    const hex = rgbToHex(r,g,b);
    if(state.codeMode==='hex') return { hex, label: hex, swatchHex: hex };
    const p = nearestPms(hex);
    return { hex, label:`${p.name} (${p.hex}) ΔE≈${p.deltaE.toFixed(1)}`, swatchHex:p.hex };
  });
}
function renderCodeList(){
  if(!els.codeList) return;
  const rows=currentPaletteCodes().map((c,i)=>`<div class="row"><span class="sw" style="width:14px;height:14px;border:1px solid #334155;border-radius:3px;display:inline-block;background:${c.swatchHex}"></span>${i+1}. ${c.label}</div>`);
  els.codeList.innerHTML = rows.join('') || '<em>No colors</em>';
}
function buildPrinterReportByMode(finalInksHexes=[]){
  // If we pass final inks (after replacements), report those; else report current palette
  const list = finalInksHexes.length ? finalInksHexes : getPalette().map(([r,g,b])=>rgbToHex(r,g,b));
  const items = list.map(hex=>{
    if(state.codeMode==='hex') return {label:hex};
    const p = nearestPms(hex); return {label:`${p.name} (${p.hex})`};
  });
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
  if(!els.mailtoLink) return;
  const subject = encodeURIComponent(
    state.codeMode==='pms' ? 'Print job: artwork + PMS palette' : 'Print job: artwork + HEX palette'
  );
  const preview = buildPrinterReportByMode().split('\n').slice(0, 24).join('\n');
  const body = encodeURIComponent(
`Hi,

Please find attached the artwork PNG (full resolution) and a ${
  state.codeMode==='pms' ? 'PMS' : 'HEX'
} palette list.

Report (preview):
${preview}

Thanks!`
  );
  els.mailtoLink.href = `mailto:?subject=${subject}&body=${body}`;
}

/////////////////////////////// HEIC & EXIF helpers ///////////////////////////////
function isHeicFile(file){
  const name=(file.name||'').toLowerCase();
  const type=(file.type||'').toLowerCase();
  return name.endsWith('.heic')||name.endsWith('.heif')||type.includes('heic')||type.includes('heif');
}
function heicNotSupportedMessage(){
  alert(`This photo appears to be HEIC/HEIF, which this browser can't decode into canvas.
Use a JPG/PNG, or on iPhone set: Settings → Camera → Formats → “Most Compatible”.`);
}
function isLikelyJpeg(file){
  const t=(file.type||'').toLowerCase();
  const ext=(file.name||'').split('.').pop().toLowerCase();
  return t.includes('jpeg')||t.includes('jpg')||ext==='jpg'||ext==='jpeg';
}
// Minimal EXIF orientation parse (JPEG only)
async function readJpegOrientation(file){
  return new Promise((resolve)=>{
    const reader=new FileReader();
    reader.onload=()=>{ try{
      const view=new DataView(reader.result);
      if(view.getUint16(0,false)!==0xFFD8) return resolve(1);
      let offset=2, length=view.byteLength;
      while(offset<length){
        const marker=view.getUint16(offset,false); offset+=2;
        if(marker===0xFFE1){
          const exifLength=view.getUint16(offset,false); offset+=2;
          if(view.getUint32(offset,false)!==0x45786966) break; // "Exif"
          offset+=6;
          const tiff=offset;
          const little=(view.getUint16(tiff,false)===0x4949);
          const get16=o=>view.getUint16(o,little);
          const get32=o=>view.getUint32(o,little);
          const firstIFD=get32(tiff+4);
          if(firstIFD<8) return resolve(1);
          const dir=tiff+firstIFD;
          const entries=get16(dir);
          for(let i=0;i<entries;i++){
            const e=dir+2+i*12;
            const tag=get16(e);
            if(tag===0x0112) return resolve(get16(e+8)||1);
          }
        }else if((marker&0xFF00)!==0xFF00) break;
        else offset+=view.getUint16(offset,false);
      }
    }catch{} resolve(1); };
    reader.onerror=()=>resolve(1);
    reader.readAsArrayBuffer(file.slice(0,256*1024));
  });
}
function drawImageWithOrientation(ctx, img, w, h, orientation){
  ctx.save();
  switch(orientation){
    case 2: ctx.translate(w,0); ctx.scale(-1,1); break;
    case 3: ctx.translate(w,h); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0,h); ctx.scale(1,-1); break;
    case 5: ctx.rotate(0.5*Math.PI); ctx.scale(1,-1); break;
    case 6: ctx.rotate(0.5*Math.PI); ctx.translate(0,-w); break;
    case 7: ctx.rotate(0.5*Math.PI); ctx.translate(h,-w); ctx.scale(-1,1); break;
    case 8: ctx.rotate(-0.5*Math.PI); ctx.translate(-h,0); break;
  }
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img,0,0,w,h);
  ctx.restore();
}

/////////////////////////////// Preview + Auto Palette ///////////////////////////////
const MAX_PREVIEW_WIDTH = 2000;

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
    if(isHeicFile(file)){ heicNotSupportedMessage(); return; }

    state.exifOrientation = 1;

    // Fast path: ImageBitmap (honors EXIF if 'from-image' supported)
    if(typeof createImageBitmap==='function'){
      try{
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        state.fullBitmap = bmp; state.fullW = bmp.width; state.fullH = bmp.height; state.exifOrientation = 1;
        drawPreviewFromState();
        toggleImageActions(true);
        toast('Image loaded.');
        return;
      }catch(e){ /* fallthrough */ }
    }

    // Fallback: <img> + manual EXIF orientation (JPEG)
    const url = objectUrlFor(file);
    try{
      const img = await loadImage(url);
      state.fullBitmap = img;
      state.fullW = img.naturalWidth||img.width;
      state.fullH = img.naturalHeight||img.height;
      if(isLikelyJpeg(file)){
        try { state.exifOrientation = await readJpegOrientation(file); } catch {}
      }else state.exifOrientation = 1;
      drawPreviewFromState();
      toggleImageActions(true);
      toast('Image loaded.');
    } finally { revokeUrl(url); }
  }catch(err){
    console.error('Image load error', err);
    alert('Could not open that image. Try a JPG/PNG or a different photo.');
  } finally {
    if(els.fileInput)   els.fileInput.value='';
    if(els.cameraInput) els.cameraInput.value='';
  }
}

function drawPreviewFromState(){
  if(!state.fullBitmap || !els.srcCanvas) return;
  let w = state.fullW, h = state.fullH;
  const o = state.exifOrientation||1;
  if([5,6,7,8].includes(o)){ [w,h]=[h,w]; }

  // downscale for preview
  const pW = (w>MAX_PREVIEW_WIDTH) ? Math.round(MAX_PREVIEW_WIDTH) : w;
  const scale = pW / w;
  const pH = Math.round(h*scale);

  els.srcCanvas.width = pW; els.srcCanvas.height = pH;
  sctx.clearRect(0,0,pW,pH);

  if (o===1 && state.fullBitmap instanceof ImageBitmap) {
    sctx.drawImage(state.fullBitmap,0,0,pW,pH);
  } else {
    drawImageWithOrientation(sctx, state.fullBitmap, pW, pH, o);
  }

  // init output canvas to same size for preview
  els.outCanvas.width = pW; els.outCanvas.height = pH;
  octx.clearRect(0,0,pW,pH);

  // keep lastSrcImageData for suggestions
  try { state.lastSrcImageData = sctx.getImageData(0,0,pW,pH); } catch {}

  // Auto palette (hybrid)
  setTimeout(()=>{
    try { autoPaletteFromCanvasHybrid(els.srcCanvas, 10); } catch(e){ console.warn('autoPalette failed', e); }
    renderCodeList(); updateMailto();
  },0);

  // Enable auto extract now that we have a source
  if(els.autoExtract) els.autoExtract.disabled = false;

  // Enable SVG export button if library is present
  if(els.exportSvgBtn){
    els.exportSvgBtn.disabled = (typeof window !== 'undefined' && window.ImageTracer) ? false : true;
  }
}

function toggleImageActions(enable){
  if(els.applyBtn) els.applyBtn.disabled = !enable;
  if(els.autoExtract) els.autoExtract.disabled = !enable;
  if(els.resetBtn) els.resetBtn.disabled = !enable;
}

/////////////////////////////// Auto Palette (Hybrid) ///////////////////////////////
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
function autoPaletteFromCanvasHybrid(canvas, k=10){
  if(!canvas || !canvas.width) return;
  const ctx = canvas.getContext('2d',{willReadFrequently:true});
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0,0,w,h).data;

  // 5-bit histogram (32^3 bins)
  const bins = new Map();
  for(let i=0;i<img.length;i+=4){
    const a=img[i+3]; if(a<16) continue;
    const r=img[i]>>3, g=img[i+1]>>3, b=img[i+2]>>3;
    const key=(r<<10)|(g<<5)|b;
    bins.set(key,(bins.get(key)||0)+1);
  }
  const seedsCount = Math.min(48, Math.max(k*4, k+4));
  const ranked = [...bins.entries()].sort((a,b)=>b[1]-a[1]).slice(0,seedsCount).map(([key])=>{
    const r=((key>>10)&31)<<3, g=((key>>5)&31)<<3, b=(key&31)<<3;
    return [r,g,b];
  });

  const centers = kmeansFromSeeds(img, k, ranked, 8);
  const hexes = centers.map(([r,g,b])=>rgbToHex(r,g,b));
  setPalette(hexes);
}

/////////////////////////////// Replacement Rules UI ///////////////////////////////
function renderRulesTable(){
  if(!els.rulesTbody) return;
  els.rulesTbody.innerHTML='';
  state.replacements.forEach(rule=>{
    els.rulesTbody.appendChild(ruleRow(rule));
  });
}
function ruleRow(rule){
  const tr=document.createElement('tr'); tr.dataset.id=rule.id;
  const inksChips = rule.inks.map(h=>`<span class="chip" title="${h}" style="display:inline-inline-block;min-width:16px;height:16px;border:1px solid #334155;border-radius:4px;background:${h};margin-right:6px;vertical-align:middle;"></span>`).join('');
  tr.innerHTML = `
    <td><label class="check"><input type="checkbox" ${rule.enabled?'checked':''} class="r-enabled"> Enable</label></td>
    <td>
      <input type="color" value="${rule.targetHex}" class="r-target-color">
      <input type="text" value="${rule.targetHex}" class="r-target-hex" style="width:90px">
    </td>
    <td class="r-inks">${inksChips}</td>
    <td>
      <select class="r-pattern">
        <option value="checker" ${rule.pattern==='checker'?'selected':''}>Checker</option>
        <option value="stripe"  ${rule.pattern==='stripe'?'selected':''}>Stripe</option>
        <option value="dots"    ${rule.pattern==='dots'?'selected':''}>Dots</option>
        <option value="ordered" ${rule.pattern==='ordered'?'selected':''}>Ordered</option>
      </select>
    </td>
    <td>
      <input type="range" min="0" max="100" value="${Math.round(rule.density*100)}" class="r-density">
      <span class="mono r-density-out">${(rule.density*100|0)}%</span>
    </td>
    <td><button class="ghost r-edit-inks" type="button">Edit inks</button></td>
    <td><button class="ghost danger r-del" type="button">Delete</button></td>
  `;
  // wire
  tr.querySelector('.r-enabled').addEventListener('change', e=>{
    rule.enabled = !!e.target.checked;
  });
  const color = tr.querySelector('.r-target-color');
  const hex   = tr.querySelector('.r-target-hex');
  const sync = (fromColor)=>{
    if(fromColor) hex.value = color.value.toUpperCase();
    let v=hex.value.trim(); if(!v.startsWith('#')) v='#'+v;
    if(/^#([0-9A-Fa-f]{6})$/.test(v)){ color.value=v; hex.value=v.toUpperCase(); rule.targetHex=v.toUpperCase(); }
  };
  color.addEventListener('input',()=>sync(true));
  hex.addEventListener('change',()=>sync(false));

  const pat = tr.querySelector('.r-pattern');
  pat.addEventListener('change',()=>{ rule.pattern = pat.value; });

  const dens = tr.querySelector('.r-density');
  const out  = tr.querySelector('.r-density-out');
  dens.addEventListener('input',()=>{ out.textContent = `${dens.value}%`; });
  dens.addEventListener('change',()=>{ rule.density = clamp(parseInt(dens.value,10)/100, 0, 1); });

  tr.querySelector('.r-del').addEventListener('click', ()=>{
    state.replacements = state.replacements.filter(r=>r.id!==rule.id);
    renderRulesTable();
  });

  tr.querySelector('.r-edit-inks').addEventListener('click', ()=>{
    openInkPicker(rule);
  });

  return tr;
}
function openInkPicker(rule){
  // Simple prompt-based multi select using current palette
  const palHexes = getPalette().map(([r,g,b])=>rgbToHex(r,g,b));
  if(palHexes.length===0){ alert('No palette colors available.'); return; }
  const preset = rule.inks.join(', ');
  const input = prompt(`Enter replacement inks as comma-separated HEX from current palette.\nAvailable:\n${palHexes.join(', ')}\n\nCurrent: ${preset}`, preset);
  if(!input) return;
  const picks = input.split(',').map(s=>s.trim().toUpperCase()).filter(h=>/^#([0-9A-F]{6})$/.test(h) && palHexes.includes(h));
  if(!picks.length){ alert('No valid inks selected.'); return; }
  rule.inks = picks;
  renderRulesTable();
}
function addRule(rule){
  state.replacements.push({
    id: uid('rl_'),
    enabled: true,
    targetHex: '#808080',
    inks: ['#000000','#FFFFFF'],
    pattern: 'checker',
    density: 0.5,
    ...rule
  });
  renderRulesTable();
}

/////////////////////////////// Suggest by Hue & Luma ///////////////////////////////
function rgbToHsl(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0,s=0,l=(max+min)/2;
  if(max!==min){
    const d=max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h=(g-b)/d + (g<b?6:0); break;
      case g: h=(b-r)/d + 2; break;
      case b: h=(r-g)/d + 4; break;
    }
    h/=6;
  }
  return {h:h*360, s, l};
}

// Build suggestions from current image (preview) + current palette
function buildHueLumaSuggestions(){
  const img = state.lastSrcImageData;
  if(!img){ toast('Load an image first.'); return []; }
  const palHexes = getPalette().map(([r,g,b])=>rgbToHex(r,g,b));
  if(palHexes.length<2){ toast('Add at least two palette colors.'); return []; }

  // Heuristic: detect if we have near black & white
  const hasBlack = palHexes.some(h=>{ const {r,g,b}=hexToRgb(h); return (r+g+b)<40; });
  const hasWhite = palHexes.some(h=>{ const {r,g,b}=hexToRgb(h); return (r+g+b)>730; });

  // 1) Greys → suggest B/W mixes by luminance buckets
  const out=[];
  const w=img.width, h=img.height, d=img.data;
  const buckets = new Array(8).fill(0).map(()=>({sum:[0,0,0], count:0, avg:'#808080'}));
  for(let y=0;y<h;y+=2){
    for(let x=0;x<w;x+=2){
      const i=(y*w+x)*4; if(d[i+3]<200) continue;
      const r=d[i], g=d[i+1], b=d[i+2];
      const {s,l}=rgbToHsl(r,g,b);
      // greys if saturation is low in Lab-ish (quick proxy using min/max)
      const max=Math.max(r,g,b), min=Math.min(r,g,b);
      const satProxy = (max-min)/255;
      if(satProxy<0.08){
        const bi = clamp(Math.floor(l*8),0,7);
        buckets[bi].sum[0]+=r; buckets[bi].sum[1]+=g; buckets[bi].sum[2]+=b; buckets[bi].count++;
      }
    }
  }
  if(hasBlack && hasWhite){
    buckets.forEach((bk,idx)=>{
      if(bk.count>250){ // enough support
        const r=Math.round(bk.sum[0]/bk.count), g=Math.round(bk.sum[1]/bk.count), b=Math.round(bk.sum[2]/bk.count);
        const hex=rgbToHex(r,g,b);
        // density is % black in a BW mix: invert by luminance
        const l = rgbToHsl(r,g,b).l; // 0..1
        const densityBlack = clamp(1 - l, 0, 1); // darker → more black
        out.push({
          targetHex: hex,
          inks: ['#000000','#FFFFFF'],
          pattern: 'checker',
          density: densityBlack,
          enabled: true,
          note: `Grey bucket ${idx} → BW ${Math.round(densityBlack*100)}%`
        });
      }
    });
  }

  // 2) Color hues → pick two closest palette inks by hue proximity and suggest a mix
  // Compute palette hue list
  const palH = palHexes.map(h=>{ const {r,g,b}=hexToRgb(h); const hs=rgbToHsl(r,g,b); return {hex:h, h:hs.h, s:hs.s, l:hs.l}; });
  // sample a grid for colored pixels
  const seen = new Map(); // key by rounded hue to avoid duplicates
  for(let y=0;y<h;y+=Math.max(2, Math.floor(h/80))){
    for(let x=0;x<w;x+=Math.max(2, Math.floor(w/80))){
      const i=(y*w+x)*4; if(d[i+3]<200) continue;
      const r=d[i], g=d[i+1], b=d[i+2];
      const {h:hh,s:lS,l:lL}=rgbToHsl(r,g,b);
      const max=Math.max(r,g,b), min=Math.min(r,g,b);
      if((max-min)/255 < 0.10) continue; // skip greys (already handled)
      const key = Math.round(hh/6)*6; // 60 buckets
      if(seen.has(key)) continue;
      seen.set(key, true);

      // find two palette inks with closest hue to target
      const ranked = palH.map(p=>({hex:p.hex, dist: hueDist(p.h, hh) + Math.abs(p.l - lL)*25 }));
      ranked.sort((a,b)=>a.dist-b.dist);
      const pick = ranked.slice(0,2).map(x=>x.hex);
      if(pick.length<2) continue;

      // density based on luminosity proximity (rough): more of the darker ink if target is dark
      const inkL = pick.map(hx=>rgbToHsl(...Object.values(hexToRgb(hx))).l);
      const darkerIdx = inkL[0] <= inkL[1] ? 0 : 1;
      const densityDarker = clamp((0.6 - lL) * 1.5 + 0.5, 0, 1); // heuristic
      out.push({
        targetHex: rgbToHex(r,g,b),
        inks: pick,
        pattern: 'ordered',
        density: densityDarker,
        enabled: true,
      });
    }
  }
  // Merge similar targetHex entries (snap to nearest palette color bucket)
  return dedupeRules(out);
}
function hueDist(a,b){
  let d = Math.abs(a-b); return d>180 ? 360-d : d;
}
function dedupeRules(arr){
  // group by rounded target hex in Lab space close distance; keep first and skip near duplicates
  const kept = [];
  const labs = [];
  for(const rule of arr){
    const rgb = hexToRgb(rule.targetHex); if(!rgb) continue;
    const lab = rgbToLab(rgb.r,rgb.g,rgb.b);
    let tooClose = false;
    for(let i=0;i<labs.length;i++){
      const d2 = deltaE2Weighted(lab, labs[i], 1,1);
      if(d2 < 18){ tooClose=true; break; }
    }
    if(!tooClose){ kept.push(rule); labs.push(lab); }
  }
  // cap
  return kept.slice(0, 40);
}

/////////////////////////////// Mapping core (palette + replacements) ///////////////////////////////
function buildPaletteLab(pal){ return pal.map(([r,g,b])=>({ rgb:[r,g,b], lab:rgbToLab(r,g,b) })); }

function mapWithReplacements(imgData, palette, wL=1.0, wC=1.0, dither=false, bgMode='keep'){
  const w=imgData.width, h=imgData.height, src=imgData.data;
  const out=new ImageData(w,h); out.data.set(src);

  const palLab=buildPaletteLab(palette);
  const rules = state.replacements.filter(r=>r.enabled && r.inks.length>=2);
  const ruleByTarget = new Map(rules.map(r=>[r.targetHex, r]));

  const errR = dither? new Float32Array(w*h): null;
  const errG = dither? new Float32Array(w*h): null;
  const errB = dither? new Float32Array(w*h): null;

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx=y*w+x, i4=idx*4;
      if(out.data[i4+3]===0){ continue; }

      if(bgMode==='transparent' && src[i4+3]<128){ out.data[i4+3]=0; continue; }
      // base rgb
      let r=out.data[i4], g=out.data[i4+1], b=out.data[i4+2];
      if(dither){ r=clamp(Math.round(r+(errR[idx]||0)),0,255); g=clamp(Math.round(g+(errG[idx]||0)),0,255); b=clamp(Math.round(b+(errB[idx]||0)),0,255); }

      const lab = rgbToLab(r,g,b);
      // choose nearest palette entry
      let best=0, bestD=Infinity;
      for(let p=0;p<palLab.length;p++){
        const d2=deltaE2Weighted(lab, palLab[p].lab, wL, wC);
        if(d2<bestD){ bestD=d2; best=p; }
      }
      const hitHex = rgbToHex(...palLab[best].rgb);

      // If there is a rule for this target, render pattern with inks & density
      const rule = ruleByTarget.get(hitHex);
      if(rule){
        const inkA = hexToRgb(rule.inks[0]); const inkB = hexToRgb(rule.inks[1]);
        const pickA = choosePatternPixel(rule.pattern, x, y, rule.density);
        const nr = pickA ? inkA.r : inkB.r;
        const ng = pickA ? inkA.g : inkB.g;
        const nb = pickA ? inkA.b : inkB.b;
        // If rule has >2 inks, do a cyclic ordered pattern among n inks
        if(rule.inks.length>2 && rule.pattern==='ordered'){
          const k = rule.inks.length;
          const sel = ((x & 3) + ((y & 3)<<2)) % k;
          const rgbK = hexToRgb(rule.inks[sel]);
          out.data[i4]  = rgbK.r; out.data[i4+1]=rgbK.g; out.data[i4+2]=rgbK.b;
        }else{
          out.data[i4]  = nr; out.data[i4+1]=ng; out.data[i4+2]=nb;
        }

        if(dither){
          const er=r - out.data[i4], eg=g - out.data[i4+1], eb=b - out.data[i4+2];
          const push=(xx,yy,fr,fg,fb)=>{ if(xx<0||xx>=w||yy<0||yy>=h) return; const j=yy*w+xx; errR[j]+=fr; errG[j]+=fg; errB[j]+=fb; };
          push(x+1,y,   er*7/16, eg*7/16, eb*7/16);
          push(x-1,y+1, er*3/16, eg*3/16, eb*3/16);
          push(x,  y+1, er*5/16, eg*5/16, eb*5/16);
          push(x+1,y+1, er*1/16, eg*1/16, eb*1/16);
        }
        continue;
      }

      // default: map directly to palette color
      const [nr,ng,nb] = palLab[best].rgb;
      out.data[i4]  = nr; out.data[i4+1]=ng; out.data[i4+2]=nb;

      if(dither){
        const er=r-nr, eg=g-ng, eb=b-nb;
        const push=(xx,yy,fr,fg,fb)=>{ if(xx<0||xx>=w||yy<0||yy>=h) return; const j=yy*w+xx; errR[j]+=fr; errG[j]+=fg; errB[j]+=fb; };
        push(x+1,y,   er*7/16, eg*7/16, eb*7/16);
        push(x-1,y+1, er*3/16, eg*3/16, eb*3/16);
        push(x,  y+1, er*5/16, eg*5/16, eb*5/16);
        push(x+1,y+1, er*1/16, eg*1/16, eb*1/16);
      }
    }
  }
  return out;
}

function choosePatternPixel(pattern, x, y, density=0.5){
  density = clamp(density,0,1);
  switch(pattern){
    case 'checker': {
      // 2x2 checker threshold
      const m = ((x&1) ^ (y&1)) ? 1 : 0;
      // map m∈{0,1} into density
      if(density<=0.5) return m===1 && Math.random()<density*2;
      return m===1 || Math.random()<(density-0.5)*2;
    }
    case 'stripe': {
      const period=4;
      const pos = x % period;
      const threshold = Math.round(density*period);
      return pos < threshold;
    }
    case 'dots': {
      // radial dot per 4x4 cell — simple threshold by distance
      const cell = 4;
      const cx = (x%cell)-cell/2;
      const cy = (y%cell)-cell/2;
      const r2 = cx*cx+cy*cy; // 0..8
      const thr = (1 - density) * 8;
      return r2 < thr;
    }
    case 'ordered':
    default: {
      // 4x4 Bayer-like thresholding
      const bayer4 = [
        0,  8,  2, 10,
        12, 4, 14,  6,
        3, 11,  1,  9,
        15, 7, 13,  5
      ];
      const t = bayer4[(y&3)*4+(x&3)]/15; // 0..1
      return t < density;
    }
  }
}

/////////////////////////////// Edge Sharpen (optional) ///////////////////////////////
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
          r += src[i  ]*kv; g += src[i+1]*kv; b += src[i+2]*kv;
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

/////////////////////////////// APPLY + EXPORT ///////////////////////////////
async function applyMapping(){
  if(!els.srcCanvas || !els.outCanvas){ toast('No canvas.'); return; }
  const pal = getPalette(); if(!pal.length){ alert('Add at least one color.'); return; }
  const wL = parseInt(els.wLight?.value||'100',10)/100;
  const wC = parseInt(els.wChroma?.value||'100',10)/100;
  const dither = !!els.useDither?.checked;
  const bgMode = els.bgMode?.value || 'keep';

  // choose source resolution
  let procCanvas, pctx;
  let usingFull = !!els.keepFullRes?.checked && state.fullBitmap;
  if(usingFull){
    let w = state.fullW, h = state.fullH;
    const o = state.exifOrientation||1;
    if([5,6,7,8].includes(o)){ [w,h]=[h,w]; }
    procCanvas = document.createElement('canvas');
    procCanvas.width = w; procCanvas.height = h;
    pctx = procCanvas.getContext('2d',{willReadFrequently:true});
    pctx.imageSmoothingEnabled=false;
    if(o===1 && state.fullBitmap instanceof ImageBitmap){
      pctx.drawImage(state.fullBitmap,0,0,w,h);
    }else{
      drawImageWithOrientation(pctx, state.fullBitmap, w, h, o);
    }
  }else{
    procCanvas = els.srcCanvas;
    pctx = sctx;
  }

  const srcData = pctx.getImageData(0,0,procCanvas.width,procCanvas.height);
  let outFull = mapWithReplacements(srcData, pal, wL, wC, dither, bgMode);
  if(els.sharpenEdges && els.sharpenEdges.checked){
    outFull = unsharpMask(outFull, 0.35);
  }

  // Store the full-res ImageData for PNG export or vectorization raster source
  els.outCanvas._fullImageData = outFull;

  // Downscaled preview draw to outCanvas
  const previewW = Math.min(procCanvas.width, parseInt(els.maxW?.value||'1400',10));
  const scale = previewW / procCanvas.width;
  els.outCanvas.width = Math.round(procCanvas.width*scale);
  els.outCanvas.height= Math.round(procCanvas.height*scale);
  octx.imageSmoothingEnabled=false;

  const tmp=document.createElement('canvas');
  tmp.width = outFull.width; tmp.height = outFull.height;
  tmp.getContext('2d',{willReadFrequently:true}).putImageData(outFull,0,0);
  octx.clearRect(0,0,els.outCanvas.width, els.outCanvas.height);
  octx.drawImage(tmp,0,0,els.outCanvas.width, els.outCanvas.height);

  if(els.downloadBtn) els.downloadBtn.disabled = false;
  if(els.exportSvgBtn){
    els.exportSvgBtn.disabled = (typeof ImageTracer==='undefined');
  }
}

function downloadPNG(){
  const full = els.outCanvas?._fullImageData;
  if(!full){ alert('Nothing to export yet.'); return; }
  const c = document.createElement('canvas');
  c.width = full.width; c.height = full.height;
  c.getContext('2d',{willReadFrequently:true}).putImageData(full,0,0);
  c.toBlob(blob=>{
    const a=document.createElement('a');
    a.download='mapped_fullres.png';
    a.href=URL.createObjectURL(blob);
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
  }, 'image/png');
}

function exportSVG(){
  if(typeof ImageTracer==='undefined'){ alert('Vectorizer not loaded. Include imagetracer_v1.2.6.js'); return; }
  const full = els.outCanvas?._fullImageData;
  if(!full){ alert('Apply mapping first.'); return; }
  // Draw full-res to scratch canvas
  const c = document.createElement('canvas');
  c.width = full.width; c.height = full.height;
  c.getContext('2d',{willReadFrequently:true}).putImageData(full,0,0);

  // Trace (tuned for limited palettes)
  const options = {
    ltres: 1, qtres: 1,
    colorsampling: 0, // disabled (we provide palette)
    numberofcolors: getPalette().length,
    pathomit: 1,
    strokewidth: 0,
    roundcoords: 1,
    viewbox: true,
    linefilter: true,
    blurradius: 0
  };
  // Build palette from current palette hexes
  options.pal = getPalette().map(([r,g,b])=>({r,g,b,a:255}));

  const svgString = ImageTracer.imagedataToSVG(c.getContext('2d').getImageData(0,0,c.width,c.height), options);
  const blob = new Blob([svgString], {type:'image/svg+xml'});
  const a = document.createElement('a');
  a.download = 'mapped.svg';
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

/////////////////////////////// Wire UI ///////////////////////////////
function updateWeightsUI(){
  if(els.wChromaOut) els.wChromaOut.textContent = (parseInt(els.wChroma?.value||'100',10)/100).toFixed(2)+'×';
  if(els.wLightOut)  els.wLightOut.textContent  = (parseInt(els.wLight?.value||'100',10)/100).toFixed(2)+'×';
}

function wire(){
  // Uploads
  els.fileInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f,'file'); });
  els.cameraInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f,'camera'); });
  els.pasteBtn?.addEventListener('click', async ()=>{
    if(!navigator.clipboard || !navigator.clipboard.read){ alert('Clipboard image paste not supported.'); return; }
    try{
      const items=await navigator.clipboard.read();
      for(const item of items){
        for(const type of item.types){
          if(type.startsWith('image/')){ const blob=await item.getType(type); await handleFile(blob,'paste'); return; }
        }
      }
      alert('No image in clipboard.');
    }catch{ alert('Clipboard read failed.'); }
  });
  document.addEventListener('paste', async (e)=>{
    try{
      let file=null;
      if(e.clipboardData?.items){
        for(const it of e.clipboardData.items){ if(it.type && it.type.startsWith('image/')){ file=it.getAsFile(); break; } }
      }
      if(file){ e.preventDefault(); await handleFile(file,'paste'); }
    }catch{}
  });

  // Reset
  els.resetBtn?.addEventListener('click', ()=>{ if(!state.fullBitmap) return; drawPreviewFromState(); toast('Reset preview.'); });

  // Palette
  els.addColor?.addEventListener('click', ()=>{ addPaletteRow('#FFFFFF'); renderCodeList(); updateMailto(); });
  els.clearColors?.addEventListener('click', ()=>{ els.paletteList.innerHTML=''; renderCodeList(); updateMailto(); });
  els.loadExample?.addEventListener('click', ()=>{ setPalette(['#FFFFFF','#B3753B','#5B3A21','#D22C2C','#1D6E2E']); });

  els.autoExtract?.addEventListener('click', ()=>{
    if(!els.srcCanvas?.width){ alert('Load an image first.'); return; }
    const k = clamp(parseInt(els.kColors?.value||'6',10),2,16);
    const img = sctx.getImageData(0,0,els.srcCanvas.width,els.srcCanvas.height);
    const centers = kmeans(img.data,k,10);
    setPalette(centers.map(([r,g,b])=>rgbToHex(r,g,b)));
    toast(`Extracted ${k} colors`);
  });

  // Weights & Apply/Download
  ['input','change'].forEach(ev=>{
    els.wChroma?.addEventListener(ev, updateWeightsUI);
    els.wLight ?.addEventListener(ev, updateWeightsUI);
  });
  els.applyBtn?.addEventListener('click', applyMapping);
  els.downloadBtn?.addEventListener('click', downloadPNG);
  els.refreshMapBtn?.addEventListener('click', applyMapping);

  // Suggest by Hue & Luma
  els.suggestByHueLuma?.addEventListener('click', ()=>{
    const suggestions = buildHueLumaSuggestions();
    if(!suggestions.length){ toast('No suggestions.'); return; }
    // Replace entire table with suggestions, but keep manual rules if you want: here we append
    suggestions.forEach(s=> addRule(s));
    toast(`Added ${suggestions.length} suggested replacements`);
  });

  // Manual add replacement
  els.addRuleBtn?.addEventListener('click', ()=>{
    // default rule uses first two palette colors if available
    const pal = getPalette().map(([r,g,b])=>rgbToHex(r,g,b));
    addRule({
      targetHex: pal[0]||'#808080',
      inks: pal.length>=2 ? [pal[0], pal[1]] : ['#000000','#FFFFFF'],
      pattern: 'checker',
      density: 0.5
    });
  });

  // Export SVG
  els.exportSvgBtn?.addEventListener('click', exportSVG);

  // Codes mode
  if(els.colorCodeMode){
    els.colorCodeMode.value = state.codeMode;
    els.colorCodeMode.addEventListener('change', ()=>{
      state.codeMode = els.colorCodeMode.value==='hex' ? 'hex' : 'pms';
      renderCodeList(); updateMailto();
    });
  }

  // Alt-click add color from preview (desktop)
  els.srcCanvas?.addEventListener('click',(evt)=>{
    if(!evt.altKey) return;
    const rect=els.srcCanvas.getBoundingClientRect();
    const x=Math.floor((evt.clientX-rect.left)*els.srcCanvas.width/rect.width);
    const y=Math.floor((evt.clientY-rect.top )*els.srcCanvas.height/rect.height);
    const d=sctx.getImageData(x,y,1,1).data;
    addPaletteRow(rgbToHex(d[0],d[1],d[2]));
    renderCodeList(); updateMailto();
  });
}

/////////////////////////////// Init ///////////////////////////////
async function init(){
  try{
    // Minimal defaults
    if(els.maxW) els.maxW.value = els.maxW.value || '1400';
    if(els.keepFullRes) els.keepFullRes.checked = true;

    // Load PMS DB (optional)
    await loadPmsJson();

    // Wire UI
    wire();
    updateWeightsUI();
    renderCodeList(); updateMailto();

    // Small onboarding toasts
    setTimeout(()=>toast('Tip: Use the Eyedrop tool (press & hold) to add colors'), 600);
    setTimeout(()=>toast('Use “Suggest by Hue & Luma” to auto-fill replacement rules'), 1600);
    setTimeout(()=>toast('Then tap “Refresh Mapping” to apply the rules'), 2600);

    // Initial palette in case nothing is loaded
    if(!els.paletteList?.children.length){
      setPalette(['#FFFFFF','#000000']);
    }

    // Prepare empty rules table
    renderRulesTable();

  }catch(e){ console.error(e); }
}

window.addEventListener('load', init);

/* END */
