/* Palette Mapper — Cup Print Helper (FULL JS v12)
   - Robust image load + EXIF
   - Auto palette (hybrid histogram + k-means)
   - Full-res mapping (optional sharpen + FS dither)
   - Texture rules (replace one palette color with mixed pattern of other inks)
     • modes: Checker / Stripe / Stipple
     • per-rule density slider + luma-adaptive toggle
     • add / edit / delete rules
   - Suggestions
     • Suggest replacements by Luminance (grays → Black/White ratio)
     • Suggest replacements by Hue (choose nearest two inks by hue)
     • Smart Mix (target swatch + allowed inks; searches pair/triple ratios to minimize ΔE)
   - Vector export (Vectorize or ImageTracer fallback)
   - Editor eyedropper (iPhone long-press) + add to palette
   - High-res export scale ×1/×2/×4
   - Toast hints
*/

/* ---------------- DOM ---------------- */
const els = {
  // load
  fileInput:  document.getElementById('fileInput'),
  cameraInput:document.getElementById('cameraInput'),
  pasteBtn:   document.getElementById('pasteBtn'),
  resetBtn:   document.getElementById('resetBtn'),

  maxW:       document.getElementById('maxW'),
  keepFullRes:document.getElementById('keepFullRes'),
  sharpenEdges:document.getElementById('sharpenEdges'),

  srcCanvas:  document.getElementById('srcCanvas'),
  outCanvas:  document.getElementById('outCanvas'),

  // palette
  paletteList:document.getElementById('paletteList'),
  addColor:   document.getElementById('addColor'),
  clearColors:document.getElementById('clearColors'),
  loadExample:document.getElementById('loadExample'),
  savedPalettes:document.getElementById('savedPalettes'),
  savePalette:document.getElementById('savePalette'),
  clearSavedPalettes:document.getElementById('clearSavedPalettes'),

  kColors:    document.getElementById('kColors'),
  autoExtract:document.getElementById('autoExtract'),

  // mapping
  wChroma:    document.getElementById('wChroma'),
  wLight:     document.getElementById('wLight'),
  wChromaOut: document.getElementById('wChromaOut'),
  wLightOut:  document.getElementById('wLightOut'),

  useDither:  document.getElementById('useDither'),
  bgMode:     document.getElementById('bgMode'),
  applyBtn:   document.getElementById('applyBtn'),
  downloadBtn:document.getElementById('downloadBtn'),
  exportScale:document.getElementById('exportScale'), // optional select (1x/2x/4x)

  // vector
  vecSimplify:document.getElementById('vecSimplify'),
  vecMinArea: document.getElementById('vecMinArea'),
  vecLock:    document.getElementById('vecLockPalette'),
  downloadSvg:document.getElementById('downloadSvg'),

  // texture rules (upper section)
  texTarget:  document.getElementById('texTarget'),
  texMode:    document.getElementById('texMode'),
  texMixA:    document.getElementById('texMixA'),
  texMixB:    document.getElementById('texMixB'),
  texDensity: document.getElementById('texDensity'),
  texLuma:    document.getElementById('texLumaAdaptive'),
  texAddRule: document.getElementById('texAddRule'),
  texClear:   document.getElementById('texClear'),
  texRulesList:document.getElementById('texRules'),

  // suggestions & smart mix
  suggestBtn: document.getElementById('suggestBtn'),
  suggestHue: document.getElementById('suggestHue'),   // checkbox (include hue suggestions)
  suggestGray:document.getElementById('suggestGray'),  // checkbox (include grayscale suggestions)
  smartBtn:   document.getElementById('smartBtn'),
  smartTargetHex: document.getElementById('smartTargetHex'),
  smartAllowWhite:document.getElementById('smartAllowWhite'),
  smartAllowBlack:document.getElementById('smartAllowBlack'),
  smartUseTriples:document.getElementById('smartTriples'),
  smartStep:  document.getElementById('smartStep'),

  // refresh
  refreshMapped: document.getElementById('refreshMapped'),

  // codes/report (unchanged)
  colorCodeMode: document.getElementById('colorCodeMode'),
  codeList:      document.getElementById('codeList'),
  exportReport:  document.getElementById('exportReport'),
  mailtoLink:    document.getElementById('mailtoLink'),

  // editor overlay (unchanged)
  openEditor:    document.getElementById('openEditor'),
  editorOverlay: document.getElementById('editorOverlay'),
  toolEyedrop:   document.getElementById('toolEyedrop'),
  toolLasso:     document.getElementById('toolLasso'),
  toolPan:       document.getElementById('toolPan'),
  editorDone:    document.getElementById('editorDone'),
  editCanvas:    document.getElementById('editCanvas'),
  editOverlay:   document.getElementById('editOverlay'),
  editorPalette: document.getElementById('editorPalette'),
  lassoChecks:   document.getElementById('lassoChecks'),
  lassoSave:     document.getElementById('lassoSave'),
  lassoClear:    document.getElementById('lassoClear'),
  eyeSwatch:     document.getElementById('eyeSwatch'),
  eyeHex:        document.getElementById('eyeHex'),
  eyeAdd:        document.getElementById('eyeAdd'),
  eyeCancel:     document.getElementById('eyeCancel'),
};

const sctx = els.srcCanvas?.getContext('2d', { willReadFrequently:true });
const octx = els.outCanvas?.getContext('2d', { willReadFrequently:true });
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

/* ---------------- State ---------------- */
const state = {
  fullBitmap: null,     // ImageBitmap or <img>
  fullW: 0, fullH: 0, exifOrientation: 1,
  lastSrcData: null,    // preview imageData for luma-adaptive references
  lastMapFull: null,    // ImageData at processing resolution (for texture and vector)
  palette: [],          // cached RGB[][] for convenience
  textureRules: [],     // [{id,target,mode,mixA,mixB,density(0..1),lumaAdaptive:true}]
  codeMode: 'pms',      // 'pms' | 'hex'
};

