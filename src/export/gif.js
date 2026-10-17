// export/gif.js — 纯 JS GIF89a 编码器（零依赖，支持透明背景动画）
// frames: [{ rgba: Uint8Array|Uint8ClampedArray, w, h, delayCs }]
// 返回 Uint8Array(.gif 文件字节)

// —— 中位切分调色板（最多 maxColors 色）——
function medianCut(samples, maxColors) {
  // samples: 扁平 [r,g,b,r,g,b,...]
  if (!samples.length) return [[0, 0, 0]];
  const px = samples.slice(); // 可重排的工作副本
  let boxes = [{ lo: 0, hi: px.length / 3 }];
  const boxChannels = (lo, hi) => {
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (let i = lo; i < hi; i++) {
      const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (g < minG) minG = g; if (g > maxG) maxG = g;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
    return { r: maxR - minR, g: maxG - minG, b: maxB - minB };
  };
  while (boxes.length < maxColors) {
    // 找可分割（像素数≥2）且最长色边最大的盒子
    let best = -1, bestRange = 0, bestCh = -1, bestN = 0;
    for (let i = 0; i < boxes.length; i++) {
      const n = boxes[i].hi - boxes[i].lo;
      if (n < 2) continue;
      const c = boxChannels(boxes[i].lo, boxes[i].hi);
      const mx = Math.max(c.r, c.g, c.b);
      if (mx > bestRange) { bestRange = mx; best = i; bestCh = c.r >= c.g && c.r >= c.b ? 0 : (c.g >= c.b ? 1 : 2); bestN = n; }
    }
    if (best < 0) break; // 全部盒子都不可分
    const { lo, hi } = boxes[best];
    // 按数量中位切分（一半/一半，保证两侧都非空 → 必然推进，不会死循环）
    const idx = Array.from({ length: bestN }, (_, j) => lo + j);
    idx.sort((a, b) => px[a * 3 + bestCh] - px[b * 3 + bestCh]);
    for (let j = 0; j < bestN; j++) {
      const s = idx[j];
      px[(lo + j) * 3] = samples[s * 3]; px[(lo + j) * 3 + 1] = samples[s * 3 + 1]; px[(lo + j) * 3 + 2] = samples[s * 3 + 2];
    }
    const mid = lo + (bestN >> 1);
    boxes.splice(best, 1, { lo, hi: mid }, { lo: mid, hi });
  }
  // 每盒取平均色
  return boxes.map(box => {
    let r = 0, g = 0, b = 0; const n = box.hi - box.lo || 1;
    for (let i = box.lo; i < box.hi; i++) { r += px[i * 3]; g += px[i * 3 + 1]; b += px[i * 3 + 2]; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

// —— LZW 压缩（GIF 变体，LSB 优先打包，≤255 字节子块；导出供单测 round-trip）——
export function lzwCompress(minCodeSize, indices) {
  const CLEAR = 1 << minCodeSize, EOI = CLEAR + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map();
  let next = EOI + 1;
  const out = [];
  let cur = 0, curBits = 0, blockLen = 0;
  const bytes = [];
  const flushBlock = () => { if (blockLen > 0) { bytes.push(blockLen); bytes.push(...out.splice(0, blockLen)); blockLen = 0; } };
  const emit = (code) => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8) {
      out.push(cur & 0xFF); cur >>>= 8; curBits -= 8;
      if (++blockLen === 255) flushBlock();
    }
    // 规范码长增长检查（发出代码后）：next 已超过当前码长可表示的最大码 → 增长。
    // 解码器表项比编码器滞后一个代码，此检查与其时序锁步（已用教材式解码器逐码验证）。
    if (codeSize < 12 && next > (1 << codeSize) - 1) codeSize++;
  };
  emit(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next);
      next++;
    } else {
      // 字典满：发出 CLEAR 复位（解码器滞后一项，不会溢出）
      emit(CLEAR);
      dict = new Map(); next = EOI + 1; codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (curBits > 0) { out.push(cur & 0xFF); if (++blockLen === 255) flushBlock(); }
  flushBlock();
  bytes.push(0); // 子块终止
  return bytes;
}

// GIF 格式只支持 1-bit 透明（每个像素要么全透要么不透明，无半透明通道）。
// 阈值取 16：半透明元素（如 35% 透明度的色块，alpha≈90）以原色不透明保留，
// 只有接近全透的抗锯齿边缘才算透明——否则半透明内容会整体消失。
const ALPHA_THRESHOLD = 16;

export function encodeGif(frames, opts = {}) {
  const w = frames[0].w, h = frames[0].h;
  const hasTransparency = opts.transparent !== false;
  // 1. 采样不透明像素 → 调色板（索引 0 预留给透明）
  const maxColors = hasTransparency ? 255 : 256;
  const step = Math.max(1, Math.floor(Math.sqrt(w * h * frames.length / 40000)));
  const samples = [];
  for (const f of frames) {
    const d = f.rgba;
    for (let i = 0; i < w * h; i += step) {
      if (d[i * 4 + 3] >= ALPHA_THRESHOLD) samples.push(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    }
  }
  const palette = medianCut(samples, maxColors);
  while (palette.length < 2) palette.push([0, 0, 0]);
  // 透明模式：索引 0 保留为透明色占位（黑色），真实颜色从索引 1 开始
  if (hasTransparency) palette.unshift([0, 0, 0]);
  // 调色板尺寸取 2 的幂
  let palSize = 2; while (palSize < palette.length) palSize <<= 1;
  while (palette.length < palSize) palette.push([0, 0, 0]);
  const colorBits = Math.log2(palSize) | 0;
  const transparentIndex = hasTransparency ? 0 : -1;
  // 2. 每帧像素 → 索引（最近色 + 缓存；透明模式跳过保留的索引 0）
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let idx = cache.get(key);
    if (idx !== undefined) return idx;
    let best = hasTransparency ? 1 : 0, bestD = Infinity;
    for (let i = hasTransparency ? 1 : 0; i < palette.length; i++) {
      const p = palette[i];
      const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestD) { bestD = dist; best = i; }
    }
    cache.set(key, best);
    return best;
  };
  const out = [];
  const push = (...b) => out.push(...b);
  // Header + LSD + GCT
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
  push(w & 0xFF, (w >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF);
  push(0x80 | ((colorBits - 1) & 7) | ((colorBits - 1) << 4) | (colorBits - 1)); // GCT flag
  push(0, 0); // 背景色索引=0、像素纵横比
  for (const p of palette) push(p[0], p[1], p[2]);
  // NETSCAPE 循环扩展（无限循环）
  push(0x21, 0xFF, 11, ...Array.from('NETSCAPE2.0', c => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  // 帧数据
  for (const f of frames) {
    // 图形控制扩展：处置=2（恢复背景，透明区域透出）
    push(0x21, 0xF9, 4, 0x09, f.delayCs & 0xFF, (f.delayCs >> 8) & 0xFF, transparentIndex >= 0 ? transparentIndex : 0, 0);
    // 图像描述符
    push(0x2C, 0, 0, 0, 0, f.w & 0xFF, (f.w >> 8) & 0xFF, f.h & 0xFF, (f.h >> 8) & 0xFF, 0);
    push(Math.max(2, colorBits)); // LZW 最小编码位数
    const indices = new Uint8Array(f.w * f.h);
    const d = f.rgba;
    for (let i = 0; i < f.w * f.h; i++) {
      indices[i] = d[i * 4 + 3] < ALPHA_THRESHOLD && transparentIndex >= 0 ? 0 : nearest(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    }
    push(...lzwCompress(Math.max(2, colorBits), indices));
  }
  push(0x3B); // 结束
  return new Uint8Array(out);
}
