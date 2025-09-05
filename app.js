/* Palette Mapper — COMPREHENSIVE BUILD (2025-09-05)
   Restores & unifies:
   - Robust attach (upload/camera/paste) + EXIF orientation
   - Preview + hybrid auto palette
   - Full Palette UI + Saved/Example helpers
   - Restricted Palette (final inks) + "Suggest by Hue & Luma" (2–3 inks + density)
   - Manual "Add replacement" rules (per-rule pattern, density slider, enable toggle)
   - Mapping (Lab) + optional Floyd–Steinberg + bg mode + sharpen edges
   - Full-screen editor (eyedropper + lasso) — FIXED: reliable rendering on iOS/Safari
   - PNG export (full-res); SVG export if vectorizer available
   - Big "Refresh output" button above preview
   - Light toasts for guidance

   Required HTML IDs (existing in your project; add if missing):
   fileInput, cameraInput, pasteBtn, resetBtn, maxW, keepFullRes, sharpenEdges,
   srcCanvas, outCanvas,
   paletteList, addColor, clearColors, loadExample,
   restrictedList, makeRestrictedFromPalette, clearRestricted,
   wChroma, wLight, useDither, bgMode, applyBtn, downloadBtn,
   suggestByHueLuma, addRuleBtn, rulesTable, refreshOutput,
   openEditor, editorOverlay, toolEyedrop, toolLasso, toolPan, editorDone,
   editCanvas, editOverlay, editorPalette, lassoChecks, lassoSave, lassoClear,
   eyeSwatch, eyeHex, eyeAdd, eyeCancel,
   downloadSvgBtn  (optional — shows if vectorizer present)
*/

//////////////////////////// DOM ////////////////////////////
const $ = (id)=> document.getElementById(id);
const els = {
  // image i/o
  fileInput: $('fileInput'),
  cameraInput: $('cameraInput'),
  pasteBtn: $('pasteBtn'),
  resetBtn: $('resetBtn'),
  maxW: $('maxW'),
  keepFullRes: $('keepFullRes'),
  sharpenEdges: $('sharpenEdges'),

  // canvases
  srcCanvas: $('srcCanvas'),
  outCanvas: $('outCanvas'),

  // palette (full)
  paletteList: $('paletteList'),
  addColor: $('addColor'),
  clearColors: $('clearColors'),
  loadExample: $('loadExample'),

  // restricted inks
  restrictedList: $('restrictedList'),
  makeRestrictedFromPalette: $('makeRestrictedFromPalette'),
  clearRestricted: $('clearRestricted'),

  // mapping
  wChroma: $('wChroma'),
  wLight: $('wLight'),
  useDither: $('useDither'),
  bgMode: $('bgMode'),
  applyBtn: $('applyBtn'),
  downloadBtn: $('downloadBtn'),
  downloadSvgBtn: $('downloadSvgBtn'),

  // rules (replacement)
  suggestByHueLuma: $('suggestByHueLuma'),
  addRuleBtn: $('addRuleBtn'),
  rulesTable: $('rulesTable'),
  refreshOutput: $('refreshOutput'),

  // full-screen editor
  openEditor: $('openEditor'),
  editorOverlay: $('editorOverlay'),
  toolEyedrop: $('toolEyedrop'),
  toolLasso: $('toolLasso'),
  toolPan: $('toolPan'),
  editorDone: $('editorDone'),
  editCanvas: $('editCanvas'),
  editOverlay: $('editOverlay'),
  editorPalette: $('editorPalette'),
  lassoChecks: $('lassoChecks'),
  lassoSave: $('lassoSave'),
  lassoClear: $('lassoClear'),
  eyeSwatch: $('eyeSwatch'),
  eyeHex: $('eyeHex'),
  eyeAdd: $('eyeAdd'),
  eyeCancel: $('eyeCancel'),
};

const sctx = els.srcCanvas?.getContext('2d', {willReadFrequently:true});
const octx = els.outCanvas?.getContext('2d', {willReadFrequently:true});
if (sctx) sctx.imageSmoothingEnabled = false;
if (octx) octx.imageSmoothingEnabled = false;

//////////////////////////// State ////////////////////////////
const state = {
  fullBitmap: null, fullW: 0, fullH: 0, exif: 1,
  rules: /** @type {Array<Rule>} */([]),
  _labCache: new Map(),
  editor: {
    active:false, tool:'eyedrop',
    ectx:null, octx:null, lassoPts:[], lassoActive:false,
    eyedropTimer:null, currentHex:'#000000',
  }
};
/** @typedef {{ id:string, enabled:boolean, targetHex:string, inks:string[], pattern:'checker'|'ordered'|'dots'|'stripes', density:number }} Rule */