/* ---------------- Small helpers & toasts ---------------- */
const clamp = (v, lo, hi)=> v<lo?lo: v>hi?hi: v;
const uid = ()=>'r_'+Math.random().toString(36).slice(2,9);
const hexToRgb=(h)=>{let m=/^#?([0-9a-f]{6})$/i.exec(String(h).trim()); if(!m) return null; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};};
const rgbToHex=(r,g,b)=> '#'+[r,g,b].map(v=>clamp(v,0,255).toString(16).padStart(2,'0')).join('').toUpperCase();

function toast(msg, ms=2200){
  let host=document.getElementById('toasts');
  if(!host){ host=document.createElement('div'); host.id='toasts';
    host.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:grid;gap:8px;z-index:99999';
    document.body.appendChild(host);
  }
  const t=document.createElement('div');
  t.style.cssText='background:#111826cc;color:#e5eef8;border:1px solid #2a3243;padding:10px 12px;border-radius:10px;backdrop-filter:blur(6px)';
  t.textContent=msg; host.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .25s'; setTimeout(()=>t.remove(),280); }, ms);
}

/* ---------------- Image load + EXIF ---------------- */
function isHeicFile(f){
  const n=(f.name||'').toLowerCase(), t=(f.type||'').toLowerCase();
  return n.endsWith('.heic')||n.endsWith('.heif')||t.includes('heic')||t.includes('heif');
}
function isLikelyJpeg(f){
  const t=(f.type||'').toLowerCase(), ext=(f.name||'').split('.').pop().toLowerCase();
  return t.includes('jpeg')||t.includes('jpg')||ext==='jpg'||ext==='jpeg';
}
function readJpegOrientation(file){
  return new Promise(res=>{
    const r=new FileReader();
    r.onload=()=>{
      try{
        const v=new DataView(r.result);
        if(v.getUint16(0,false)!==0xFFD8) return res(1);
        let off=2; const len=v.byteLength;
        while(off<len){
          const marker=v.getUint16(off,false); off+=2;
          if(marker===0xFFE1){
            const exifLen=v.getUint16(off,false); off+=2;
            if(v.getUint32(off,false)!==0x45786966) break; off+=6;
            const tiff=off; const little=(v.getUint16(tiff,false)===0x4949);
            const g16=o=>v.getUint16(o,little), g32=o=>v.getUint32(o,little);
            const ifd=g32(tiff+4); if(ifd<8) return res(1);
            const dir=tiff+ifd; const n=g16(dir);
            for(let i=0;i<n;i++){ const e=dir+2+i*12; const tag=g16(e);
              if(tag===0x0112){ const o=g16(e+8)||1; return res(o); }
            }
            break;
          }else if((marker&0xFF00)!==0xFF00){ break; }
          else off+=v.getUint16(off,false);
        }
      }catch{}
      res(1);
    };
    r.onerror=()=>res(1);
    r.readAsArrayBuffer(file.slice(0,256*1024));
  });
}
function drawImageWithOrientation(ctx, img, w, h, o){
  ctx.save();
  if ([5,6,7,8].includes(o)){ ctx.translate(h,0); ctx.rotate(0.5*Math.PI); [w,h]=[h,w]; }
  switch(o){
    case 2: ctx.translate(w,0); ctx.scale(-1,1); break;
    case 3: ctx.translate(w,h); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0,h); ctx.scale(1,-1); break;
    case 5: ctx.scale(1,-1); break;
    case 6: ctx.translate(0,-w); break;
    case 7: ctx.translate(h,-w); ctx.scale(-1,1); break;
    case 8: ctx.translate(-h,0); break;
  }
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img,0,0);
  ctx.restore();
}

const MAX_PREVIEW_WIDTH=2000;

async function handleFile(file){
  try{
    if(!file) return;
    if(isHeicFile(file)){
      alert('This looks like HEIC/HEIF and can’t be decoded to canvas in this browser. Use JPG/PNG or set iPhone → Camera → Formats → Most Compatible.');
      return;
    }
    state.exifOrientation=1;

    // Fast path: ImageBitmap w/ EXIF honored
    if (typeof createImageBitmap==='function'){
      try{
        const bmp = await createImageBitmap(file, { imageOrientation:'from-image' });
        state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exifOrientation=1;
        drawPreviewFromState(); return;
      }catch(e){ /* fallthrough */ }
    }

    // Fallback: <img> + manual EXIF for JPEG
    const url=URL.createObjectURL(file);
    const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
    URL.revokeObjectURL(url);
    state.fullBitmap=img; state.fullW=img.naturalWidth||img.width; state.fullH=img.naturalHeight||img.height;
    state.exifOrientation=isLikelyJpeg(file)? await readJpegOrientation(file) : 1;
    drawPreviewFromState();
  }catch(e){
    console.error(e); alert('Could not open that image. Try a JPG/PNG.');
  }finally{
    if(els.fileInput) els.fileInput.value='';
    if(els.cameraInput) els.cameraInput.value='';
  }
}

function drawPreviewFromState(){
  const bmp=state.fullBitmap; if(!bmp) return;
  const o=state.exifOrientation||1;
  let w=bmp.width||bmp.naturalWidth, h=bmp.height||bmp.naturalHeight;
  // oriented dims
  if([5,6,7,8].includes(o)) [w,h]=[h,w];

  const maxW=MAX_PREVIEW_WIDTH;
  if(w>maxW){ const s=maxW/w; w=Math.round(w*s); h=Math.round(h*s); }

  els.srcCanvas.width=w; els.srcCanvas.height=h;
  sctx.clearRect(0,0,w,h);
  if(o===1 && bmp instanceof ImageBitmap) sctx.drawImage(bmp,0,0,w,h);
  else {
    const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
    const tc=tmp.getContext('2d'); tc.imageSmoothingEnabled=false; tc.drawImage(bmp,0,0,w,h);
    sctx.drawImage(tmp,0,0);
  }

  els.outCanvas.width=w; els.outCanvas.height=h; octx.clearRect(0,0,w,h);
  if(els.autoExtract) els.autoExtract.disabled=false;
  if(els.applyBtn) els.applyBtn.disabled=false;
  if(els.resetBtn) els.resetBtn.disabled=false;

  // Auto palette
  setTimeout(()=>{ try{
    autoPaletteFromCanvasHybrid(els.srcCanvas, 10); // seeds; user can prune
    toast('Palette auto-extracted. Long-press in editor to add more colors.');
  }catch(e){ console.warn(e); }}, 0);
}

