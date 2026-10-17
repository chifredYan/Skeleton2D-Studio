// tools/cdp-attprops.mjs — 端到端验证：骨骼面板「贴图属性」区（旋转/翻转/显隐/透明度/层级）
// 全部选中与勾选动作走 CDP Input.dispatchMouseEvent 真实鼠标事件，不用脚本直接改 state
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 存档备份：本测试会写入真实工程，结束（含异常退出）后回滚，避免污染用户数据
const PROJ = '.autosave/project.json';
let backup = null;
try { backup = readFileSync(PROJ, 'utf8'); } catch (e) {}
const restore = () => { if (backup) { try { writeFileSync(PROJ, backup); } catch (e) {} } };
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(1); });

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9337;
const URL = 'http://localhost:8788/';
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'edge-ap-'))}`, '--no-first-run',
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
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return '__ERR__ ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 160);
  return r.result?.result?.value;
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(280);
};
// 取控件中心坐标：先滚动到可视区（属性面板可滚动，否则点击会落到裁剪区外失效）
const rectOf = async (sel) => {
  const r = await evalJs(`(() => {
    const n = document.querySelector(${JSON.stringify(sel)});
    if (!n) return null;
    n.scrollIntoView({ block: 'center', inline: 'nearest' });
    const b = n.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, vh: innerHeight };
  })()`);
  if (!r || r.w === 0 || r.h === 0) return null;
  return r;
};

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(2600);

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// —— 1. 用真实点击选中含贴图的骨骼（Head）——
const target = await evalJs(`(() => {
  const w = app._lastWorlds && app._lastWorlds.get('humanoid/Head');
  if (!w) return null;
  const cx = w.mat.e + (w.bone.length||0)/2, cy = w.mat.f;
  const sx = app.view.panX + app.view.zoom * cx, sy = app.view.panY + app.view.zoom * cy;
  const r = document.getElementById('viewport').getBoundingClientRect();
  return { x: sx + r.left, y: sy + r.top, atts: app.project.rigs.humanoid.attachments.filter(a => a.bone === 'Head').length };
})()`);
if (!target) { console.log('无法定位 Head 骨骼，可能存档未加载'); }
else {
  await click(target.x, target.y);
  const sel = await evalJs(`JSON.stringify(app.selection)`);
  ok('真实点击选中 Head 骨骼', /"bone"/.test(sel || ''), sel);
  ok('Head 骨已有贴图附件', target.atts > 0, `附件数=${target.atts}`);

  // —— 2. 面板出现贴图属性控件 ——
  const controls = await evalJs(`(() => {
    const ks = [...document.querySelectorAll('#inspector [data-attprop]')].map(n => n.dataset.attprop);
    return { count: ks.length, keys: ks.join(','), hasPick: !!document.querySelector('#att-pick') };
  })()`);
  ok('贴图属性控件齐全（7 项）', controls && controls.count === 7
    && controls.keys === 'rot,flipX,flipY,visible,alpha,layer,z', JSON.stringify(controls));

  // —— 3. 记录翻转前像素指纹（整幅画布，任何渲染变化都能捕捉）——
  const hash = `(() => {
    const c = document.getElementById('viewport');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0;
    return h;
  })()`;
  const h1 = await evalJs(hash);

  // —— 4. 真实点击「水平反转」——
  const fxCb = await rectOf('#inspector [data-attprop="flipX"]');
  if (fxCb) await click(fxCb.x, fxCb.y);
  const st1 = await evalJs(`(() => {
    const a = app.project.rigs.humanoid.attachments.filter(x => x.bone === 'Head')
      .find(x => x.id === app.selection.attId) || app.project.rigs.humanoid.attachments.filter(x=>x.bone==='Head')[0];
    return a ? JSON.stringify({ id: a.id, flipX: a.flipX, flipY: a.flipY }) : 'none';
  })()`);
  ok('水平反转写入数据模型', /"flipX":true/.test(st1 || ''), st1);
  await sleep(260);
  const h2 = await evalJs(hash);
  ok('水平反转已反映到画面像素', h1 !== h2, `hash ${h1} → ${h2}`);

  // —— 5. 真实点击「垂直反转」——
  const fyCb = await rectOf('#inspector [data-attprop="flipY"]');
  if (fyCb) await click(fyCb.x, fyCb.y);
  await sleep(260);
  const h3 = await evalJs(hash);
  ok('垂直反转已反映到画面像素', h2 !== h3, `hash ${h2} → ${h3}`);

  // —— 6. 显示开关（真实点击）——
  const visCb = await rectOf('#inspector [data-attprop="visible"]');
  if (visCb) await click(visCb.x, visCb.y);
  await sleep(260);
  const vis = await evalJs(`(() => {
    const a = app.project.rigs.humanoid.attachments.filter(x => x.bone === 'Head')[0];
    return a ? String(a.visible) : 'none';
  })()`);
  const h4 = await evalJs(hash);
  ok('显示开关生效（隐藏后像素变化）', vis === 'false' && h3 !== h4, `visible=${vis}, hash ${h3} → ${h4}`);
  // 复原显示（重渲染后重新取坐标）
  const visCb2 = await rectOf('#inspector [data-attprop="visible"]');
  if (visCb2) await click(visCb2.x, visCb2.y);

  // —— 7. 透明度滑条（程序化 input 事件，range 拖动无法用鼠标精确定位）——
  const alphaRes = await evalJs(`(() => {
    const n = document.querySelector('#inspector [data-attprop="alpha"]');
    if (!n) return 'no-control';
    const before = app.project.rigs.humanoid.attachments.filter(x=>x.bone==='Head')[0].alpha;
    n.value = '0.4'; n.dispatchEvent(new Event('input', { bubbles: true }));
    const mid = app.project.rigs.humanoid.attachments.filter(x=>x.bone==='Head')[0].alpha;
    n.dispatchEvent(new Event('change', { bubbles: true }));
    const label = document.querySelector('#inspector [data-attalpha-label]')?.textContent || '';
    return JSON.stringify({ before, mid, label });
  })()`);
  ok('透明度滑条生效并同步标签', /"mid":0.4/.test(alphaRes || '') && /40%/.test(alphaRes || ''), alphaRes);

  // —— 8. 层级下拉 ——
  const layerRes = await evalJs(`(() => {
    const n = document.querySelector('#inspector [data-attprop="layer"]');
    if (!n) return 'no-control';
    n.value = '7'; n.dispatchEvent(new Event('change', { bubbles: true }));
    const a = app.project.rigs.humanoid.attachments.filter(x=>x.bone==='Head')[0];
    return JSON.stringify({ layer: a.layer });
  })()`);
  ok('层级下拉写入数据模型', /"layer":7/.test(layerRes || ''), layerRes);

  // —— 9. 旋转输入 ——
  const rotRes = await evalJs(`(() => {
    const n = document.querySelector('#inspector [data-attprop="rot"]');
    if (!n) return 'no-control';
    n.value = '45'; n.dispatchEvent(new Event('change', { bubbles: true }));
    const a = app.project.rigs.humanoid.attachments.filter(x=>x.bone==='Head')[0];
    return JSON.stringify({ rot: a.rot });
  })()`);
  ok('旋转输入写入数据模型', /"rot":45/.test(rotRes || ''), rotRes);
}

ok('运行期无 JS 异常', errs.length === 0, errs.length ? errs[0].slice(0, 200) : '无');
const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
ws.close(); edge.kill();
await sleep(700); // 等页面最后一次 autosave debounce 落到磁盘，再回滚存档
process.exit(failed.length ? 1 : 0);