//////////////////////////// Helpers ////////////////////////////
const clamp=(v,min,max)=>v<min?min:v>max?max:v;
const uid = ()=> Math.random().toString(36).slice(2,9);
const hex = (r,g,b)=> '#'+[r,g,b].map(v=>clamp(v,0,255).toString(16).padStart(2,'0')).join('').toUpperCase();
const hexToRgb = (h)=>{ h=(h||'').trim().toUpperCase(); if(!/^#([0-9A-F]{6})$/.test(h)) return null; const n=parseInt(h.slice(1),16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; };

function srgbToLinear(u){ u/=255; return (u<=0.04045)? u/12.92 : Math.pow((u+0.055)/1.055,2.4); }
function rgbToXyz(r,g,b){ r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b);
  return [ r*0.4124564 + g*0.3575761 + b*0.1804375,
           r*0.2126729 + g*0.7151522 + b*0.0721750,
           r*0.0193339 + g*0.1191920 + b*0.9503041 ];
}
function xyzToLab(x,y,z){ const Xn=0.95047,Yn=1,Zn=1.08883; x/=Xn; y/=Yn; z/=Zn;
  const f=t=> (t>0.008856)? Math.cbrt(t) : (7.787*t+16/116);
  const fx=f(x), fy=f(y), fz=f(z); return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
function rgbToLabFast(r,g,b){
  const key=(r<<16)|(g<<8)|b; const hit=state._labCache.get(key);
  if(hit) return hit;
  const lab = xyzToLab(...rgbToXyz(r,g,b));
  state._labCache.set(key, lab);
  return lab;
}
const deltaE2 = (L1,L2,wL=1,wC=1)=>{ const dL=L1[0]-L2[0], da=L1[1]-L2[1], db=L1[2]-L2[2]; return wL*dL*dL + wC*(da*da+db*db); };

function toast(msg, ms=1700){
  let host = document.getElementById('toasts');
  if(!host){ host=document.createElement('div'); host.id='toasts';
    host.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:grid;gap:8px;z-index:999999';
    document.body.appendChild(host);
  }
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='background:#0b1225cc;border:1px solid #1e293b;color:#dbeafe;padding:8px 10px;border-radius:10px;backdrop-filter:blur(8px)';
  host.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .25s'; setTimeout(()=>t.remove(),260); }, ms);
}

//////////////////////////// EXIF (JPEG) ////////////////////////////
async function readJpegOrientation(file){
  return new Promise((resolve)=>{
    const r=new FileReader();
    r.onload=()=>{
      try{
        const v=new DataView(r.result);
        if(v.getUint16(0,false)!==0xFFD8) return resolve(1);
        let off=2,len=v.byteLength;
        while(off<len){
          const marker=v.getUint16(off,false); off+=2;
          if(marker===0xFFE1){
            const size=v.getUint16(off,false); off+=2;
            if(v.getUint32(off,false)!==0x45786966) break;
            off+=6;
            const little = v.getUint16(off,false)===0x4949;
            const get16=(o)=>v.getUint16(o,little);
            const get32=(o)=>v.getUint32(o,little);
            const ifd0=get32(off+4);
            const dir = off+ifd0;
            const entries=get16(dir);
            for(let i=0;i<entries;i++){
              const e=dir+2+i*12;
              if(get16(e)===0x0112){ return resolve(get16(e+8)||1); }
            }
            break;
          } else if((marker & 0xFF00)!==0xFF00) break;
          else off += v.getUint16(off,false);
        }
      }catch{}
      resolve(1);
    };
    r.onerror=()=>resolve(1);
    r.readAsArrayBuffer(file.slice(0,256*1024));
  });
}
function drawImageOriented(ctx, img, w, h, orient=1){
  ctx.save();
  switch(orient){
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

//////////////////////////// Image Load ////////////////////////////
function isLikelyJpeg(file){ const t=(file.type||'').toLowerCase(); const ext=(file.name||'').split('.').pop().toLowerCase(); return t.includes('jpeg')||t.includes('jpg')||ext==='jpg'||ext==='jpeg'; }
function objectUrlFor(file){ return URL.createObjectURL(file); }
function revokeUrl(url){ try{ URL.revokeObjectURL(url);}catch{} }
function loadImg(url){ return new Promise((res,rej)=>{ const img=new Image(); img.decoding='async'; img.onload=()=>res(img); img.onerror=rej; img.src=url; }); }

async function handleFile(file){
  if(!file) return;
  state.exif=1;
  if(typeof createImageBitmap==='function'){
    try{
      const bmp=await createImageBitmap(file, {imageOrientation:'from-image'});
      state.fullBitmap=bmp; state.fullW=bmp.width; state.fullH=bmp.height; state.exif=1;
      drawPreview();
      toast('Image loaded');
      return;
    }catch{}
  }
  const url=objectUrlFor(file);
  try{
    const img=await loadImg(url);
    state.fullBitmap=img; state.fullW=img.naturalWidth||img.width; state.fullH=img.naturalHeight||img.height;
    state.exif = isLikelyJpeg(file) ? await readJpegOrientation(file) : 1;
    drawPreview();
    toast('Image loaded');
  }finally{ revokeUrl(url); }
}

//////////////////////////// Palettes ////////////////////////////
function addPaletteRow(container, hexStr='#FFFFFF'){
  const row=document.createElement('div'); row.className='palette-item';
  row.innerHTML=`
    <input type="color" value="${hexStr}" />
    <input class="hex" type="text" value="${hexStr.toUpperCase()}" placeholder="#RRGGBB" />
    <button class="ghost rm" type="button">Remove</button>
  `;
  const color=row.querySelector('input[type=color]');
  const text =row.querySelector('input.hex');
  const rm   =row.querySelector('.rm');
  color.addEventListener('input',()=>{ text.value=color.value.toUpperCase(); queueAuto(); });
  text.addEventListener('change',()=>{
    let v=text.value.trim().toUpperCase(); if(!v.startsWith('#')) v='#'+v;
    if(/^#([0-9A-F]{6})$/.test(v)){ color.value=v; text.value=v; queueAuto(); } else toast('Enter 6-digit hex');
  });
  rm.addEventListener('click',()=>{ row.remove(); queueAuto(); });
  container.appendChild(row);
}
function getPaletteFrom(container){
  const rows=[...container.querySelectorAll('.palette-item')];
  const out=[]; rows.forEach(r=>{ const v=r.querySelector('.hex').value.trim().toUpperCase(); if(/^#([0-9A-F]{6})$/.test(v)) out.push(v); });
  return out;
}
const getFullPalette = ()=> getPaletteFrom(els.paletteList||document.createElement('div'));
function getRestrictedPalette(){ 
  const p = getPaletteFrom(els.restrictedList||document.createElement('div'));
  const seen=new Set(); const uniq=[]; p.forEach(h=>{ if(!seen.has(h)){ seen.add(h); uniq.push(h); }});
  return uniq;
}

//////////////////////////// Auto Palette ////////////////////////////
function autoPaletteHybrid(canvas, k=10){
  if(!canvas || !canvas.width) return [];
  const cx=canvas.getContext('2d', {willReadFrequently:true});
  const w=canvas.width, h=canvas.height;
  const data=cx.getImageData(0,0,w,h).data;
  const target=120000, step=Math.max(1, Math.floor(Math.sqrt((w*h)/target)));
  const samples=[];
  for(let y=0;y<h;y+=step){ for(let x=0;x<w;x+=step){ const i=(y*w+x)*4; if(data[i+3]>10) samples.push([data[i],data[i+1],data[i+2]]); } }
  const map=new Map();
  for(const [r,g,b] of samples){ const key=((r>>3)<<10)|((g>>3)<<5)|(b>>3); map.set(key,(map.get(key)||0)+1); }
  const seeds=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,Math.max(k*3,k)).map(([key])=>[ ((key>>10)&31)<<3, ((key>>5)&31)<<3, (key&31)<<3 ]);
  let centers = seeds.slice(0,k).map(c=>c.slice());
  for(let it=0;it<6;it++){
    const sum=centers.map(()=>[0,0,0,0]);
    for(const [r,g,b] of samples){
      let best=0,bD=Infinity;
      for(let c=0;c<centers.length;c++){ const rr=r-centers[c][0], gg=g-centers[c][1], bb=b-centers[c][2]; const d=rr*rr+gg*gg+bb*bb; if(d<bD){ bD=d; best=c; } }
      sum[best][0]+=r; sum[best][1]+=g; sum[best][2]+=b; sum[best][3]++;
    }
    for(let c=0;c<centers.length;c++){ if(sum[c][3]){ centers[c][0]=Math.round(sum[c][0]/sum[c][3]); centers[c][1]=Math.round(sum[c][1]/sum[c][3]); centers[c][2]=Math.round(sum[c][2]/sum[c][3]); } }
  }
  return centers.map(c=>hex(c[0],c[1],c[2]));
}

//////////////////////////// Preview ////////////////////////////
function drawPreview(){
  if(!state.fullBitmap || !sctx) return;
  let w=state.fullW, h=state.fullH;
  if([5,6,7,8].includes(state.exif)){ const t=w; w=h; h=t; }
  const maxW=parseInt(els.maxW?.value||'1400',10);
  const scale = w>maxW ? (maxW/w) : 1;
  const pw=Math.round(w*scale), ph=Math.round(h*scale);
  els.srcCanvas.width=pw; els.srcCanvas.height=ph;
  sctx.clearRect(0,0,pw,ph);
  drawImageOriented(sctx, state.fullBitmap, pw, ph, state.exif);

  // seed palettes on first load
  const auto = autoPaletteHybrid(els.srcCanvas, 10);
  if (auto.length && els.paletteList && els.paletteList.children.length===0){
    setPaletteInto(els.paletteList, auto);
  }
  if (els.restrictedList && els.restrictedList.children.length===0){
    setPaletteInto(els.restrictedList, ['#FFFFFF', ...auto.slice(0,3)]);
  }

  enableMappingButtons();
}
function setPaletteInto(container, hexes){ container.innerHTML=''; hexes.forEach(h=> addPaletteRow(container, h)); }
function enableMappingButtons(){
  if(els.applyBtn) els.applyBtn.disabled=false;
  if(els.downloadBtn) els.downloadBtn.disabled=false;
  if(els.suggestByHueLuma) els.suggestByHueLuma.disabled=false;
  if(els.addRuleBtn) els.addRuleBtn.disabled=false;
  if(els.refreshOutput) els.refreshOutput.disabled=false;
}

//////////////////////////// Rules (Replacement) ////////////////////////////
function formatInks(inks){ return inks?.length ? inks.join(' + ') : '—'; }
function renderRulesTable(){
  const host=els.rulesTable; if(!host) return;
  host.innerHTML='';
  const header=`
    <div class="r-head">
      <div>On/Off</div><div>Target color</div><div>Inks</div>
      <div>Pattern</div><div>Density</div><div>Edit inks</div><div>Delete</div>
    </div>`;
  const wrap=document.createElement('div'); wrap.className='rules-wrap'; wrap.innerHTML=header;
  host.appendChild(wrap);

  if(!state.rules.length){
    const empty=document.createElement('div'); empty.className='help'; empty.textContent='No rules. Use “Suggest by Hue & Luma” or “Add replacement”.';
    host.appendChild(empty); return;
  }

  state.rules.forEach(rule=>{
    const row=document.createElement('div'); row.className='r-row'; row.dataset.id=rule.id;
    // on/off
    const on=document.createElement('label'); on.className='switch';
    on.innerHTML=`<input type="checkbox" ${rule.enabled?'checked':''}/><span>Enable</span>`;
    on.querySelector('input').addEventListener('change', e=>{ rule.enabled=e.target.checked; queueAuto(); });

    // target
    const tgt=document.createElement('div'); tgt.className='tgt';
    tgt.innerHTML=`<span class="sw" style="background:${rule.targetHex}"></span><input class="hex" type="text" value="${rule.targetHex}"/>`;
    tgt.querySelector('.hex').addEventListener('change', e=>{
      let v=e.target.value.trim().toUpperCase(); if(!v.startsWith('#')) v='#'+v;
      if(/^#([0-9A-F]{6})$/.test(v)){ rule.targetHex=v; tgt.querySelector('.sw').style.background=v; queueAuto(); } else toast('Invalid hex');
    });

    // inks
    const inksDiv=document.createElement('div'); inksDiv.className='inks'; inksDiv.textContent=formatInks(rule.inks);

    // pattern
    const patt=document.createElement('div'); patt.className='patt';
    patt.innerHTML=`<select>
      <option value="checker">Checker</option>
      <option value="ordered">Ordered</option>
      <option value="dots">Dots</option>
      <option value="stripes">Stripes</option>
    </select>`;
    patt.querySelector('select').value=rule.pattern;
    patt.querySelector('select').addEventListener('change',e=>{ rule.pattern=e.target.value; queueAuto(); });

    // density
    const dens=document.createElement('div'); dens.className='dens';
    dens.innerHTML=`<input type="range" min="0" max="100" value="${Math.round(rule.density*100)}"/><span class="pct">${Math.round(rule.density*100)}%</span>`;
    const rng=dens.querySelector('input'), pct=dens.querySelector('.pct');
    rng.addEventListener('input',()=>{ pct.textContent=rng.value+'%'; });
    rng.addEventListener('change',()=>{ rule.density=clamp(parseInt(rng.value,10)/100,0,1); queueAuto(); });

    // edit inks
    const edit=document.createElement('div'); const btn=document.createElement('button'); btn.className='ghost'; btn.textContent='Edit inks';
    btn.addEventListener('click', ()=> editInksDialog(rule, inksDiv));
    edit.appendChild(btn);

    // delete
    const del=document.createElement('div'); const b2=document.createElement('button'); b2.className='danger'; b2.textContent='Delete';
    b2.addEventListener('click',()=>{ state.rules=state.rules.filter(r=>r.id!==rule.id); renderRulesTable(); queueAuto(); });
    del.appendChild(b2);

    const grid=document.createElement('div'); grid.className='r-grid';
    [on,tgt,inksDiv,patt,dens,edit,del].forEach(x=>grid.appendChild(x));
    wrap.appendChild(grid);
  });
}
function editInksDialog(rule, inksCell){
  const allowed=getRestrictedPalette(); if(!allowed.length){ toast('Add inks to Restricted Palette first.'); return; }
  const current=new Set(rule.inks);
  const box=document.createElement('div');
  box.style.cssText='position:fixed;inset:0;background:rgba(3,6,20,.6);display:grid;place-items:center;z-index:99999';
  const pane=document.createElement('div');
  pane.style.cssText='background:#0b1225;border:1px solid #1e293b;border-radius:12px;padding:12px;max-width:520px;width:92vw';
  pane.innerHTML='<h3 style="margin:0 0 8px">Choose inks (pick 2–3)</h3>';
  const grid=document.createElement('div'); grid.style.display='grid'; grid.style.gridTemplateColumns='repeat(3,1fr)'; grid.style.gap='8px';
  allowed.forEach(h=>{
    const lab=document.createElement('label'); lab.style.display='flex'; lab.style.alignItems='center'; lab.style.gap='6px';
    lab.innerHTML=`<input type="checkbox" ${current.has(h)?'checked':''}/><span class="sw" style="width:18px;height:18px;border:1px solid #334155;border-radius:4px;background:${h}"></span><span>${h}</span>`;
    grid.appendChild(lab);
  });
  const actions=document.createElement('div'); actions.style.cssText='display:flex;justify-content:flex-end;gap:8px;margin-top:10px';
  const ok=document.createElement('button'); ok.textContent='Apply';
  const cancel=document.createElement('button'); cancel.className='ghost'; cancel.textContent='Cancel';
  actions.append(ok,cancel);
  pane.append(grid,actions); box.appendChild(pane); document.body.appendChild(box);
  cancel.onclick=()=>box.remove();
  ok.onclick=()=>{
    const picked=[...grid.querySelectorAll('input[type=checkbox]')].map((cb,i)=>cb.checked?allowed[i]:null).filter(Boolean);
    if(picked.length<2){ toast('Pick at least two inks'); return; }
    rule.inks=picked.slice(0,3);
    inksCell.textContent=formatInks(rule.inks);
    box.remove();
    queueAuto();
  };
}

function mergeRulesSmart(existing, incoming){
  const byTarget=new Map(existing.map(r=>[r.targetHex.toUpperCase(), r]));
  incoming.forEach(r=>{
    const key=r.targetHex.toUpperCase();
    if(!byTarget.has(key)) byTarget.set(key,r);
    else{
      const cur=byTarget.get(key);
      if(cur.inks.join(',')!==r.inks.join(',') || Math.abs(cur.density-r.density)>0.05) byTarget.set(key,r);
    }
  });
  return [...byTarget.values()];
}

function suggestByHueAndLuma(){
  const full=getFullPalette(); const rest=getRestrictedPalette();
  if(!full.length || !els.srcCanvas?.width){ toast('Load an image and palette first.'); return; }
  if(rest.length<2){ toast('Add at least two inks to Restricted Palette'); return; }
  const restSet=new Set(rest);
  const candidates=full.filter(h=>!restSet.has(h));
  const rules=[];
  candidates.forEach(h=>{
    const rgb=hexToRgb(h), labT=rgbToLabFast(rgb.r,rgb.g,rgb.b);
    let best=null, err=Infinity, dens=0.5;
    // 2-ink search
    for(let i=0;i<rest.length;i++){
      for(let j=i+1;j<rest.length;j++){
        const A=hexToRgb(rest[i]), B=hexToRgb(rest[j]);
        for(let t=0;t<=10;t++){
          const p=t/10;
          const r=Math.round(A.r*p + B.r*(1-p));
          const g=Math.round(A.g*p + B.g*(1-p));
          const b=Math.round(A.b*p + B.b*(1-p));
          const d=deltaE2(labT, rgbToLabFast(r,g,b),1,1);
          if(d<err){ err=d; best=[rest[i],rest[j]]; dens=p; }
        }
      }
    }
    // prefer white mixtures for tints
    const w = rest.find(c=>c.toUpperCase()==='#FFFFFF');
    if(w){
      for(let i=0;i<rest.length;i++){
        if(rest[i]===w) continue;
        const A=hexToRgb(rest[i]), W=hexToRgb(w);
        for(let t=0;t<=10;t++){
          const p=t/10;
          const r=Math.round(A.r*p + W.r*(1-p));
          const g=Math.round(A.g*p + W.g*(1-p));
          const b=Math.round(A.b*p + W.b*(1-p));
          const d=deltaE2(labT, rgbToLabFast(r,g,b),1,1);
          if(d<err){ err=d; best=[rest[i],w]; dens=p; }
        }
      }
    }
    if(best){
      rules.push({ id:uid(), enabled:true, targetHex:h, inks:best, pattern:'checker', density:clamp(dens,0,1) });
    }
  });
  state.rules = mergeRulesSmart(state.rules, rules);
  renderRulesTable();
  toast(`Suggested ${rules.length} replacement${rules.length===1?'':'s'}.`);
  queueAuto();
}
function addManualRule(){
  const rest=getRestrictedPalette(); if(rest.length<2){ toast('Add ≥2 inks to Restricted Palette first.'); return; }
  const full=getFullPalette(); const tgt=full.find(h=>!rest.includes(h)) || full[0] || '#808080';
  state.rules.push({ id:uid(), enabled:true, targetHex:tgt, inks:rest.slice(0,2), pattern:'checker', density:0.5 });
  renderRulesTable(); queueAuto();
}

//////////////////////////// Mapping ////////////////////////////
const bayer8=[
 [0,48,12,60,3,51,15,63],[32,16,44,28,35,19,47,31],[8,56,4,52,11,59,7,55],[40,24,36,20,43,27,39,23],
 [2,50,14,62,1,49,13,61],[34,18,46,30,33,17,45,29],[10,58,6,54,9,57,5,53],[42,26,38,22,41,25,37,21],
];
function getWeights(){ 
  const wC=clamp(parseInt(els.wChroma?.value||'100',10)/100,0.2,2.0);
  const wL=clamp(parseInt(els.wLight?.value||'100',10)/100,0.2,2.0);
  return {wC,wL};
}
function unsharpInPlace(img, amount=0.35){
  const w=img.width, h=img.height, src=img.data;
  const copy=new Uint8ClampedArray(src);
  const k=[0,-1,0,-1,5,-1,0,-1,0];
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      let r=0,g=0,b=0,ki=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++,ki++){
          const i=((y+dy)*w+(x+dx))*4, kv=k[ki];
          r+=copy[i]*kv; g+=copy[i+1]*kv; b+=copy[i+2]*kv;
        }
      }
      const o=(y*w+x)*4;
      src[o  ]=clamp((1-amount)*copy[o  ]+amount*r,0,255);
      src[o+1]=clamp((1-amount)*copy[o+1]+amount*g,0,255);
      src[o+2]=clamp((1-amount)*copy[o+2]+amount*b,0,255);
    }
  }
}
function applyMapping(){
  if(!els.srcCanvas?.width||!els.outCanvas) return;
  const pal=getFullPalette(); if(!pal.length){ toast('Add colors to Palette.'); return; }
  const palLab=pal.map(h=>{ const c=hexToRgb(h); return {hex:h, rgb:c, lab:rgbToLabFast(c.r,c.g,c.b)}; });
  const {wC,wL}=getWeights(); const dither=!!els.useDither?.checked;

  // choose processing canvas
  let pCanvas, pctx, pW, pH;
  if(els.keepFullRes?.checked && state.fullBitmap){
    let w=state.fullW,h=state.fullH; if([5,6,7,8].includes(state.exif)){ const t=w; w=h; h=t; }
    pCanvas=document.createElement('canvas'); pCanvas.width=w; pCanvas.height=h;
    pctx=pCanvas.getContext('2d',{willReadFrequently:true}); pctx.imageSmoothingEnabled=false;
    drawImageOriented(pctx, state.fullBitmap, w, h, state.exif);
  }else{ pCanvas=els.srcCanvas; pctx=sctx; }
  pW=pCanvas.width; pH=pCanvas.height;

  const src=pctx.getImageData(0,0,pW,pH); const out=pctx.createImageData(pW,pH); out.data.set(src.data);
  const errR=dither?new Float32Array(pW*pH):null, errG=dither?new Float32Array(pW*pH):null, errB=dither?new Float32Array(pW*pH):null;

  // Palette mapping
  for(let y=0;y<pH;y++){
    for(let x=0;x<pW;x++){
      const idx=y*pW+x,i4=idx*4; if(src.data[i4+3]<5){ out.data[i4+3]=0; continue; }
      let r=src.data[i4], g=src.data[i4+1], b=src.data[i4+2];
      if(dither){ r=clamp(Math.round(r+errR[idx]),0,255); g=clamp(Math.round(g+errG[idx]),0,255); b=clamp(Math.round(b+errB[idx]),0,255); }
      const lab=rgbToLabFast(r,g,b);
      let best=0,bd=Infinity;
      for(let p=0;p<palLab.length;p++){ const d=deltaE2(lab,palLab[p].lab,wL,wC); if(d<bd){ bd=d; best=p; } }
      const chosen=palLab[best];
      out.data[i4]=chosen.rgb.r; out.data[i4+1]=chosen.rgb.g; out.data[i4+2]=chosen.rgb.b; out.data[i4+3]=255;
      if(dither){
        const er=r-chosen.rgb.r, eg=g-chosen.rgb.g, eb=b-chosen.rgb.b;
        const push=(xx,yy,fr,fg,fb)=>{ if(xx<0||yy<0||xx>=pW||yy>=pH) return; const j=yy*pW+xx; errR[j]+=fr; errG[j]+=fg; errB[j]+=fb; };
        push(x+1,y,er*7/16,eg*7/16,eb*7/16);
        push(x-1,y+1,er*3/16,eg*3/16,eb*3/16);
        push(x,y+1,er*5/16,eg*5/16,eb*5/16);
        push(x+1,y+1,er*1/16,eg*1/16,eb*1/16);
      }
    }
  }

  // Apply replacement rules
  const active=state.rules.filter(r=>r.enabled && r.inks?.length>=2);
  if(active.length){
    const byHex=new Map(active.map(r=>[r.targetHex.toUpperCase(),r]));
    const inkRGB=new Map(); getRestrictedPalette().forEach(h=> inkRGB.set(h,hexToRgb(h)));
    for(let y=0;y<pH;y++){
      for(let x=0;x<pW;x++){
        const i4=(y*pW+x)*4; const cur=hex(out.data[i4],out.data[i4+1],out.data[i4+2]);
        const rule=byHex.get(cur.toUpperCase()); if(!rule) continue;
        const A=inkRGB.get(rule.inks[0])||hexToRgb(rule.inks[0]);
        const B=inkRGB.get(rule.inks[1])||hexToRgb(rule.inks[1]);
        const C=rule.inks[2]?(inkRGB.get(rule.inks[2])||hexToRgb(rule.inks[2])):null;
        let chooseA;
        switch(rule.pattern){
          case 'ordered': { const t=Math.floor(rule.density*63); chooseA=(bayer8[y&7][x&7] <= t); break; }
          case 'dots':    { const t=Math.floor(rule.density*63); chooseA=(bayer8[y&7][x&7] <= t); break; }
          case 'stripes': { const period=6, pos=x%period; chooseA=(pos < Math.round(rule.density*period)); break; }
          default: { const check=((x>>1)+(y>>1))&1; chooseA = check ? (rule.density>=0.5) : (rule.density<0.5); }
        }
        const ink = (!C) ? (chooseA?A:B) : (chooseA?A:(((x+y)&1)?B:C));
        out.data[i4]=ink.r; out.data[i4+1]=ink.g; out.data[i4+2]=ink.b; out.data[i4+3]=255;
      }
    }
  }

  if(els.sharpenEdges?.checked) unsharpInPlace(out, 0.35);

  // store full-res for export
  els.outCanvas._fullImageData = out;

  // scaled preview
  const previewW = Math.min(pW, parseInt(els.maxW?.value||'1400',10));
  const scale = previewW / pW;
  els.outCanvas.width=Math.round(pW*scale); els.outCanvas.height=Math.round(pH*scale);
  const tmp=document.createElement('canvas'); tmp.width=pW; tmp.height=pH;
  tmp.getContext('2d',{willReadFrequently:true}).putImageData(out,0,0);
  octx.imageSmoothingEnabled=false;
  octx.clearRect(0,0,els.outCanvas.width,els.outCanvas.height);
  octx.drawImage(tmp,0,0,els.outCanvas.width,els.outCanvas.height);
}

//////////////////////////// Editor (Full-Screen) ////////////////////////////
function dpr(){ return window.devicePixelRatio||1; }
function openEditor(){
  if(!els.editorOverlay) return;
  els.editorOverlay.classList.remove('hidden'); els.editorOverlay.setAttribute('aria-hidden','false');
  state.editor.active=true; state.editor.tool='eyedrop';
  setToolActive('toolEyedrop');

  // size canvases to CSS size × devicePixelRatio
  sizeEditorCanvases();
  drawEditorImage(); // draw image into edit canvas
  buildEditorPalette();
  buildLassoChecks();
  enableEyedrop();
  disableLasso();
}
function closeEditor(){
  if(!state.editor.active) return;
  disableEyedrop(); disableLasso();
  state.editor.active=false;
  els.editorOverlay.classList.add('hidden');
  els.editorOverlay.setAttribute('aria-hidden','true');
}
function sizeEditorCanvases(){
  const cvs=els.editCanvas, ov=els.editOverlay; if(!cvs||!ov) return;
  const cssW=cvs.clientWidth|| (window.innerWidth-320); // minus sidebar on desktop
  const cssH=cvs.clientHeight|| (window.innerHeight-44);
  const ratio=dpr();
  cvs.width=Math.max(1,Math.floor(cssW*ratio)); cvs.height=Math.max(1,Math.floor(cssH*ratio));
  ov.width=cvs.width; ov.height=cvs.height;
  state.editor.ectx=cvs.getContext('2d',{willReadFrequently:true});
  state.editor.octx=ov.getContext('2d',{willReadFrequently:true});
  state.editor.ectx.imageSmoothingEnabled=false; state.editor.octx.imageSmoothingEnabled=false;
}
function drawEditorImage(){
  const ectx=state.editor.ectx; if(!ectx) return;
  ectx.clearRect(0,0,els.editCanvas.width,els.editCanvas.height);
  // draw from fullBitmap at best quality
  if(state.fullBitmap){
    // fit image to editor canvas while preserving aspect
    let w=state.fullW,h=state.fullH; if([5,6,7,8].includes(state.exif)){ const t=w; w=h; h=t; }
    const cw=els.editCanvas.width, ch=els.editCanvas.height;
    const scale=Math.min(cw/w, ch/h);
    const dw=Math.round(w*scale), dh=Math.round(h*scale);
    const ox=Math.floor((cw-dw)/2), oy=Math.floor((ch-dh)/2);
    ectx.save(); ectx.translate(ox,oy);
    drawImageOriented(ectx, state.fullBitmap, dw, dh, state.exif);
    ectx.restore();
  }else if(els.srcCanvas?.width){
    ectx.drawImage(els.srcCanvas, 0,0, els.editCanvas.width, els.editCanvas.height);
  }
  // clear overlay
  state.editor.octx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height);
}
function setToolActive(id){ ['toolEyedrop','toolLasso','toolPan'].forEach(x=>{ const b=$(x); if(!b) return; x===id?b.classList.add('active'):b.classList.remove('active'); }); }

function buildEditorPalette(){
  if(!els.editorPalette) return;
  els.editorPalette.innerHTML='';
  getFullPalette().forEach(h=>{ const sw=document.createElement('span'); sw.className='sw'; sw.style.cssText='display:inline-block;width:20px;height:20px;border:1px solid #334155;border-radius:4px;margin-right:6px;background:'+h; els.editorPalette.appendChild(sw); });
}
function buildLassoChecks(){
  if(!els.lassoChecks) return;
  els.lassoChecks.innerHTML='';
  getFullPalette().forEach((h,idx)=>{ const label=document.createElement('label'); label.style.display='flex'; label.style.alignItems='center'; label.style.gap='6px';
    label.innerHTML=`<input type="checkbox" checked /><span class="sw" style="width:16px;height:16px;border:1px solid #334155;border-radius:4px;background:${h}"></span><span>${h}</span>`;
    els.lassoChecks.appendChild(label);
  });
}

function pickAtEditor(evt){
  const rect=els.editCanvas.getBoundingClientRect();
  const ratio=dpr();
  const x=Math.max(0, Math.min(els.editCanvas.width-1, Math.floor((evt.clientX-rect.left)*ratio)));
  const y=Math.max(0, Math.min(els.editCanvas.height-1, Math.floor((evt.clientY-rect.top )*ratio)));
  const d=state.editor.ectx.getImageData(x,y,1,1).data;
  return hex(d[0],d[1],d[2]);
}
function showEye(h){ if(els.eyeSwatch) els.eyeSwatch.style.background=h; if(els.eyeHex) els.eyeHex.textContent=h; }

function eyedropStart(evt){ evt.preventDefault(); clearTimeout(state.editor.eyedropTimer);
  state.editor.eyedropTimer=setTimeout(()=>{ state.editor.currentHex=pickAtEditor(evt); showEye(state.editor.currentHex);
    // draw ring
    const rect=els.editCanvas.getBoundingClientRect(); const ratio=dpr();
    const cx=(evt.clientX-rect.left)*ratio, cy=(evt.clientY-rect.top)*ratio;
    const octx=state.editor.octx; octx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height); octx.strokeStyle='#93c5fd'; octx.lineWidth=2; octx.beginPath(); octx.arc(cx,cy,14*ratio,0,Math.PI*2); octx.stroke();
  },220);
}
function eyedropMove(evt){ if(state.editor.eyedropTimer===null) return; evt.preventDefault(); state.editor.currentHex=pickAtEditor(evt); showEye(state.editor.currentHex); }
function eyedropEnd(evt){ evt.preventDefault(); clearTimeout(state.editor.eyedropTimer); state.editor.eyedropTimer=null; }
function enableEyedrop(){
  els.editCanvas.addEventListener('pointerdown', eyedropStart, {passive:false});
  els.editCanvas.addEventListener('pointermove', eyedropMove, {passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.addEventListener(ev, eyedropEnd, {passive:false}));
}
function disableEyedrop(){
  els.editCanvas.removeEventListener('pointerdown', eyedropStart);
  els.editCanvas.removeEventListener('pointermove', eyedropMove);
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.removeEventListener(ev, eyedropEnd));
}
els.eyeAdd?.addEventListener('click', ()=>{
  const h=state.editor.currentHex||'#000000';
  addPaletteRow(els.paletteList, h);
  buildEditorPalette(); buildLassoChecks(); queueAuto();
});
els.eyeCancel?.addEventListener('click', ()=>{ state.editor.octx?.clearRect(0,0,els.editOverlay.width,els.editOverlay.height); });

function enableLasso(){
  els.lassoSave.disabled=true; els.lassoClear.disabled=false;
  els.editCanvas.addEventListener('pointerdown', lassoBegin, {passive:false});
  els.editCanvas.addEventListener('pointermove', lassoMove, {passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.addEventListener(ev, lassoEnd, {passive:false}));
}
function disableLasso(){
  els.editCanvas.removeEventListener('pointerdown', lassoBegin);
  els.editCanvas.removeEventListener('pointermove', lassoMove);
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>els.editCanvas.removeEventListener(ev, lassoEnd));
}
function lassoBegin(evt){ evt.preventDefault(); state.editor.lassoPts=[]; state.editor.lassoActive=true; addLassoPoint(evt); drawLassoStroke(false); }
function addLassoPoint(evt){
  const rect=els.editCanvas.getBoundingClientRect(); const ratio=dpr();
  const x=Math.max(0,Math.min(els.editCanvas.width,  Math.round((evt.clientX-rect.left)*ratio)));
  const y=Math.max(0,Math.min(els.editCanvas.height, Math.round((evt.clientY-rect.top )*ratio)));
  state.editor.lassoPts.push([x,y]);
}
function lassoMove(evt){ if(!state.editor.lassoActive) return; evt.preventDefault(); addLassoPoint(evt); drawLassoStroke(false); }
function lassoEnd(evt){ if(!state.editor.lassoActive) return; evt.preventDefault(); state.editor.lassoActive=false; drawLassoStroke(true); els.lassoSave.disabled=false; }
function drawLassoStroke(close=false){
  const ctx=state.editor.octx; if(!ctx) return; ctx.clearRect(0,0,els.editOverlay.width,els.editOverlay.height);
  if(state.editor.lassoPts.length<2) return;
  ctx.lineWidth=2; ctx.strokeStyle='#93c5fd'; ctx.fillStyle='rgba(147,197,253,0.15)';
  ctx.beginPath(); ctx.moveTo(state.editor.lassoPts[0][0],state.editor.lassoPts[0][1]);
  for(let i=1;i<state.editor.lassoPts.length;i++) ctx.lineTo(state.editor.lassoPts[i][0],state.editor.lassoPts[i][1]);
  if(close){ ctx.closePath(); ctx.fill(); }
  ctx.stroke();
}
els.lassoClear?.addEventListener('click', ()=>{ state.editor.lassoPts=[]; drawLassoStroke(false); els.lassoSave.disabled=true; els.lassoClear.disabled=true; });
els.lassoSave?.addEventListener('click', ()=>{ toast('Region saved (hook up to per-region palettes if desired).'); els.lassoSave.disabled=true; els.lassoClear.disabled=true; });

els.openEditor?.addEventListener('click', openEditor);
els.editorDone?.addEventListener('click', closeEditor);
els.toolEyedrop?.addEventListener('click', ()=>{ state.editor.tool='eyedrop'; setToolActive('toolEyedrop'); disableLasso(); enableEyedrop(); });
els.toolLasso?.addEventListener('click', ()=>{ state.editor.tool='lasso'; setToolActive('toolLasso'); disableEyedrop(); enableLasso(); });
els.toolPan?.addEventListener('click', ()=>{ state.editor.tool='pan'; setToolActive('toolPan'); disableEyedrop(); disableLasso(); });
window.addEventListener('resize', ()=>{ if(state.editor.active){ sizeEditorCanvases(); drawEditorImage(); } });

//////////////////////////// Export ////////////////////////////
function exportPNG(){
  const full=els.outCanvas._fullImageData;
  if(!full){ toast('Apply mapping first.'); return; }
  const c=document.createElement('canvas'); c.width=full.width; c.height=full.height;
  c.getContext('2d',{willReadFrequently:true}).putImageData(full,0,0);
  c.toBlob((blob)=>{
    const a=document.createElement('a'); a.download='mapped_fullres.png'; a.href=URL.createObjectURL(blob); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  },'image/png');
}
// SVG: if window.Vectorize or window.ImageTracer available
function exportSVG(){
  const full=els.outCanvas._fullImageData;
  if(!full){ toast('Apply mapping first.'); return; }
  const tmp=document.createElement('canvas'); tmp.width=full.width; tmp.height=full.height;
  tmp.getContext('2d',{willReadFrequently:true}).putImageData(full,0,0);

  if (window.Vectorize && typeof window.Vectorize.rasterToSVG === 'function'){
    const svg = window.Vectorize.rasterToSVG(tmp, { lockPalette: getRestrictedPalette() });
    downloadText(svg, 'mapped.svg');
    return;
  }
  if (window.ImageTracer){
    const svg = window.ImageTracer.imagedataToSVG(full, { numberofcolors:getFullPalette().length, pathomit:1, scale:1 });
    downloadText(svg, 'mapped.svg');
    return;
  }
  toast('No vectorizer found. Include vector.js or imagetracer.');
}
function downloadText(text, filename){
  const blob=new Blob([text],{type:'image/svg+xml'}); const a=document.createElement('a');
  a.download=filename; a.href=URL.createObjectURL(blob); a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1200);
}

//////////////////////////// UI Bind ////////////////////////////
function queueAuto(){ if(els.refreshOutput) els.refreshOutput.disabled=false; }
function bind(){
  // file inputs
  els.fileInput?.addEventListener('change', e=>handleFile(e.target.files?.[0]));
  els.cameraInput?.addEventListener('change', e=>handleFile(e.target.files?.[0]));
  els.pasteBtn?.addEventListener('click', async ()=>{
    if(!navigator.clipboard?.read){ toast('Clipboard not supported'); return; }
    try{
      const items=await navigator.clipboard.read();
      for(const it of items){ const type=it.types.find(t=>t.startsWith('image/')); if(type){ const blob=await it.getType(type); await handleFile(blob); return; } }
      toast('No image in clipboard.');
    }catch{ toast('Paste failed.'); }
  });
  els.resetBtn?.addEventListener('click', ()=> drawPreview());

  // palette
  els.addColor?.addEventListener('click', ()=>{ addPaletteRow(els.paletteList, '#FFFFFF'); queueAuto(); });
  els.clearColors?.addEventListener('click', ()=>{ els.paletteList.innerHTML=''; queueAuto(); });
  els.loadExample?.addEventListener('click', ()=>{ setPaletteInto(els.paletteList, ['#FFFFFF','#121212','#F3B14A','#1D6E2E','#2F5BCE']); queueAuto(); });

  // restricted
  els.makeRestrictedFromPalette?.addEventListener('click', ()=>{
    const full=getFullPalette(); if(!full.length){ toast('Add colors to Palette first.'); return; }
    setPaletteInto(els.restrictedList, ['#FFFFFF', ...full.slice(0,3)]);
    toast('Restricted palette = White + first 3 palette colors.');
  });
  els.clearRestricted?.addEventListener('click', ()=>{ els.restrictedList.innerHTML=''; queueAuto(); });

  // rules
  els.suggestByHueLuma?.addEventListener('click', suggestByHueAndLuma);
  els.addRuleBtn?.addEventListener('click', addManualRule);

  // mapping
  els.applyBtn?.addEventListener('click', ()=>{ applyMapping(); if(els.refreshOutput) els.refreshOutput.disabled=true; });
  els.refreshOutput?.addEventListener('click', ()=>{ applyMapping(); els.refreshOutput.disabled=true; });
  els.downloadBtn?.addEventListener('click', exportPNG);
  els.downloadSvgBtn?.addEventListener('click', exportSVG);

  // alt-click sample from preview (desktop)
  els.srcCanvas?.addEventListener('click',(evt)=>{
    if(!evt.altKey) return;
    const rect=els.srcCanvas.getBoundingClientRect();
    const x=Math.floor((evt.clientX-rect.left)*els.srcCanvas.width/rect.width);
    const y=Math.floor((evt.clientY-rect.top )*els.srcCanvas.height/rect.height);
    const d=sctx.getImageData(x,y,1,1).data;
    addPaletteRow(els.paletteList, hex(d[0],d[1],d[2]));
    queueAuto();
  });

  // startup UI defaults
  if(els.paletteList && !els.paletteList.children.length) addPaletteRow(els.paletteList,'#FFFFFF');
  if(els.restrictedList && !els.restrictedList.children.length) addPaletteRow(els.restrictedList,'#FFFFFF');
  renderRulesTable();
}

//////////////////////////// Boot ////////////////////////////
window.addEventListener('load', bind);