/* ---------------- Palette UI ---------------- */
function addPaletteRow(hex='#FFFFFF'){
  const row=document.createElement('div'); row.className='palette-item';
  row.innerHTML=`
    <input type="color" value="${hex}" aria-label="color picker">
    <input type="text" value="${hex}" aria-label="hex code" placeholder="#RRGGBB">
    <button class="ghost remove" type="button">Remove</button>
  `;
  const color=row.querySelector('input[type=color]'), text=row.querySelector('input[type=text]');
  const del=row.querySelector('.remove');
  const sync=(fromColor)=>{
    if(fromColor) text.value=color.value.toUpperCase();
    let v=text.value.trim(); if(!v.startsWith('#')) v='#'+v;
    if(/^#([0-9a-fA-F]{6})$/.test(v)){ color.value=v; text.value=v.toUpperCase(); }
  };
  color.addEventListener('input',()=>{ sync(true); onPaletteChanged(); });
  text.addEventListener('change',()=>{ sync(false); onPaletteChanged(); });
  del.addEventListener('click',()=>{ row.remove(); onPaletteChanged(); });
  els.paletteList.appendChild(row);
}
function getPalette(){
  const rows=[...els.paletteList.querySelectorAll('.palette-item')];
  const arr=[]; for(const r of rows){
    const v=r.querySelector('input[type=text]').value.trim();
    const rgb=hexToRgb(v); if(rgb) arr.push([rgb.r,rgb.g,rgb.b]);
  }
  state.palette=arr;
  return arr;
}
function setPalette(hexes){
  els.paletteList.innerHTML='';
  hexes.forEach(h=>addPaletteRow(h));
  onPaletteChanged();
}
function onPaletteChanged(){
  state.palette = getPalette();
  renderCodeList(); updateMailto(); renderTextureSelectors();
  enableVectorButtonIfReady();
}

/* saved palettes quickload */
function loadSavedPalettes(){ try{ return JSON.parse(localStorage.getItem('pm_saved_palettes_v1')||'[]'); }catch{ return []; } }
function saveSavedPalettes(list){ localStorage.setItem('pm_saved_palettes_v1', JSON.stringify(list)); }
function renderSavedPalettes(){
  const box=els.savedPalettes; if(!box) return;
  box.innerHTML='';
  const list=loadSavedPalettes();
  list.forEach((p,idx)=>{
    const div=document.createElement('div'); div.className='item';
    const sw=p.colors.map(h=>`<span class="sw" style="display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid #334;background:${h}"></span>`).join('');
    div.innerHTML=`<div><strong>${p.name||('Palette '+(idx+1))}</strong><br><small>${p.colors.join(', ')}</small></div><div>${sw}</div>`;
    div.addEventListener('click',()=>{ setPalette(p.colors); });
    box.appendChild(div);
  });
}

/* ---------------- Color math ---------------- */
function srgbToLinear(u){ u/=255; return (u<=0.04045)?u/12.92:Math.pow((u+0.055)/1.055,2.4); }
function linearToSrgb(u){ return u<=0.0031308 ? 255*(12.92*u) : 255*(1.055*Math.pow(u,1/2.4)-0.055); }
function rgbToLab(r,g,b){
  r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b);
  let x=r*0.4124564 + g*0.3575761 + b*0.1804375;
  let y=r*0.2126729 + g*0.7151522 + b*0.0721750;
  let z=r*0.0193339 + g*0.1191920 + b*0.9503041;
  const f=t=>(t>0.008856)?Math.cbrt(t):(7.787*t+16/116);
  const fx=f(x/0.95047), fy=f(y/1.00000), fz=f(z/1.08883);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
function deltaE2Weighted(l1,l2,wL,wC){ const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2]; return wL*dL*dL + wC*(da*da+db*db); }
function luminance(r,g,b){ return (0.2126*r + 0.7152*g + 0.0722*b)/255; }

/* ---------------- Auto palette (hybrid) ---------------- */
function kmeans(data,k=6,iters=10){
  const n=data.length/4;
  const centers=[]; for(let c=0;c<k;c++){ const idx=Math.floor((c+0.5)*n/k); centers.push([data[idx*4],data[idx*4+1],data[idx*4+2]]); }
  const sums=new Array(k).fill(0).map(()=>[0,0,0]); const counts=new Array(k).fill(0);
  for(let it=0; it<iters; it++){
    counts.fill(0); for(const s of sums){ s[0]=s[1]=s[2]=0; }
    for(let i=0;i<n;i++){
      const a=data[i*4+3]; if(a<8) continue;
      const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
      let best=0, bestD=1e12;
      for(let c=0;c<k;c++){ const dr=r-centers[c][0], dg=g-centers[c][1], db=b-centers[c][2]; const d=dr*dr+dg*dg+db*db; if(d<bestD){bestD=d; best=c;} }
      counts[best]++; sums[best][0]+=r; sums[best][1]+=g; sums[best][2]+=b;
    }
    for(let c=0;c<k;c++){ if(counts[c]>0){ centers[c][0]=Math.round(sums[c][0]/counts[c]); centers[c][1]=Math.round(sums[c][1]/counts[c]); centers[c][2]=Math.round(sums[c][2]/counts[c]); } }
  }
  return centers;
}
function autoPaletteFromCanvasHybrid(canvas, k=10){
  if(!canvas || !canvas.width) return;
  const ctx=canvas.getContext('2d', {willReadFrequently:true});
  const img=ctx.getImageData(0,0,canvas.width,canvas.height).data;

  // 5-bit histogram seed
  const bins=new Map();
  for(let i=0;i<img.length;i+=4){ const a=img[i+3]; if(a<16) continue;
    const r=img[i]>>3, g=img[i+1]>>3, b=img[i+2]>>3; const key=(r<<10)|(g<<5)|b;
    bins.set(key,(bins.get(key)||0)+1);
  }
  const seeds=[...bins.entries()].sort((a,b)=>b[1]-a[1]).slice(0,Math.min(48,k*4)).map(([key])=>{
    const r=((key>>10)&31)<<3, g=((key>>5)&31)<<3, b=(key&31)<<3; return [r,g,b];
  });

  // init centers from seeds
  const centers=kmeansFromSeeds(img,k,seeds,8);
  const hexes=centers.map(([r,g,b])=>rgbToHex(r,g,b));
  setPalette(hexes);
}
function kmeansFromSeeds(data,k,seeds,iters=8){
  const picked=[]; for(let i=0;i<k;i++) picked.push(seeds[Math.floor((i+0.5)*seeds.length/k)]);
  const centers=picked.map(c=>c.slice());
  const n=data.length/4;
  const sums=new Array(k).fill(0).map(()=>[0,0,0]); const counts=new Array(k).fill(0);
  for(let it=0;it<iters;it++){
    counts.fill(0); for(const s of sums){ s[0]=s[1]=s[2]=0; }
    for(let i=0;i<n;i++){
      const a=data[i*4+3]; if(a<8) continue;
      const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
      let best=0,bestD=1e12;
      for(let c=0;c<k;c++){ const dr=r-centers[c][0],dg=g-centers[c][1],db=b-centers[c][2]; const d=dr*dr+dg*dg+db*db; if(d<bestD){bestD=d; best=c;} }
      counts[best]++; sums[best][0]+=r; sums[best][1]+=g; sums[best][2]+=b;
    }
    for(let c=0;c<k;c++){ if(counts[c]>0){ centers[c][0]=Math.round(sums[c][0]/counts[c]); centers[c][1]=Math.round(sums[c][1]/counts[c]); centers[c][2]=Math.round(sums[c][2]/counts[c]); } }
  }
  return centers;
}

