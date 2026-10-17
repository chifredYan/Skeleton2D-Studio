// tools/cdp-shot.mjs — 截图当前界面（选中含贴图的骨骼，确认属性面板排版）
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9339;
const OUT = join(tmpdir(), 's2d-shot-' + Date.now() + '.png');
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'edge-sh-'))}`, '--no-first-run',
  '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = tabs.find(t => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}
const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:8788/' });
await sleep(2800);

// 真实点击选中 Head 骨骼
const pt = await evalJs(`(() => {
  const w = app._lastWorlds.get('humanoid/Head');
  const sx = app.view.panX + app.view.zoom * (w.mat.e + (w.bone.length||0)/2);
  const sy = app.view.panY + app.view.zoom * w.mat.f;
  const r = document.getElementById('viewport').getBoundingClientRect();
  return { x: sx + r.left, y: sy + r.top };
})()`);
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
}
await sleep(600);
// 属性面板滚到底部，确保新增区块可见
await evalJs(`(() => { const e = document.getElementById('inspector'); e.scrollTop = e.scrollHeight; return e.scrollTop; })()`);
await sleep(300);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log(OUT);
ws.close(); edge.kill(); process.exit(0);
