// 用 Edge headless + CDP 复现：上传 PNG → 自动保存 → 刷新 → 抓报错
// 用法: node cdp-test.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'edge-cdp-'));

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1400,900', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = await res.json();
      const page = tabs.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Edge CDP 未就绪');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleLogs = [];
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
    consoleLogs.push(`[${m.params.type}] ${text}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(`${d.text} ${d.exception?.description || ''} @ ${d.url || ''}:${d.lineNumber}`);
  }
};
function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    return { error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') };
  }
  return { value: r.result?.result?.value };
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8788' });
await sleep(2500);

console.log('== 第一次加载 ==');
console.log('异常:', exceptions.length ? exceptions : '无');
let r = await evalJs(`typeof app !== 'undefined' && app.project ? 'app OK, bones=' + app.project.rigs.humanoid.bones.length : 'app MISSING'`);
console.log(r.value ?? r.error);

console.log('\n== 模拟上传 1024px PNG ==');
r = await evalJs(`(async () => {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#3a7'; g.fillRect(0, 0, 1024, 1024);
  g.fillStyle = '#fff'; g.font = '80px sans-serif'; g.fillText('TEST', 300, 500);
  const dataURL = c.toDataURL('image/png');
  app.project.textures['test-hero.png'] = dataURL;
  app.ensureImages(); app.changed();
  await new Promise(rs => setTimeout(rs, 800)); // 等自动保存
  return 'uploaded, dataURL bytes=' + dataURL.length;
})()`);
console.log(r.value ?? r.error);

console.log('\n== 刷新页面（模拟重开） ==');
exceptions.length = 0; consoleLogs.length = 0;
await send('Page.navigate', { url: 'http://localhost:8788' });
await sleep(2500);
console.log('异常:', exceptions.length ? exceptions : '无');
console.log('控制台:', consoleLogs.slice(0, 10).join(' | ') || '无');
r = await evalJs(`typeof app !== 'undefined' && app.project ? 'app OK, bones=' + app.project.rigs.humanoid.bones.length + ', textures=' + Object.keys(app.project.textures).join(',') : 'app MISSING — 项目崩溃!'`);
console.log(r.value ?? r.error);

// 多传几张 + 反复刷新压力测试
console.log('\n== 压力：连续上传大体积噪声图（中文名+括号）直到配额超限 ==');
r = await evalJs(`(async () => {
  const log = [];
  for (let k = 0; k < 6; k++) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
    const g = c.getContext('2d');
    const d = g.createImageData(1024, 1024);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = Math.random() * 255; d.data[i+1] = Math.random() * 255;
      d.data[i+2] = Math.random() * 255; d.data[i+3] = 255;
    }
    g.putImageData(d, 0, 0);
    const url = c.toDataURL('image/png');
    app.project.textures['噪声角色_' + k + ' (1).png'] = url;
    app.ensureImages(); app.changed();
    await new Promise(rs => setTimeout(rs, 500));
    log.push(k + ':' + Math.round(url.length / 1024) + 'KB');
  }
  await new Promise(rs => setTimeout(rs, 1500));
  return 'sizes ' + log.join(' ');
})()`);
console.log(r.value ?? r.error);
console.log('上传过程异常:', exceptions.length ? exceptions : '无');
exceptions.length = 0; consoleLogs.length = 0;

// 关键场景：模拟内嵌预览 localStorage 不持久化 → 清空存储后刷新，应从服务端磁盘恢复
console.log('\n== 清空 localStorage 后刷新（模拟内嵌预览存储丢失） ==');
r = await evalJs(`(async () => { localStorage.clear(); return 'cleared'; })()`);
console.log(r.value ?? r.error);
await send('Page.navigate', { url: 'http://localhost:8788' });
await sleep(3000);
console.log('刷新后异常:', exceptions.length ? exceptions : '无');
r = await evalJs(`new Promise(res => setTimeout(() => {
  res(typeof app !== 'undefined' && app.project
    ? 'app OK, textures=' + Object.keys(app.project.textures).length
      + ' bones=' + app.project.rigs.humanoid.bones.length
      + (Object.keys(app.project.textures).length >= 2 ? ' ← 服务端恢复成功' : ' ← 贴图丢了!')
    : 'app MISSING — 项目崩溃!');
}, 1500))`);
console.log(r.value ?? r.error);

// 模拟用户继续操作：选中骨骼 + 历史 + 撤销重做
r = await evalJs(`(() => {
  try {
    app.selectBone('humanoid', app.project.rigs.humanoid.bones[0].id);
    app.pushHistory(); app.changed();
    app.undo(); app.redo();
    return '交互 OK';
  } catch (e) { return '交互崩溃: ' + e.message + '\\n' + e.stack; }
})()`);
console.log(r.value ?? r.error);

ws.close();
edge.kill();
process.exit(0);
