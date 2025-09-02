/* Palette Mapper — Cup Print Helper (All-in-One JS)
   Features:
   - Mobile-friendly image upload (camera OK), clipboard paste (desktop)
   - Full-resolution processing option + preview size control
   - User-defined palette (hex), add/remove, presets (save/load)
   - Auto-extract palette via simple K-means on preview
   - Perceptual nearest-color mapping in CIELAB with tolerance sliders:
       * Lightness weight (L*)
       * Chroma weight (a*, b*)
   - Optional Floyd–Steinberg dithering
   - Background handling: keep alpha / force white / force transparency
   - PNG download (mapped result)
   - Projects saved locally (IndexedDB): image + settings, import/export JSON
   - Works as a static app (GitHub Pages-ready). No dependencies.
*/

// ---------- DOM refs ----------
const els = {
  // Image & canvases
  fileInput: document.getElementById('fileInput'),
  pasteBtn: document.getElementById('pasteBtn'),
  resetBtn: document.getElementById('resetBtn'),
  maxW: document.getElementById('maxW'),
  keepFullRes: document.getElementById('keepFullRes'),
  srcCanvas: document.getElementById('srcCanvas'),
  outCanvas: document.getElementById('outCanvas'),
  // Palette controls
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
  // Projects pane + palettes
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
};

const sctx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
const octx = els.outCanvas.getContext('2d', { willReadFrequently: true });

// ---------- App state ----------
const state = {
  fullBitmap: null,
  fullW: 0,
  fullH: 0,
  selectedProjectId: null,
};

// ---------- Utilities ----------
const clamp = (v, min, max) => v < min ? min : (v > max ? max : v);
const hexToRgb = (hex) => {
  let h = (hex || '').trim();
  if (!h.startsWith('#')) h = '#' + h;
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const fmtMult = n => (Number(n) / 100).toFixed(2) + '×';

// ---------- Storage (palettes in localStorage; projects in IndexedDB) ----------
const LS_KEYS = {
  PALETTES: 'pm_saved_palettes_v1',
  PREFS: 'pm_prefs_v1',
};

function loadSavedPalettes() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.PALETTES) || '[]'); }
  catch { return []; }
}
function saveSavedPalettes(arr) {
  localStorage.setItem(LS_KEYS.PALETTES, JSON.stringify(arr));
}
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.PREFS) || '{}'); }
  catch { return {}; }
}
function savePrefs(obj) {
  localStorage.setItem(LS_KEYS.PREFS, JSON.stringify(obj));
}

// IndexedDB wrapper
const DB_NAME = 'palette_mapper_db';
const DB_STORE = 'projects';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPutProject(rec) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.put(rec);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------- Palette UI ----------
function addPaletteRow(hex = '#FFFFFF') {
  const row = document.createElement('div');
  row.className = 'palette-item';
  row.innerHTML = `
    <input type="color" value="${hex}" aria-label="color picker">
    <input type="text" value="${hex}" aria-label="hex code" placeholder="#RRGGBB">
    <button class="ghost remove" type="button">Remove</button>
  `;
  const colorInput = row.querySelector('input[type="color"]');
  const hexInput = row.querySelector('input[type="text"]');
  const delBtn = row.querySelector('.remove');

  const sync = (fromColor) => {
    if (fromColor) hexInput.value = colorInput.value.toUpperCase();
    let v = hexInput.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#([0-9A-Fa-f]{6})$/.test(v)) {
      colorInput.value = v;
      hexInput.value = v.toUpperCase();
    }
  };
  colorInput.addEventListener('input', () => sync(true));
  hexInput.addEventListener('change', () => sync(false));
  delBtn.addEventListener('click', () => row.remove());
  els.paletteList.appendChild(row);
}
function getPalette() {
  const rows = [...els.paletteList.querySelectorAll('.palette-item')];
  const colors = [];
  for (const r of rows) {
    const hex = r.querySelector('input[type="text"]').value.trim();
    const rgb = hexToRgb(hex);
    if (rgb) colors.push([rgb.r, rgb.g, rgb.b]);
  }
  return colors;
}
function setPalette(hexes) {
  els.paletteList.innerHTML = '';
  hexes.forEach(h => addPaletteRow(h));
}

// Saved palettes UI
function renderSavedPalettes() {
  if (!els.savedPalettes) return;
  const list = loadSavedPalettes();
  els.savedPalettes.innerHTML = '';
  list.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'item';
    const swatches = p.colors.map(h => (
      `<span title="${h}" style="display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid #334155;background:${h}"></span>`
    )).join('');
    div.innerHTML = `
      <div><strong>${p.name || ('Palette ' + (idx + 1))}</strong><br><small>${p.colors.join(', ')}</small></div>
      <div>${swatches}</div>
    `;
    div.addEventListener('click', () => setPalette(p.colors));
    els.savedPalettes.appendChild(div);
  });
}