/* ---------------- Mapping to palette + FS ---------------- */
function buildPalLab(pal){ return pal.map(([r,g,b])=>({rgb:[r,g,b], lab:rgbToLab(r,g,b)})); }
function mapToPalette(imgData, palette, wL=1, wC=1, dither=false, bgMode='keep'){
  const w=imgData.width,h=imgData.height, src=imgData.data;
  const out=new ImageData(w,h);
  out.data.set(src);

  const palLab=buildPalLab(palette);
  const errR=dither?new Float32Array(w*h):null, errG=dither?new Float32Array(w*h):null, errB=dither?new Float32Array(w*h):null;

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx=y*w+x, i4=idx*4;
      if(out.data[i4+3]===0){ continue; }
      let r=out.data[i4], g=out.data[i4+1], b=out.data[i4+2];

      if(dither){ r=clamp(Math.round(r+(errR[idx]||0)),0,255);
                  g=clamp(Math.round(g+(errG[idx]||0)),0,255);
                  b=clamp(Math.round(b+(errB[idx]||0)),0,255); }

      const lab=rgbToLab(r,g,b);
      let best=0, bestD=1e12;
      for(let p=0;p<palLab.length;p++){
        const d=deltaE2Weighted(lab, palLab[p].lab, wL, wC);
        if(d<bestD){ bestD=d; best=p; }
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

/* ---------------- Unsharp (edge emphasis for text) ---------------- */
function unsharpMask(id, amount=0.35){
  const w=id.width, h=id.height, src=id.data, out=new ImageData(w,h);
  out.data.set(src);
  const k=[0,-1,0,-1,5,-1,0,-1,0];
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      let r=0,g=0,b=0, ki=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++,ki++){
          const i=((y+dy)*w+(x+dx))*4, kv=k[ki];
          r+=src[i]*kv; g+=src[i+1]*kv; b+=src[i+2]*kv;
        }
      }
      const o=(y*w+x)*4;
      out.data[o  ]=clamp((1-amount)*src[o]  + amount*r,0,255);
      out.data[o+1]=clamp((1-amount)*src[o+1]+ amount*g,0,255);
      out.data[o+2]=clamp((1-amount)*src[o+2]+ amount*b,0,255);
      out.data[o+3]=src[o+3];
    }
  }
  return out;
}

/* ---------------- Texture rules (replace one color) ---------------- */
function renderTextureSelectors(){
  const pal=getPalette(); if(!pal.length) return;
  const opts = pal.map((rgb,i)=> `<option value="${i}">${i+1}. ${rgbToHex(rgb[0],rgb[1],rgb[2])}</option>`).join('');
  if(els.texTarget) els.texTarget.innerHTML = `<option value="auto">auto</option>${opts}`;
  if(els.texMixA)   els.texMixA.innerHTML   = `<option value="auto">auto</option>${opts}`;
  if(els.texMixB)   els.texMixB.innerHTML   = `<option value="auto">auto</option>${opts}`;
}

/** Pattern samplers */
function pattIndexChecker(x,y,period=2){ return (x+y)%(period*2) < period ? 1 : 0; }
function pattIndexStripe(x,y,period=4){ return (x%(period*2)) < period ? 1 : 0; }
function pattIndexStipple(x,y){ // simple hash-based blue-ish noise
  let n = (x*374761393 + y*668265263) ^ (x<<13);
  n = (n*(n*n*15731 + 789221)+1376312589) & 0x7fffffff;
  return (n & 1023) < 512 ? 1 : 0;
}

function applyTextureRules(mapped, srcData, rules, palette){
  if(!rules.length) return mapped;
  const w=mapped.width, h=mapped.height, out=new ImageData(w,h); out.data.set(mapped.data);
  const palHex=palette.map(([r,g,b])=> rgbToHex(r,b?g:0,b?b:0)); // (fast compare uses hex of mapped, but mapped is RGB already)
  const patt = {
    'checker':pattIndexChecker,
    'stripe': pattIndexStripe,
    'stipple':pattIndexStipple
  };
  const src=srcData ? srcData.data : null;

  for(const rule of rules){
    const targetIdx = rule.target==='auto' ? null : Number(rule.target);
    const mode = rule.mode||'checker', mixA=Number(rule.mixA), mixB=Number(rule.mixB);
    const density = clamp(Number(rule.density)||0.5, 0, 1);
    const sampler = patt[mode]||pattIndexChecker;

    const [aR,aG,aB]=palette[mixA]||[0,0,0];
    const [bR,bG,bB]=palette[mixB]||[255,255,255];

    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i=(y*w+x)*4;
        if(out.data[i+3]===0) continue;

        // must match target color?
        if(targetIdx!=null){
          const tr=palette[targetIdx][0], tg=palette[targetIdx][1], tb=palette[targetIdx][2];
          if(out.data[i]!==tr || out.data[i+1]!==tg || out.data[i+2]!==tb) continue;
        }

        // adaptive density
        let d=density;
        if(rule.lumaAdaptive && src){
          const L=luminance(src[i],src[i+1],src[i+2]); // 0..1
          // darker source -> more of darker ink (pick which is darker by Y)
          const aY=luminance(aR,aG,aB), bY=luminance(bR,bG,bB);
          const darkIsA = aY<bY;
          const t = 1-L; // dark -> larger t
          d = darkIsA ? clamp( (density*0.5) + t*0.5, 0,1 ) : clamp( (density*0.5) + (1-t)*0.5, 0,1 );
        }

        // threshold by pattern sampler
        const bit = sampler(x,y,4); // period constant looks good for cups
        const chooseA = bit ? (Math.random()<d) : (Math.random()<d); // uniform test; using bit just to decorrelate slightly
        if(chooseA){
          out.data[i]=aR; out.data[i+1]=aG; out.data[i+2]=aB;
        }else{
          out.data[i]=bR; out.data[i+1]=bG; out.data[i+2]=bB;
        }
      }
    }
  }
  return out;
}

/* ---------------- UI: rules list (per-rule density adjust + delete) ---------------- */
function renderRulesUI(){
  if(!els.texRulesList) return;
  const pal=getPalette();
  els.texRulesList.innerHTML = state.textureRules.map((r,idx)=>{
    const targ = r.target==='auto' ? 'auto' : `${Number(r.target)+1}`;
    const aHex = pal[r.mixA] ? rgbToHex(...pal[r.mixA]) : '—';
    const bHex = pal[r.mixB] ? rgbToHex(...pal[r.mixB]) : '—';
    const la = r.lumaAdaptive? ' • luma-adaptive':'';
    return `
      <div class="rule" data-id="${r.id}">
        <div class="row" style="gap:8px;align-items:center">
          <div class="mono">${idx+1}) ${targ} → ${r.mode} with <span>${aHex}</span> & <span>${bHex}</span></div>
          <label style="margin-left:auto">density <input type="range" min="0" max="100" value="${Math.round((r.density||0.5)*100)}" class="rule-density"></label>
          <label class="check"><input type="checkbox" class="rule-luma" ${r.lumaAdaptive?'checked':''}> adaptive</label>
          <button type="button" class="ghost rule-del">Delete</button>
        </div>
      </div>`;
  }).join('') || '<div class="help">No texture rules yet.</div>';

  els.texRulesList.querySelectorAll('.rule').forEach(div=>{
    const id=div.dataset.id;
    const R = state.textureRules.find(r=>r.id===id); if(!R) return;
    const dens=div.querySelector('.rule-density');
    const luma=div.querySelector('.rule-luma');
    const del =div.querySelector('.rule-del');
    dens.addEventListener('input',()=>{ R.density = Number(dens.value)/100; });
    dens.addEventListener('change',()=>{ R.density = Number(dens.value)/100; runApply(true); });
    luma.addEventListener('change',()=>{ R.lumaAdaptive = !!luma.checked; runApply(true); });
    del.addEventListener('click',()=>{ state.textureRules = state.textureRules.filter(r=>r.id!==id); renderRulesUI(); runApply(true); });
  });
}

