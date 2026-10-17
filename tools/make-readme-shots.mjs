// tools/make-readme-shots.mjs — 生成 README 配图（真实界面截图，1920×1080）
// 注意：全程只用 app.redraw()/renderAll()，不调用 app.changed()，避免触发工程自动保存写盘
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
const W = 1920, H = 1080;
const OUTDIR = 'docs/images';
mkdirSync(OUTDIR, { recursive: true });

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'edge-shot-'))}`, '--no-first-run',
  '--disable-gpu', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
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
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
  return r.result?.result?.value;
};
const shot = async (name, clip) => {
  const p = { format: 'png' };
  if (clip) p.clip = { ...clip, scale: 2 };
  const r = await send('Page.captureScreenshot', p);
  const f = join(OUTDIR, name);
  writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  console.log('已保存', f);
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:8788/' });
await sleep(3200);

// —— 安全护栏：截图期间彻底禁用自动保存（app.changed 是唯一的落盘入口）——
await evalJs(`(() => {
  app.changed = function () { this.renderAll(); }; // 仅重渲染，不写 localStorage / 服务端
  return 'autosave disabled';
})()`);

// —— 注入演示用占位贴图（仅在内存中，绝不写存档）——
// 仓库不带美术资源，README 截图用程序生成的色块部件，便于展示贴图/层级效果
const injected = await evalJs(`(async () => {
  const mk = (w, h, c1, c2) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const r = Math.min(w, h) * 0.3;
    g.beginPath(); g.roundRect(5, 5, w - 10, h - 10, r);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, c1); grd.addColorStop(1, c2);
    g.fillStyle = grd; g.fill();
    g.lineWidth = 6; g.strokeStyle = 'rgba(45,45,45,0.5)'; g.stroke();
    return cv.toDataURL();
  };
  // 头部单独画五官，拉伸到骨骼框后仍能认出是"头"
  const mkFace = (w, h) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.beginPath(); g.roundRect(5, 5, w - 10, h - 10, Math.min(w, h) * 0.34);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#f2d3b4'); grd.addColorStop(1, '#cf9b6d');
    g.fillStyle = grd; g.fill();
    g.lineWidth = 7; g.strokeStyle = 'rgba(45,45,45,0.5)'; g.stroke();
    g.fillStyle = '#3a3230';
    g.beginPath(); g.arc(w * 0.36, h * 0.44, w * 0.055, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(w * 0.64, h * 0.44, w * 0.055, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(70,50,40,0.75)'; g.lineWidth = 5;
    g.beginPath(); g.arc(w * 0.5, h * 0.62, w * 0.13, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
    return cv.toDataURL();
  };
  const load = (url) => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = url; });
  // 9 张部件贴图 → 15 根骨骼（左右共用同一张，保证人物对称）
  const texDef = {
    'demo_head.png':  ['#f0cfae', '#c99a72', 174, 136],
    'demo_torso.png': ['#8fb4d9', '#4f7ea8', 120, 160],
    'demo_hip.png':   ['#7b8ea3', '#4c5c6e', 110, 96],
    'demo_uarm.png':  ['#8fb4d9', '#4f7ea8', 130, 62],
    'demo_farm.png':  ['#f0cfae', '#c99a72', 110, 56],
    'demo_hand.png':  ['#f0cfae', '#c99a72', 52, 52],
    'demo_uleg.png':  ['#7b8ea3', '#4c5c6e', 150, 70],
    'demo_lleg.png':  ['#7b8ea3', '#4c5c6e', 140, 64],
    'demo_foot.png':  ['#9c7b55', '#6d5238', 72, 46]
  };
  const boneMap = [
    ['Head', 'demo_head.png', 5], ['UpperBody', 'demo_torso.png', 3], ['LowerBody', 'demo_hip.png', 2],
    ['UpperArmR', 'demo_uarm.png', 4], ['ForeArmR', 'demo_farm.png', 4], ['HandR', 'demo_hand.png', 4],
    ['UpperArmL', 'demo_uarm.png', 4], ['ForeArmL', 'demo_farm.png', 4], ['HandL', 'demo_hand.png', 4],
    ['UpperLegR', 'demo_uleg.png', 1], ['LowerLegR', 'demo_lleg.png', 1], ['FootR', 'demo_foot.png', 1],
    ['UpperLegL', 'demo_uleg.png', 1], ['LowerLegL', 'demo_lleg.png', 1], ['FootL', 'demo_foot.png', 1]
  ];
  const rig = app.project.rigs.humanoid;
  app.project.qalpha = 0.14; // 色块调淡，让贴图成为视觉主体
  for (const [name, [c1, c2, w, h]] of Object.entries(texDef)) {
    const url = name === 'demo_head.png' ? mkFace(w, h) : mk(w, h, c1, c2);
    app.project.textures[name] = url;
    app.images.set(name, await load(url));
  }
  let z = 0;
  for (const [bone, tex, layer] of boneMap) {
    const target = rig.bones.find(b => b.name === bone);
    if (!target) continue;
    const [w, h] = [texDef[tex][2], texDef[tex][3]];
    rig.attachments.push({
      id: 'demo-' + bone, bone: bone, tex: tex, x: 0, y: 0, rot: 0, scale: 1,
      z: z++, alpha: 1, visible: true, flipX: false, flipY: false,
      layer: layer, iw: w, ih: h
    });
  }
  app.renderAll();
  return Object.keys(texDef).length + ' 张贴图 / ' + rig.attachments.length + ' 个附件';
})()`);
console.log('已注入演示贴图:', injected);

// —— 构图：只按人形包围盒居中（分离状态的武器会拉宽画面），临时隐藏武器 rig ——
const fit = await evalJs(`(() => {
  app.project.rigs.weapon.visible = false;
  app.project.rigs.weapon2.visible = false;
  app.project.docks.forEach(d => { d.attached = false; }); // 挂接状态下武器会随宿主绘制，需一并解挂
  app.redraw();
  const c = document.getElementById('viewport');
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for (const [ref, w] of app._lastWorlds) {
    if (!ref.startsWith('humanoid/')) continue;
    for (const q of [{x:0,y:0},{x:w.bone.length||0,y:0}]) {
      const wx = w.mat.a*q.x + w.mat.c*q.y + w.mat.e;
      const wy = w.mat.b*q.x + w.mat.d*q.y + w.mat.f;
      minX=Math.min(minX,wx); maxX=Math.max(maxX,wx);
      minY=Math.min(minY,wy); maxY=Math.max(maxY,wy);
    }
  }
  const bw = Math.max(1, maxX-minX), bh = Math.max(1, maxY-minY);
  const zoom = Math.min(c.width/(bw*1.55), c.height/(bh*1.35));
  app.view.zoom = Math.max(0.2, Math.min(3, zoom));
  app.view.panX = c.width/2 - app.view.zoom*(minX+bw/2);
  app.view.panY = c.height/2 - app.view.zoom*(minY+bh/2);
  app.redraw();
  return { zoom: +app.view.zoom.toFixed(2), cw: c.width, ch: c.height };
})()`);
console.log('视图:', JSON.stringify(fit));

// —— 图A：时间轴（保留当前帧关键帧高亮）——
const tlRect = await evalJs(`(() => { const r = document.getElementById('timeline').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
await shot('03-timeline.png', tlRect);

// —— 切到 rest 姿态（T-pose）便于展示：curFrame=-1 不采样轨道，仅内存状态 ——
await evalJs(`(() => {
  app.curFrame = -1; app.edits.clear();
  const rig = app.project.rigs.humanoid;
  const head = rig.bones.find(b => b.name === 'Head');
  const att = rig.attachments.find(a => a.bone === 'Head');
  app.selection = { type: 'bone', rigId: 'humanoid', boneId: head.id, attId: att ? att.id : undefined };
  app.renderAll();
  return 1;
})()`);
await sleep(600);

// —— 图1：工作区总览（编辑态：色块 + 骨骼线 + 选中骨骼 + 属性面板）——
await shot('01-overview.png');

// —— 图2：纯贴图预览（关闭色块与骨骼线，只看美术成品）——
await evalJs(`(() => {
  app.view.showQuads = false;
  app.view.showBones = false;
  app.redraw();
  return 1;
})()`);
await sleep(500);
await shot('02-textured.png');

// 恢复显示开关
await evalJs(`(() => {
  app.view.showQuads = true;
  app.view.showBones = true;
  app.redraw();
  return 1;
})()`);
await sleep(400);

// —— 图4：右侧属性面板（含贴图属性区）——
await evalJs(`(() => { const e=document.getElementById('inspector'); e.scrollTop = 300; return 1; })()`);
await sleep(300);
const insRect = await evalJs(`(() => { const r = document.getElementById('inspector').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
await shot('04-inspector.png', insRect);

// —— 图5：左侧骨架树 + 8 层贴图层级 ——
await evalJs(`(() => { const e=document.getElementById('tree'); e.scrollTop = e.scrollHeight; return 1; })()`);
await sleep(400);
const treeRect = await evalJs(`(() => { const r = document.getElementById('tree').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
await shot('02-panels.png', treeRect);

ws.close(); edge.kill(); await sleep(400); process.exit(0);
