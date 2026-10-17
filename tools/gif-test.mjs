// gif-test.mjs — 验证 encodeGif 输出可被浏览器真实 GIF 解码器还原（像素级）
import { encodeGif } from '../src/export/gif.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const colors4 = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
const colors8 = [...colors4, [128, 128, 128], [255, 128, 0], [0, 255, 255], [255, 0, 255]];

// 帧0（seed=0）的期望图案，与下面生成逻辑一致，用于像素级比对
const expectRgba = (size, withAlpha) => {
  const exp = new Int32Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const c = colors8[(x * x * 3 + y * y * 5 + ((x * y) % 17)) % 8];
    if (!withAlpha) { exp[i] = c[0]; exp[i + 1] = c[1]; exp[i + 2] = c[2]; exp[i + 3] = 255; continue; }
    // 用例1（帧0）: 4 色图案 + 60% 不透明
    const c4 = colors4[(x * 3 + y * 5) % 4];
    const opaque = ((x * 7 + y * 11) % 10) < 6;
    exp[i] = opaque ? c4[0] : 0; exp[i + 1] = opaque ? c4[1] : 0;
    exp[i + 2] = opaque ? c4[2] : 0; exp[i + 3] = opaque ? 255 : 0;
  }
  return exp;
};

const mkFrame1 = (size, seed) => {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    const c = colors4[(x * 3 + y * 5 + seed * 7) % 4];
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2];
    rgba[i * 4 + 3] = ((x * 7 + y * 11 + seed * 13) % 10) < 6 ? 255 : 0;
  }
  return rgba;
};
const frame1 = [];
for (let i = 0; i < 3; i++) frame1.push({ rgba: mkFrame1(64, i), w: 64, h: 64, delayCs: 10 });
const gif1 = encodeGif(frame1, { transparent: true });

// 用例 2：256x256x3、8 色伪随机 → LZW 字典涨到 12bit 并触发复位
const big = [];
for (let i = 0; i < 3; i++) {
  const rgba = new Uint8Array(256 * 256 * 4);
  for (let p = 0; p < 256 * 256; p++) {
    const x = p % 256, y = (p / 256) | 0;
    const c = colors8[(x * x * 3 + y * y * 5 + i * 91 + ((x * y) % 17)) % 8];
    rgba[p * 4] = c[0]; rgba[p * 4 + 1] = c[1]; rgba[p * 4 + 2] = c[2]; rgba[p * 4 + 3] = 255;
  }
  big.push({ rgba, w: 256, h: 256, delayCs: 8 });
}
const gif2 = encodeGif(big, { transparent: false });

const outDir = mkdtempSync(join(tmpdir(), 'giftest-'));
const f1 = join(outDir, 'case1.gif'), f2 = join(outDir, 'case2.gif');
writeFileSync(f1, gif1); writeFileSync(f2, gif2);
console.log('case1.gif', gif1.length, 'bytes; case2.gif', gif2.length, 'bytes');

// —— 浏览器解码校验 ——
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
console.log('启动 Edge CDP :', PORT);
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'edge-g-')), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 30; i++) {
  try { const t = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const p = t.find(x => x.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } catch {}
  await sleep(300);
}
const ws = new WebSocket(wsUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable');

const check = async (gifBytes, size, withAlpha) => {
  const b64 = Buffer.from(gifBytes).toString('base64');
  const b = Buffer.from(expectRgba(size, withAlpha).buffer).toString('base64');
  const expr = `(async () => {
    const img = new Image();
    img.src = 'data:image/gif;base64,${b64}';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const exp = new Int32Array(Uint8Array.from(atob('${b}'), c => c.charCodeAt(0)).buffer);
    let bad = 0;
    for (let i = 0; i < exp.length; i += 4) {
      const isTrans = exp[i + 3] === 0;
      if (isTrans) { if (d[i + 3] >= 128) { bad++; } continue; }
      if (d[i] !== exp[i] || d[i + 1] !== exp[i + 1] || d[i + 2] !== exp[i + 2] || d[i + 3] < 128) bad++;
    }
    return JSON.stringify({ size: img.naturalWidth + 'x' + img.naturalHeight, bad });
  })()`;
  return JSON.parse(await ev(expr));
};

const r1 = await check(gif1, 64, true);
const ok1 = r1.size === '64x64' && r1.bad === 0;
console.log('用例1(4色+透明, 64px x3帧):', JSON.stringify(r1), ok1 ? '✓' : '✗');
const r2 = await check(gif2, 256, false);
const ok2 = r2.size === '256x256' && r2.bad === 0;
console.log('用例2(8色压力, 256px x3帧, 触发字典复位):', JSON.stringify(r2), ok2 ? '✓' : '✗');
ws.close(); edge.kill();
process.exit(ok1 && ok2 ? 0 : 1);