function addTextureRuleFromUI(){
  const pal=getPalette(); if(!pal.length) return alert('Add colors first.');
  const target = els.texTarget?.value || 'auto';
  const mode   = els.texMode?.value || 'checker';
  const mixA   = (els.texMixA?.value||'auto');
  const mixB   = (els.texMixB?.value||'auto');
  if(mixA==='auto'||mixB==='auto'){
    toast('Choose Mix A and Mix B from the palette.'); return;
  }
  const r = {
    id: uid(), target, mode, mixA:Number(mixA), mixB:Number(mixB),
    density: Number(els.texDensity?.value||'50')/100,
    lumaAdaptive: !!(els.texLuma && els.texLuma.checked),
  };
  state.textureRules.push(r);
  renderRulesUI();
  runApply(true);
}

/* ---------------- Suggestions ---------------- */
// (A) grayscale suggestions: map mid-grays to B/W ratio by luminance
function suggestGrayRules(){
  const pal=getPalette(); if(pal.length<2) return;
  // find best white + black candidates from palette by luminance extremes
  let wi=0, bi=0, minY=1e9, maxY=-1e9;
  for(let i=0;i<pal.length;i++){
    const Y=luminance(...pal[i]);
    if(Y<minY){ minY=Y; bi=i; }
    if(Y>maxY){ maxY=Y; wi=i; }
  }
  if(bi===wi) return [];

  // Scan mapped image to find unique grayish colors (low chroma in Lab)
  const mapped = state.lastMapFull; if(!mapped) return [];
  const uniq=new Map(); // hex -> {count, lab, idxInPal}
  const palHex = pal.map(([r,g,b])=> rgbToHex(r,g,b));
  const data=mapped.data;
  for(let i=0;i<data.length;i+=4){
    const hex=rgbToHex(data[i],data[i+1],data[i+2]);
    const pIdx = palHex.indexOf(hex);
    if(pIdx>=0){
      const lab=rgbToLab(data[i],data[i+1],data[i+2]);
      const chroma = Math.hypot(lab[1], lab[2]);
      if(chroma<8){ // grayish
        const rec=uniq.get(hex)||{count:0,lab,idx:pIdx};
        rec.count++; uniq.set(hex,rec);
      }
    }
  }
  // Build a rule per gray swatch → choose density by luminance between white & black
  const rules=[];
  uniq.forEach(({lab,idx})=>{
    const rgb=pal[idx]; const Y=luminance(rgb[0],rgb[1],rgb[2]);
    const Bw=luminance(...pal[bi]), Ww=luminance(...pal[wi]);
    const d = clamp((Y - Bw) / Math.max(1e-5, (Ww - Bw)), 0, 1);
    rules.push({ id:uid(), target:idx, mode:'checker', mixA:wi, mixB:bi, density:d, lumaAdaptive:true });
  });
  return rules;
}

// (B) hue suggestions: for each palette color whose hue is "between" two others, propose mix
function hueOf([r,g,b]){
  // use HSV hue
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  if(d===0) return -1;
  let h=0;
  switch(max){
    case r: h=(g-b)/d + (g<b?6:0); break;
    case g: h=(b-r)/d + 2; break;
    case b: h=(r-g)/d + 4; break;
  }
  return h/6; // 0..1
}
function suggestHueRules(){
  const pal=getPalette(); if(pal.length<3) return [];
  const hues=pal.map((rgb,i)=>({i,rgb,h:hueOf(rgb),Y:luminance(...rgb)})).filter(o=>o.h>=0);
  if(hues.length<3) return [];

  // For each palette swatch T, find two others A,B whose hues straddle T
  const rules=[];
  for(const T of hues){
    let bestA=null, bestB=null, bestGap=1e9;
    for(const A of hues){ if(A.i===T.i) continue;
      for(const B of hues){ if(B.i===T.i || B.i===A.i) continue;
        // closeness to hue line segment AB → T
        const hA=A.h, hB=B.h, hT=T.h;
        // compute distance from T to mid of A/B; prefer pairs around T
        const mid = ( (hA+hB)/2 + 0.5 )%1;
        const gap = Math.min( Math.abs(hT-mid), 1-Math.abs(hT-mid) );
        if(gap<bestGap){ bestGap=gap; bestA=A; bestB=B; }
      }
    }
    if(bestA && bestB){
      // Choose density so Y matches T between A & B by luminance
      const Ya=bestA.Y, Yb=bestB.Y, Yt=T.Y;
      const d = clamp((Yt - Yb) / Math.max(1e-5, (Ya-Yb)), 0, 1);
      rules.push({ id:uid(), target:T.i, mode:'checker', mixA:bestA.i, mixB:bestB.i, density:d, lumaAdaptive:true });
    }
  }
  return rules;
}

/* Smart Mix — search pairs (and triples) for best ΔE to target */
function mixRgbPair(a,b,ratio){ // ratio of A
  const ar=srgbToLinear(a[0]), ag=srgbToLinear(a[1]), ab=srgbToLinear(a[2]);
  const br=srgbToLinear(b[0]), bg=srgbToLinear(b[1]), bb=srgbToLinear(b[2]);
  let r = ar*ratio + br*(1-ratio);
  let g = ag*ratio + bg*(1-ratio);
  let b2= ab*ratio + bb*(1-ratio);
  return [ linearToSrgb(r)|0, linearToSrgb(g)|0, linearToSrgb(b2)|0 ];
}
function mixRgbTriple(a,b,c,ra,rb){ // rc = 1-ra-rb
  const rc = Math.max(0, 1-ra-rb);
  const la=[srgbToLinear(a[0]),srgbToLinear(a[1]),srgbToLinear(a[2])];
  const lb=[srgbToLinear(b[0]),srgbToLinear(b[1]),srgbToLinear(b[2])];
  const lc=[srgbToLinear(c[0]),srgbToLinear(c[1]),srgbToLinear(c[2])];
  const r = la[0]*ra + lb[0]*rb + lc[0]*rc;
  const g = la[1]*ra + lb[1]*rb + lc[1]*rc;
  const bb= la[2]*ra + lb[2]*rb + lc[2]*rc;
  return [ linearToSrgb(r)|0, linearToSrgb(g)|0, linearToSrgb(bb)|0 ];
}
function bestSmartMix(targetHex, allowedIdx=[], step=0.05, allowTriples=true){
  const pal=getPalette(); if(!pal.length) return null;
  const tRGB = hexToRgb(targetHex)||{r:0,g:0,b:0};
  const tLab = rgbToLab(tRGB.r,tRGB.g,tRGB.b);
  const wL=1, wC=1;

  let best=null, bestD=1e12, bestKind='pair';

  // pairs
  for(let i=0;i<allowedIdx.length;i++){
    for(let j=i+1;j<allowedIdx.length;j++){
      const A=pal[allowedIdx[i]], B=pal[allowedIdx[j]];
      for(let r=0;r<=1+1e-6;r+=step){
        const mix=mixRgbPair(A,B,r);
        const d=deltaE2Weighted(rgbToLab(...mix), tLab, wL, wC);
        if(d<bestD){ bestD=d; best={kind:'pair', A:allowedIdx[i], B:allowedIdx[j], r}; }
      }
    }
  }

  if(allowTriples && allowedIdx.length>=3){
    for(let i=0;i<allowedIdx.length;i++){
      for(let j=i+1;j<allowedIdx.length;j++){
        for(let k=j+1;k<allowedIdx.length;k++){
          const A=pal[allowedIdx[i]], B=pal[allowedIdx[j]], C=pal[allowedIdx[k]];
          for(let ra=0;ra<=1;ra+=step){
            for(let rb=0;rb<=1-ra;rb+=step){
              const mix=mixRgbTriple(A,B,C,ra,rb);
              const d=deltaE2Weighted(rgbToLab(...mix), tLab, wL, wC);
              if(d<bestD){ bestD=d; best={kind:'triple', A:allowedIdx[i], B:allowedIdx[j], C:allowedIdx[k], ra, rb}; }
            }
          }
        }
      }
    }
  }
  if(!best) return null;

  // Convert best into a *rule* (pair or reduce triple to chained rules A/B with B/C where needed).
  if(best.kind==='pair'){
    return {
      label:`pair ${best.A+1}/${best.B+1} r=${(best.r*100)|0}% ΔE≈${Math.sqrt(bestD).toFixed(1)}`,
      rule:{
        id:uid(), target:'auto', mode:'checker', mixA:best.A, mixB:best.B, density:best.r, lumaAdaptive:true
      }
    };
  }else{
    // We’ll collapse triple into A vs mix(B,C) approximation:
    const ra=best.ra, rb=best.rb, rc=Math.max(0,1-ra-rb);
    // Choose dominant two and fold the third into density bias.
    const arr=[{idx:best.A, w:ra},{idx:best.B, w:rb},{idx:best.C, w:rc}].sort((a,b)=>b.w-a.w);
    const A=arr[0], B=arr[1], bias=A.w/(A.w+B.w+1e-9);
    return {
      label:`triple ~ ${arr[0].idx+1}/${arr[1].idx+1} bias=${(bias*100)|0}% (3rd:${arr[2].idx+1}) ΔE≈${Math.sqrt(bestD).toFixed(1)}`,
      rule:{
        id:uid(), target:'auto', mode:'checker', mixA:A.idx, mixB:B.idx, density:bias, lumaAdaptive:true
      }
    };
  }
}

