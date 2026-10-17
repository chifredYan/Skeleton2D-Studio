// 绑定贴图回归测试：注入贴图 → 添加附件 → 渲染，捕获 ReferenceError
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9335;
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'edge-b-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 30; i++) {
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
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8788/?reset=1' });
await sleep(2200);

// 1) 注入一张 64x64 PNG 贴图（真实 dataURL，走 ensureImages 建缓存）
const r1 = await evalJs(`(async () => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#3a9'; g.fillRect(0,0,64,64);
  app.project.textures['test.png'] = c.toDataURL('image/png');
  app.ensureImages();
  await new Promise(rs => setTimeout(rs, 300));
  return 'imgLoaded=' + !!app.images.get('test.png');
})()`);
console.log('贴图注入:', r1);

// 2) 模拟检查器「绑定贴图到此骨」：给 UpperBody 添加附件（与 inspector.js 相同逻辑）
const r2 = await evalJs(`(() => {
  const rig = app.project.rigs.humanoid;
  const b = rig.bones.find(x => x.name === 'UpperBody');
  const img = app.images.get('test.png');
  const qw = b.qw || 16;
  const scale = Math.min((b.length * 0.95) / img.naturalWidth, (qw * 0.95) / img.naturalHeight);
  rig.attachments.push({ id: 't1', bone: b.name, tex: 'test.png', x: b.length / 2, y: 0, rot: 0, scale, z: 0, alpha: 1, layer: 'L3' });
  app.selectAtt('humanoid', 't1');   // 触发 changed() → renderAll → drawScene
  return 'attached=' + rig.attachments.length;
})()`);
console.log('绑定:', r2);
await sleep(500);

// 3) 再触发一次全量渲染（换帧/选中骨骼都走 drawBones）
const r3 = await evalJs(`(() => { app.selectBone('humanoid', app.project.rigs.humanoid.bones[1].id); app.changed(); return 'rerender ok'; })()`);
await sleep(300);

console.log('异常:', errs.length ? errs : '无');
const final = await evalJs(`app.project.rigs.humanoid.attachments.length + ' attachment, images=' + app.images.size`);
console.log('最终状态:', final);
ws.close(); edge.kill(); process.exit(0);