// ---------- Projects UI ----------
function setPane(open) {
  if (!els.projectsPane) return;
  els.projectsPane.classList.toggle('open', open);
  els.projectsPane.setAttribute('aria-hidden', String(!open));
}
async function refreshProjectsList() {
  if (!els.projectsList) return;
  const arr = await dbGetAll();
  arr.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)); // newest first
  els.projectsList.innerHTML = '';
  arr.forEach(rec => {
    const div = document.createElement('div');
    div.className = 'item';
    const d = new Date(rec.updatedAt || rec.createdAt);
    div.innerHTML = `
      <div><strong>${rec.name || ('Project ' + rec.id)}</strong><br><small>${d.toLocaleString()}</small></div>
      <div><button class="ghost" data-id="${rec.id}" type="button">Load</button></div>
    `;
    div.addEventListener('click', () => {
      state.selectedProjectId = rec.id;
      [...els.projectsList.children].forEach(ch => ch.classList.remove('selected'));
      div.classList.add('selected');
    });
    div.querySelector('button').addEventListener('click', async (e) => {
      e.stopPropagation();
      await loadProject(rec.id);
      setPane(false);
    });
    els.projectsList.appendChild(div);
  });
}

// ---------- Image loading & preview ----------
async function handleFile(file) {
  const bmp = await createImageBitmap(file);
  state.fullBitmap = bmp;
  state.fullW = bmp.width;
  state.fullH = bmp.height;
  drawSrc(bmp);
  toggleImageActions(true);
}
function drawSrc(bmp) {
  const mW = parseInt(els.maxW.value || '1400', 10);
  let w = bmp.width, h = bmp.height;
  if (w > mW) {
    const s = mW / w;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  els.srcCanvas.width = w;
  els.srcCanvas.height = h;
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(bmp, 0, 0, w, h);

  els.outCanvas.width = w;
  els.outCanvas.height = h;
  octx.clearRect(0, 0, w, h);
  els.downloadBtn.disabled = true;
}
function toggleImageActions(enable) {
  els.applyBtn.disabled = !enable;
  if (els.autoExtract) els.autoExtract.disabled = !enable;
  els.resetBtn.disabled = !enable;
}

// ---------- Color math (sRGB -> Lab) ----------
function srgbToLinear(u) { u /= 255; return (u <= 0.04045) ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }
function rgbToXyz(r, g, b) {
  r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  return [x, y, z];
}
function xyzToLab(x, y, z) {
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  x /= Xn; y /= Yn; z /= Zn;
  const f = t => (t > 0.008856) ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function rgbToLab(r, g, b) { const [x, y, z] = rgbToXyz(r, g, b); return xyzToLab(x, y, z); }
function deltaE2Weighted(lab1, lab2, wL, wC) {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return wL * dL * dL + wC * (da * da + db * db); // squared distance
}
function buildPaletteLab(pal) {
  return pal.map(([r, g, b]) => ({ rgb: [r, g, b], lab: rgbToLab(r, g, b) }));
}

// ---------- Mapping (with optional Floyd–Steinberg dithering) ----------
function mapToPalette(imgData, palette, wL = 1.0, wC = 1.0, dither = false, bgMode = 'keep') {
  const w = imgData.width, h = imgData.height;
  const src = imgData.data;
  const out = new ImageData(w, h);
  out.data.set(src);

  // background handling
  if (bgMode !== 'keep') {
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      if (bgMode === 'white') {
        out.data[i + 3] = 255;
      } else if (bgMode === 'transparent') {
        if (a < 128) out.data[i + 3] = 0;
      }
    }
  }

  const palLab = buildPaletteLab(palette);
  const errR = dither ? new Float32Array(w * h) : null;
  const errG = dither ? new Float32Array(w * h) : null;
  const errB = dither ? new Float32Array(w * h) : null;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const i4 = idx * 4;

      if (out.data[i4 + 3] === 0) continue; // skip fully transparent

      let r = out.data[i4], g = out.data[i4 + 1], b = out.data[i4 + 2];

      if (dither) {
        r = clamp(Math.round(r + errR[idx]), 0, 255);
        g = clamp(Math.round(g + errG[idx]), 0, 255);
        b = clamp(Math.round(b + errB[idx]), 0, 255);
      }

      const lab = rgbToLab(r, g, b);
      let best = 0, bestD = Infinity;
      for (let p = 0; p < palLab.length; p++) {
        const d2 = deltaE2Weighted(lab, palLab[p].lab, wL, wC);
        if (d2 < bestD) { bestD = d2; best = p; }
      }
      const [nr, ng, nb] = palLab[best].rgb;
      out.data[i4] = nr; out.data[i4 + 1] = ng; out.data[i4 + 2] = nb;

      if (dither) {
        const er = r - nr, eg = g - ng, eb = b - nb;
        const push = (xx, yy, fr, fg, fb) => {
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) return;
          const j = yy * w + xx;
          errR[j] += fr; errG[j] += fg; errB[j] += fb;
        };
        // Floyd–Steinberg weights
        push(x + 1, y,     er * 7 / 16, eg * 7 / 16, eb * 7 / 16);
        push(x - 1, y + 1, er * 3 / 16, eg * 3 / 16, eb * 3 / 16);
        push(x,     y + 1, er * 5 / 16, eg * 5 / 16, eb * 5 / 16);
        push(x + 1, y + 1, er * 1 / 16, eg * 1 / 16, eb * 1 / 16);
      }
    }
  }
  return out;
}