/* ---------------- APPLY / pipeline ---------------- */
function getProcessingCanvas(){
  // full-res or preview sized canvas w/ oriented draw
  const useFull = !!(els.keepFullRes && els.keepFullRes.checked) && state.fullBitmap;
  let w=state.fullW, h=state.fullH, o=state.exifOrientation||1;
  if(!useFull){ w=els.srcCanvas.width; h=els.srcCanvas.height; o=1; }

  const cn=document.createElement('canvas'); cn.width=w; cn.height=h; const cx=cn.getContext('2d',{willReadFrequently:true});
  cx.imageSmoothingEnabled=false;
  if(o===1 && state.fullBitmap instanceof ImageBitmap){ cx.drawImage(state.fullBitmap,0,0,w,h); }
  else if(o===1){ cx.drawImage(state.fullBitmap,0,0,w,h); }
  else{ drawImageWithOrientation(cx, state.fullBitmap, w, h, o); }
  return cn;
}

function runApply(quiet=false){
  const pal=getPalette(); if(!pal.length) return alert('Add at least one color.');
  const wL=(Number(els.wLight?.value||'100')/100), wC=(Number(els.wChroma?.value||'100')/100);
  const dither=!!(els.useDither && els.useDither.checked);
  const bg = (els.bgMode && els.bgMode.value) || 'keep';

  const proc = getProcessingCanvas();
  const pctx = proc.getContext('2d', {willReadFrequently:true});
  const srcData = pctx.getImageData(0,0,proc.width,proc.height);
  state.lastSrcData = srcData;

  // map
  let mapped = mapToPalette(srcData, pal, wL, wC, dither, bg);

  // sharpen text edges
  if(els.sharpenEdges && els.sharpenEdges.checked){
    mapped = unsharpMask(mapped, 0.35);
  }

  // texture replacement
  if(state.textureRules.length){
    mapped = applyTextureRules(mapped, srcData, state.textureRules, pal);
  }

  // Keep full-res ImageData for export/vector
  state.lastMapFull = mapped;

  // preview downscale (sharp)
  const previewW = Math.min(proc.width, Number(els.maxW?.value||'1400'));
  const scale = previewW / proc.width;
  els.outCanvas.width = Math.round(proc.width*scale);
  els.outCanvas.height= Math.round(proc.height*scale);
  const tmp=document.createElement('canvas'); tmp.width=mapped.width; tmp.height=mapped.height;
  tmp.getContext('2d').putImageData(mapped,0,0);
  octx.imageSmoothingEnabled=false; octx.clearRect(0,0,els.outCanvas.width,els.outCanvas.height);
  octx.drawImage(tmp,0,0,els.outCanvas.width,els.outCanvas.height);

  els.downloadBtn && (els.downloadBtn.disabled=false);
  enableVectorButtonIfReady();
  if(!quiet) toast('Mapping updated.');
}

function downloadPng(){
  const full = state.lastMapFull;
  if(!full){ alert('Nothing to export yet.'); return; }
  const scaleSel = Number(els.exportScale?.value || '1');
  const c=document.createElement('canvas'); c.width=full.width*scaleSel; c.height=full.height*scaleSel;
  const cx=c.getContext('2d'); cx.imageSmoothingEnabled=false;
  const tmp=document.createElement('canvas'); tmp.width=full.width; tmp.height=full.height;
  tmp.getContext('2d').putImageData(full,0,0);
  cx.drawImage(tmp,0,0,c.width,c.height);
  c.toBlob(b=>{
    const a=document.createElement('a'); a.download='mapped_fullres.png'; a.href=URL.createObjectURL(b); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  },'image/png');
}

/* ---------------- Vector export ---------------- */
function enableVectorButtonIfReady(){
  if(!els.downloadSvg) return;
  const ok = !!state.lastMapFull && (window.Vectorize || window.ImageTracer);
  els.downloadSvg.disabled = !ok;
}
async function downloadSVG(){
  if(!state.lastMapFull){ alert('Generate mapping first.'); return; }
  const pal=getPalette();

  // lock to current palette if requested
  const lock = !!(els.vecLock && els.vecLock.checked);

  if(window.Vectorize){
    // vector.js (custom): assume Vectorize.imageDataToSvg(imageData,{palette:[hex...]})
    const hexPal = pal.map(([r,g,b])=>rgbToHex(r,g,b));
    const svg = await window.Vectorize.imageDataToSvg(state.lastMapFull, {
      palette: lock?hexPal:null,
      simplify: Number(els.vecSimplify?.value||'0.5'),
      minArea: Number(els.vecMinArea?.value||'8')|0
    });
    const blob=new Blob([svg],{type:'image/svg+xml'}); const a=document.createElement('a'); a.download='mapped.svg'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    return;
  }
  if(window.ImageTracer){
    const cn=document.createElement('canvas'); cn.width=state.lastMapFull.width; cn.height=state.lastMapFull.height;
    cn.getContext('2d').putImageData(state.lastMapFull,0,0);
    const opts={ pathomit: Number(els.vecMinArea?.value||'8')|0, colorsampling:0, numberofcolors:pal.length, colorquantcycles:1 };
    if(lock){ opts.pal = pal.map(([r,g,b])=>({r,g,b,a:255})); opts.palettesampling=0; }
    const svg=window.ImageTracer.imagedataToSVG(cn.getContext('2d').getImageData(0,0,cn.width,cn.height), opts);
    const blob=new Blob([svg],{type:'image/svg+xml'}); const a=document.createElement('a'); a.download='mapped.svg'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    return;
  }
  alert('No vectorizer found. Include vector.js or ImageTracer.');
}

