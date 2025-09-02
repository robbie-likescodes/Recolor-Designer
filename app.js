// --- Auto palette extraction (top K frequent colors) ---
function sampleImageDataForClustering(ctx, w, h, targetPixels = 120000) {
  // Downsample so k-means stays fast on huge photos
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / targetPixels)));
  const sampled = new Uint8ClampedArray(((Math.floor(h / step) * Math.floor(w / step)) * 4));
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

/** Count how many sampled pixels belong to each center (RGB euclidean) */
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

/** Build a 10-color palette from the current preview canvas */
async function autoPaletteFromCanvas(canvas, k = 10) {
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;

  // 1) Sample pixels
  const sampled = sampleImageDataForClustering(ctx, w, h, 120000);

  // 2) Run k-means on the sampled buffer
  const centers = kmeans(sampled, k, 8); // reuse your existing kmeans()

  // 3) Rank centers by frequency
  const counts = countClusterSizes(centers, sampled);
  const ranked = centers
    .map((rgb, i) => ({ rgb, count: counts[i] }))
    .sort((a, b) => b.count - a.count);

  // 4) Convert to hex list and set palette
  const hexes = ranked.map(c => rgbToHex(c.rgb[0], c.rgb[1], c.rgb[2]));
  setPalette(hexes);
}