// ---------- K-means (simple, on preview) ----------
function kmeans(data, k = 5, iters = 10) {
  const n = data.length / 4;
  const centers = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.floor((c + 0.5) * n / k);
    centers.push([data[idx * 4], data[idx * 4 + 1], data[idx * 4 + 2]]);
  }
  const counts = new Array(k).fill(0);
  const sums = new Array(k).fill(0).map(() => [0, 0, 0]);

  for (let it = 0; it < iters; it++) {
    counts.fill(0);
    for (const s of sums) { s[0] = s[1] = s[2] = 0; }

    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3];
      if (a === 0) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = r - centers[c][0], dg = g - centers[c][1], db = b - centers[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      counts[best]++;
      sums[best][0] += r; sums[best][1] += g; sums[best][2] += b;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c][0] = Math.round(sums[c][0] / counts[c]);
        centers[c][1] = Math.round(sums[c][1] / counts[c]);
        centers[c][2] = Math.round(sums[c][2] / counts[c]);
      }
    }
  }
  return centers;
}

// ---------- Actions / UI wiring ----------
function updateWeightsUI() {
  if (els.wChromaOut) els.wChromaOut.textContent = fmtMult(els.wChroma.value);
  if (els.wLightOut) els.wLightOut.textContent = fmtMult(els.wLight.value);
}