/* ---------------- Codes / report (unchanged, but hide replaced) ---------------- */
let PMS_LIB=[]; const PMS_CACHE=new Map();
async function loadPmsJson(url='pms_solid_coated.json'){ try{ PMS_LIB = await (await fetch(url,{cache:'no-store'})).json(); }catch{ PMS_LIB=[]; } }
function nearestPms(hex){
  if(PMS_CACHE.has(hex)) return PMS_CACHE.get(hex);
  if(!PMS_LIB.length){ const o={name:'—',hex,deltaE:0}; PMS_CACHE.set(hex,o); return o; }
  const r=hexToRgb(hex); const l=rgbToLab(r.r,r.g,r.b); let best=null,bestD=1e12;
  for(const sw of PMS_LIB){ const r2=hexToRgb(sw.hex); if(!r2) continue; const d=deltaE2Weighted(l, rgbToLab(r2.r,r2.g,r2.b),1,1); if(d<bestD){ bestD=d; best={name:sw.name,hex:sw.hex,deltaE:Math.sqrt(d)}; } }
  PMS_CACHE.set(hex,best); return best;
}
function currentPaletteCodes(){
  // Hide palette entries that are targets of active replacement (since they are replaced)
  const hiddenTargets=new Set(state.textureRules.map(r=> (r.target==='auto'?null:Number(r.target))).filter(v=>v!=null));
  return getPalette().map(([r,g,b],i)=>{
    const hex=rgbToHex(r,g,b);
    if(hiddenTargets.has(i)) return null;
    if(state.codeMode==='hex') return {hex,label:hex,swatchHex:hex};
    const p=nearestPms(hex); return {hex,label:`${p.name} (${p.hex}) ΔE≈${p.deltaE.toFixed(1)}`, swatchHex:p.hex};
  }).filter(Boolean);
}
function renderCodeList(){
  if(!els.codeList) return;
  const rows=currentPaletteCodes().map((c,i)=> `<div class="row"><span class="sw" style="width:14px;height:14px;border:1px solid #334;border-radius:3px;display:inline-block;background:${c.swatchHex}"></span>${i+1}. ${c.label}</div>`);
  els.codeList.innerHTML = rows.join('') || '<em>No colors</em>';
}
function buildPrinterReport(){
  const items=currentPaletteCodes();
  const lines=[
    'Project: Palette Mapper output',
    `Colors used (after replacements): ${items.length}`,
    `Code mode: ${state.codeMode.toUpperCase()}`,
    '',
    ...items.map((c,i)=>`${i+1}. ${c.label}`)
  ];
  return lines.join('\n');
}
function updateMailto(){
  const subject=encodeURIComponent(state.codeMode==='pms'?'Print job: artwork + PMS palette':'Print job: artwork + HEX palette');
  const preview=buildPrinterReport().split('\n').slice(0,24).join('\n');
  const body=encodeURIComponent(`Hi,\n\nPlease find attached the artwork PNG/SVG and the palette list.\n\nReport (preview):\n${preview}\n\nThanks!`);
  if(els.mailtoLink) els.mailtoLink.href=`mailto:?subject=${subject}&body=${body}`;
}

/* ---------------- Editor (eyedrop + lasso; keep simple here) ---------------- */
const editor={active:false, ectx:null, octx:null, eyedropTimer:null, currentHex:'#000000', lassoPts:[]};
function openEditor(){
  if(!state.fullBitmap) return alert('Load an image first.');
  const vw=innerWidth, vh=innerHeight, rightW=320, tb=46;
  els.editorOverlay.classList.remove('hidden'); els.editorOverlay.setAttribute('aria-hidden','false'); editor.active=true;
  els.editCanvas.width=vw-rightW; els.editCanvas.height=vh-tb;
  els.editOverlay.width=els.editCanvas.width; els.editOverlay.height=els.editCanvas.height;
  editor.ectx=els.editCanvas.getContext('2d',{willReadFrequently:true});
  editor.octx=els.editOverlay.getContext('2d',{willReadFrequently:true});
  editor.ectx.imageSmoothingEnabled=false; editor.octx.imageSmoothingEnabled=false;
  editor.ectx.clearRect(0,0,els.editCanvas.width,els.editCanvas.height);
  editor.ectx.drawImage(els.srcCanvas,0,0,els.editCanvas.width,els.editCanvas.height);
  renderEditorPalette();
  enableEditorEyedrop();
  toast('Tip: long-press to sample; “Add” drops color into the main palette.');
}
function closeEditor(){ els.editorOverlay.classList.add('hidden'); els.editorOverlay.setAttribute('aria-hidden','true'); disableEditorEyedrop(); editor.active=false; }
function renderEditorPalette(){
  if(!els.editorPalette) return; els.editorPalette.innerHTML='';
  getPalette().forEach(([r,g,b])=>{ const sw=document.createElement('span'); sw.className='sw'; sw.style.background=rgbToHex(r,g,b); els.editorPalette.appendChild(sw); });
}
function pickAtEditor(evt){
  const rect=els.editCanvas.getBoundingClientRect();
  const x=Math.floor((evt.clientX-rect.left)*els.editCanvas.width/rect.width);
  const y=Math.floor((evt.clientY-rect.top )*els.editCanvas.height/rect.height);
  const d=editor.ectx.getImageData(x,y,1,1).data;
  return rgbToHex(d[0],d[1],d[2]);
}
function showEye(hex){ if(els.eyeSwatch) els.eyeSwatch.style.background=hex; if(els.eyeHex) els.eyeHex.textContent=hex; }
function eyedropStart(evt){ evt.preventDefault(); clearTimeout(editor.eyedropTimer); editor.eyedropTimer=setTimeout(()=>{ editor.currentHex=pickAtEditor(evt); showEye(editor.currentHex);},250); }
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
els.eyeAdd?.addEventListener('click', ()=>{ const hex=editor.currentHex||'#000000'; addPaletteRow(hex); renderEditorPalette(); onPaletteChanged(); });
els.eyeCancel?.addEventListener('click', ()=>{ editor.octx?.clearRect(0,0,els.editOverlay.width,els.editOverlay.height); });

