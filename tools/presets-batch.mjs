// 批量验证 8 个姿势预设 + 导出 4×2 雪碧图（隐藏骨骼、色块100%、透明背景）
import { spawn } from 'node:child_process';
import { mkdtempSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const L = (m) => appendFileSync('.sheets-trace.log', m + '\n');
const OUT = 'export_sheets';
mkdirSync(OUT, { recursive: true });

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9365;
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'edge-all-')), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
try {
  let wsUrl; for (let i = 0; i < 30; i++) { try { const t = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const p = t.find(x => x.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break } } catch { } await sleep(300) }
  const ws = new WebSocket(wsUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const pend = new Map(); const errs = []; const dialogs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.message || ''); send('Page.handleJavaScriptDialog', { accept: true }); }
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) });
  const ev = async (e) => {
    const m = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) { L('EVAL-ERR: ' + (m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text).slice(0, 250)); return undefined; }
    return m.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8788/?reset=1' }); await sleep(2500);

  L('0 加载: ' + await ev("window.app && app.project ? 'OK' : 'MISSING'"));
  L('1 菜单: ' + await ev(`[...document.getElementById('pose-preset').options].map(o=>o.value).filter(Boolean).join(',')`));

  const PRESETS = ['idle', 'run', 'attack', 'jump', 'hurt', 'dead', 'backstep', 'dash'];
  for (const key of PRESETS) {
    // 应用预设 + 导出设置（隐藏骨骼、色块100%）
    const info = await ev(`(() => {
      const sel = document.getElementById('pose-preset');
      sel.value = '${key}'; sel.dispatchEvent(new Event('change'));
      app.view.showBones = false; app.view.showQuads = true; app.view.showTex = true;
      const s = document.getElementById('qalpha-slider');
      s.value = '1'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change'));
      const anim = app.anim();
      // 循环连续性：每条轨道 |k7-k0| 应与相邻帧最大步长同量级（dead 除外）
      let worst = 0, worstBone = '';
      for (const t of anim.tracks) {
        const k = t.keys;
        if (k.length !== 8) continue;
        const wrap = Math.abs(k[0].rot - k[7].rot);
        let maxAdj = 0;
        for (let f = 0; f < 7; f++) maxAdj = Math.max(maxAdj, Math.abs(k[f + 1].rot - k[f].rot));
        if (wrap > maxAdj * 1.6 + 8 && wrap > 25) { if (wrap > worst) { worst = wrap; worstBone = t.boneRef; } }
      }
      return 'frames=' + anim.frames + ' fps=' + anim.fps + ' loop=' + anim.loop
        + ' weaponVis=' + app.project.rigs.weapon.visible
        + ' dockAttached=' + (app.project.docks.find(d => d.guestRig === 'weapon') || {}).attached
        + ' | 循环断点: ' + (worst ? worstBone + ' ' + worst.toFixed(1) + '°' : '无');
    })()`);
    L(`[${key}] ${info}`);

    // 导出 4×2 雪碧图
    const r = await ev(`(async () => {
      document.getElementById('sheet-cols').value = '4';
      document.getElementById('sheet-rows').value = '2';
      let captured = null;
      const orig = app.downloadBlob.bind(app);
      app.downloadBlob = (blob, name) => { captured = { blob, name }; };
      await app.exportSpriteSheet();
      for (let i = 0; i < 80 && !captured; i++) await new Promise(res => setTimeout(res, 50));
      app.downloadBlob = orig;
      if (!captured) return null;
      const buf = await captured.blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return { name: captured.name, size: bytes.length, b64: btoa(binary) };
    })()`);
    if (!r) { L(`[${key}] 导出失败! dialogs=${JSON.stringify(dialogs)}`); }
    else {
      writeFileSync(join(OUT, `${key}_8f_4x2.png`), Buffer.from(r.b64, 'base64'));
      L(`[${key}] 导出: ${r.name} | ${r.size} bytes`);
    }
  }
  // 攻击额外导出 GIF 预览
  const g = await ev(`(async () => {
    const sel = document.getElementById('pose-preset');
    sel.value = 'attack'; sel.dispatchEvent(new Event('change'));
    let captured = null;
    const orig = app.downloadBlob.bind(app);
    app.downloadBlob = (blob, name) => { captured = { blob, name }; };
    await app.exportGif();
    for (let i = 0; i < 120 && !captured; i++) await new Promise(res => setTimeout(res, 50));
    app.downloadBlob = orig;
    if (!captured) return null;
    const buf = await captured.blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { size: bytes.length, b64: btoa(binary) };
  })()`);
  if (g) { writeFileSync(join(OUT, 'attack_8f_preview.gif'), Buffer.from(g.b64, 'base64')); L('attack GIF: ' + g.size + ' bytes'); }
  else L('attack GIF 失败');
  L('errs: ' + errs.length + (errs[0] ? ' ' + errs[0].slice(0, 200) : ''));
  ws.close(); edge.kill();
} catch (e) { L('ERR: ' + e.stack); }