function bindEvents() {
  // Palette buttons
  els.addColor?.addEventListener('click', () => addPaletteRow('#FFFFFF'));
  els.clearColors?.addEventListener('click', () => (els.paletteList.innerHTML = ''));
  els.loadExample?.addEventListener('click', () => {
    setPalette(['#FFFFFF', '#B3753B', '#5B3A21', '#D22C2C', '#1D6E2E']);
  });

  // Image inputs
  els.fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  });

  els.pasteBtn?.addEventListener('click', async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      alert('Clipboard image paste not supported on this browser. Use Upload instead.');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            await handleFile(blob);
            return;
          }
        }
      }
      alert('No image in clipboard.');
    } catch {
      alert('Clipboard read failed. Try Upload instead.');
    }
  });

  els.resetBtn?.addEventListener('click', () => {
    if (!state.fullBitmap) return;
    drawSrc(state.fullBitmap);
  });

  els.maxW?.addEventListener('change', () => {
    if (state.fullBitmap) drawSrc(state.fullBitmap);
  });

  // Auto-extract
  els.autoExtract?.addEventListener('click', () => {
    if (!els.srcCanvas.width) { alert('Load an image first.'); return; }
    const k = clamp(parseInt(els.kColors.value || '5', 10), 2, 16);
    const imgData = sctx.getImageData(0, 0, els.srcCanvas.width, els.srcCanvas.height);
    const centers = kmeans(imgData.data, k, 10);
    setPalette(centers.map(([r, g, b]) => rgbToHex(r, g, b)));
  });

  // Weights UI
  ['input', 'change'].forEach(ev => {
    els.wChroma?.addEventListener(ev, updateWeightsUI);
    els.wLight?.addEventListener(ev, updateWeightsUI);
  });

  // Apply mapping
  els.applyBtn?.addEventListener('click', async () => {
    const pal = getPalette();
    if (pal.length === 0) { alert('Add at least one color to the palette.'); return; }

    const wL = parseInt(els.wLight.value, 10) / 100;
    const wC = parseInt(els.wChroma.value, 10) / 100;
    const dither = !!els.useDither.checked;
    const bgMode = els.bgMode.value;

    let procCanvas = els.srcCanvas;
    let usingFull = false;

    if (els.keepFullRes.checked && state.fullBitmap) {
      procCanvas = document.createElement('canvas');
      procCanvas.width = state.fullW; procCanvas.height = state.fullH;
      const tctx = procCanvas.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(state.fullBitmap, 0, 0);
      usingFull = true;
    }

    const ctx = procCanvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, procCanvas.width, procCanvas.height);
    const out = mapToPalette(imgData, pal, wL, wC, dither, bgMode);

    if (usingFull) {
      // preview display, keep full data for download
      const previewW = Math.min(state.fullW, parseInt(els.maxW.value, 10));
      const scale = previewW / state.fullW;
      els.outCanvas.width = Math.round(state.fullW * scale);
      els.outCanvas.height = Math.round(state.fullH * scale);

      const off = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(state.fullW, state.fullH)
        : Object.assign(document.createElement('canvas'), { width: state.fullW, height: state.fullH });
      const offCtx = off.getContext('2d');
      offCtx.putImageData(out, 0, 0);

      let bmp;
      if (off.convertToBlob) {
        const blob = await off.convertToBlob();
        bmp = await createImageBitmap(blob);
      } else {
        const blob = await new Promise(res => off.toBlob(res));
        bmp = await createImageBitmap(blob);
      }
      octx.clearRect(0, 0, els.outCanvas.width, els.outCanvas.height);
      octx.drawImage(bmp, 0, 0, els.outCanvas.width, els.outCanvas.height);
      els.outCanvas._fullImageData = out;
    } else {
      els.outCanvas.width = out.width;
      els.outCanvas.height = out.height;
      octx.putImageData(out, 0, 0);
      els.outCanvas._fullImageData = out;
    }
    els.downloadBtn.disabled = false;
  });

  // Download PNG
  els.downloadBtn?.addEventListener('click', () => {
    const out = els.outCanvas._fullImageData;
    if (!out) { alert('Nothing to download yet.'); return; }
    const c = document.createElement('canvas');
    c.width = out.width; c.height = out.height;
    c.getContext('2d').putImageData(out, 0, 0);
    c.toBlob((blob) => {
      const a = document.createElement('a');
      a.download = 'mapped.png';
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  });

  // Saved palettes
  els.savePalette?.addEventListener('click', () => {
    const pal = getPalette();
    if (!pal.length) { alert('No colors to save.'); return; }
    const name = prompt('Palette name?') || `Palette ${Date.now()}`;
    const hexes = pal.map(([r, g, b]) => rgbToHex(r, g, b));
    const arr = loadSavedPalettes();
    arr.unshift({ name, colors: hexes });
    saveSavedPalettes(arr.slice(0, 30));
    renderSavedPalettes();
  });
  els.clearSavedPalettes?.addEventListener('click', () => {
    if (!confirm('Clear all saved palettes?')) return;
    saveSavedPalettes([]);
    renderSavedPalettes();
  });

  // Projects pane actions
  els.openProjects?.addEventListener('click', () => setPane(true));
  els.closeProjects?.addEventListener('click', () => setPane(false));
  els.refreshProjects?.addEventListener('click', refreshProjectsList);

  els.saveProject?.addEventListener('click', async () => {
    if (!state.fullBitmap) { alert('Load an image first.'); return; }
    const name = prompt('Project name?') || `Project ${Date.now()}`;
    const tmp = document.createElement('canvas');
    tmp.width = state.fullW; tmp.height = state.fullH;
    tmp.getContext('2d').drawImage(state.fullBitmap, 0, 0);
    const blob = await new Promise(res => tmp.toBlob(res, 'image/png', 0.92));
    const rec = {
      id: state.selectedProjectId || undefined,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: getCurrentSettings(),
      imageBlob: blob,
    };
    const id = await dbPutProject(rec);
    state.selectedProjectId = id;
    await refreshProjectsList();
    alert('Saved.');
  });

  els.exportProject?.addEventListener('click', async () => {
    const id = state.selectedProjectId;
    if (!id) { alert('Select a project in the list first (tap it).'); return; }
    const rec = await dbGet(id);
    if (!rec) { alert('Project not found.'); return; }
    const b64 = await blobToBase64(rec.imageBlob);
    const out = {
      name: rec.name,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      settings: rec.settings,
      imageBase64: b64,
    };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = (rec.name || 'project') + '.json';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  els.importProject?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const obj = JSON.parse(text);
      if (!obj.imageBase64 || !obj.settings) { alert('Invalid project file.'); return; }
      const blob = base64ToBlob(obj.imageBase64);
      const rec = {
        name: obj.name || `Imported ${Date.now()}`,
        createdAt: obj.createdAt || Date.now(),
        updatedAt: Date.now(),
        settings: obj.settings,
        imageBlob: blob,
      };
      const id = await dbPutProject(rec);
      await refreshProjectsList();
      await loadProject(id);
      setPane(false);
      alert('Imported.');
    } catch {
      alert('Invalid JSON.');
    } finally {
      e.target.value = '';
    }
  });

  els.deleteProject?.addEventListener('click', async () => {
    const id = state.selectedProjectId;
    if (!id) { alert('Select a project (tap it) then Delete.'); return; }
    if (!confirm('Delete selected project?')) return;
    await dbDelete(id);
    state.selectedProjectId = null;
    await refreshProjectsList();
  });
}