/* ---------------- Events wiring ---------------- */
function updateWeightsUI(){
  if(els.wChromaOut) els.wChromaOut.textContent=(Number(els.wChroma?.value||'100')/100).toFixed(2)+'×';
  if(els.wLightOut)  els.wLightOut.textContent =(Number(els.wLight?.value||'100')/100).toFixed(2)+'×';
}
function bindEvents(){
  // file inputs
  els.fileInput?.addEventListener('change',e=>handleFile(e.target.files?.[0]));
  els.cameraInput?.addEventListener('change',e=>handleFile(e.target.files?.[0]));
  els.pasteBtn?.addEventListener('click',async()=>{
    if(!navigator.clipboard?.read){ alert('Clipboard paste not supported.'); return; }
    const items=await navigator.clipboard.read();
    for(const it of items){ for(const t of it.types){ if(t.startsWith('image/')){ const b=await it.getType(t); await handleFile(b); return; } } }
    alert('No image in clipboard.');
  });
  els.resetBtn?.addEventListener('click',()=>{ if(!state.fullBitmap) return; drawPreviewFromState(); });

  // palette buttons
  els.addColor?.addEventListener('click',()=>{ addPaletteRow('#FFFFFF'); });
  els.clearColors?.addEventListener('click',()=>{ els.paletteList.innerHTML=''; onPaletteChanged(); });
  els.loadExample?.addEventListener('click',()=>{ setPalette(['#FFFFFF','#000000','#674938','#C7BBBF','#817067']); });
  els.savePalette?.addEventListener('click',()=>{
    const name=prompt('Save palette name?') || `Palette ${Date.now()}`;
    const colors=getPalette().map(([r,g,b])=>rgbToHex(r,g,b));
    const list=loadSavedPalettes(); list.unshift({name,colors}); saveSavedPalettes(list.slice(0,50)); renderSavedPalettes(); toast('Saved palette.');
  });
  els.clearSavedPalettes?.addEventListener('click',()=>{ if(confirm('Clear saved palettes?')){ saveSavedPalettes([]); renderSavedPalettes(); } });
  els.autoExtract?.addEventListener('click',()=>{
    if(!els.srcCanvas.width) return alert('Load an image first.');
    const k=clamp(parseInt(els.kColors.value||'6',10),2,16);
    const img=sctx.getImageData(0,0,els.srcCanvas.width,els.srcCanvas.height);
    const centers=kmeans(img.data,k,10); setPalette(centers.map(([r,g,b])=>rgbToHex(r,g,b)));
  });

  // mapping
  ['input','change'].forEach(ev=>{
    els.wChroma?.addEventListener(ev, updateWeightsUI);
    els.wLight?.addEventListener(ev, updateWeightsUI);
  });
  els.applyBtn?.addEventListener('click', ()=> runApply());
  els.refreshMapped?.addEventListener('click', ()=> runApply());
  els.downloadBtn?.addEventListener('click', downloadPng);

  // vector
  els.downloadSvg?.addEventListener('click', downloadSVG);

  // texture
  els.texAddRule?.addEventListener('click', addTextureRuleFromUI);
  els.texClear?.addEventListener('click', ()=>{ state.textureRules=[]; renderRulesUI(); runApply(true); });

  // suggestions
  els.suggestBtn?.addEventListener('click', ()=>{
    const add=[], useGray=els.suggestGray?!!els.suggestGray.checked:true, useHue=els.suggestHue?!!els.suggestHue.checked:true;
    if(useGray) add.push(...suggestGrayRules());
    if(useHue)  add.push(...suggestHueRules());
    if(!add.length){ toast('No suggestions found (need mapped image).'); return; }
    // Merge (avoid duplicates on same targets)
    const key=r=>`${r.target}|${r.mixA}|${r.mixB}|${r.mode}`;
    const seen=new Set(state.textureRules.map(key));
    add.forEach(r=>{ const k=key(r); if(!seen.has(k)){ state.textureRules.push(r); seen.add(k); } });
    renderRulesUI(); runApply(true); toast(`Added ${add.length} suggested rule(s). Adjust densities above.`);
  });

  // smart mix
  els.smartBtn?.addEventListener('click', ()=>{
    const hex = (els.smartTargetHex?.value || '').trim();
    const t = hexToRgb(hex); if(!t){ alert('Enter target HEX like #5A7F2E'); return; }
    const pal=getPalette(); const allow=[];
    pal.forEach((_,i)=> allow.push(i));
    // optionally include/exclude W/K: we assume white≈maxY and black≈minY; the checkboxes simply keep them in the allowed set
    if(els.smartAllowWhite && !els.smartAllowWhite.checked){
      let maxI=0, maxY=-1; pal.forEach((rgb,i)=>{ const Y=luminance(...rgb); if(Y>maxY){maxY=Y;maxI=i;} }); const ix=allow.indexOf(maxI); if(ix>=0) allow.splice(ix,1);
    }
    if(els.smartAllowBlack && !els.smartAllowBlack.checked){
      let minI=0, minY= 99; pal.forEach((rgb,i)=>{ const Y=luminance(...rgb); if(Y<minY){minY=Y;minI=i;} }); const ix=allow.indexOf(minI); if(ix>=0) allow.splice(ix,1);
    }
    const step = clamp(Number(els.smartStep?.value||'5')/100, 0.01, 0.25);
    const best = bestSmartMix(hex, allow, step, !!(els.smartUseTriples && els.smartUseTriples.checked));
    if(!best) return alert('No mix found.');
    state.textureRules.push(best.rule);
    renderRulesUI(); runApply(true);
    toast('Smart mix added: '+best.label);
  });

  // codes
  els.colorCodeMode?.addEventListener('change', ()=>{ state.codeMode = els.colorCodeMode.value==='hex'?'hex':'pms'; renderCodeList(); updateMailto(); });
  els.exportReport?.addEventListener('click', ()=>{
    const txt=buildPrinterReport();
    const blob=new Blob([txt],{type:'text/plain'}); const a=document.createElement('a'); a.download='palette_report.txt'; a.href=URL.createObjectURL(blob); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  });

  // editor
  els.openEditor?.addEventListener('click', openEditor);
  els.editorDone?.addEventListener('click', closeEditor);

  // quick alt-click on preview to add color
  els.srcCanvas?.addEventListener('click',(e)=>{
    if(!e.altKey) return;
    const rect=els.srcCanvas.getBoundingClientRect();
    const x=Math.floor((e.clientX-rect.left)*els.srcCanvas.width/rect.width);
    const y=Math.floor((e.clientY-rect.top )*els.srcCanvas.height/rect.height);
    const d=sctx.getImageData(x,y,1,1).data; addPaletteRow(rgbToHex(d[0],d[1],d[2])); onPaletteChanged();
  });
}

/* ---------------- Init ---------------- */
async function init(){
  try{
    updateWeightsUI();
    renderSavedPalettes();
    await loadPmsJson();
    renderCodeList(); updateMailto();
    renderTextureSelectors();
    enableVectorButtonIfReady();

    toast('Tip: Start by tapping “Choose File”, then “Apply mapping”. Use “Suggest replacements” to auto-build mixes.');
  }catch(e){ console.error(e); }
}
bindEvents();
window.addEventListener('load', init);