// ---------- Settings helpers ----------
function getCurrentSettings() {
  return {
    palette: getPalette().map(([r, g, b]) => rgbToHex(r, g, b)),
    maxW: parseInt(els.maxW.value, 10),
    keepFullRes: !!els.keepFullRes.checked,
    wChroma: parseInt(els.wChroma.value, 10),
    wLight: parseInt(els.wLight.value, 10),
    useDither: !!els.useDither.checked,
    bgMode: els.bgMode.value,
  };
}
function applySettings(s) {
  if (!s) return;
  if (s.palette) setPalette(s.palette);
  if (s.maxW) els.maxW.value = s.maxW;
  if ('keepFullRes' in s) els.keepFullRes.checked = !!s.keepFullRes;
  if (s.wChroma) els.wChroma.value = s.wChroma;
  if (s.wLight) els.wLight.value = s.wLight;
  if ('useDither' in s) els.useDither.checked = !!s.useDither;
  if (s.bgMode) els.bgMode.value = s.bgMode;
  updateWeightsUI();
}

async function loadProject(id) {
  const rec = await dbGet(id);
  if (!rec) { alert('Project not found.'); return; }
  const bmp = await createImageBitmap(rec.imageBlob);
  state.fullBitmap = bmp;
  state.fullW = bmp.width;
  state.fullH = bmp.height;
  drawSrc(bmp);
  toggleImageActions(true);
  applySettings(rec.settings);
  state.selectedProjectId = id;
}

// ---------- Blob/Base64 helpers ----------
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64) {
  const byteChars = atob(b64);
  const len = byteChars.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

// ---------- Init ----------
function init() {
  // Default palette / prefs
  const prefs = loadPrefs();
  if (prefs.lastPalette) setPalette(prefs.lastPalette);
  else setPalette(['#FFFFFF', '#000000']); // minimal starter
  if (prefs.keepFullRes !== undefined) els.keepFullRes.checked = !!prefs.keepFullRes;
  if (prefs.maxW) els.maxW.value = prefs.maxW;
  if (prefs.wChroma) els.wChroma.value = prefs.wChroma;
  if (prefs.wLight) els.wLight.value = prefs.wLight;
  if (prefs.bgMode) els.bgMode.value = prefs.bgMode;
  if (prefs.useDither !== undefined) els.useDither.checked = !!prefs.useDither;
  updateWeightsUI();
  renderSavedPalettes();

  // Persist prefs on changes
  const savePrefsNow = () => savePrefs({
    lastPalette: getPalette().map(([r, g, b]) => rgbToHex(r, g, b)),
    keepFullRes: els.keepFullRes.checked,
    maxW: parseInt(els.maxW.value, 10),
    wChroma: parseInt(els.wChroma.value, 10),
    wLight: parseInt(els.wLight.value, 10),
    bgMode: els.bgMode.value,
    useDither: els.useDither.checked,
  });
  ['change', 'input'].forEach(ev => {
    document.addEventListener(ev, (e) => {
      if (!e.target) return;
      if (e.target.closest('.palette-item') ||
          e.target === els.keepFullRes ||
          e.target === els.maxW ||
          e.target === els.wChroma ||
          e.target === els.wLight ||
          e.target === els.bgMode ||
          e.target === els.useDither) {
        savePrefsNow();
      }
    });
  });

  // Projects list on open
  refreshProjectsList();

  // Enable/disable buttons initially
  toggleImageActions(!!state.fullBitmap);
}

bindEvents();
window.addEventListener('load', init);
