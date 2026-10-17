// ui/inspector.js — 右侧属性面板（动态表单）
import { boneCN, defaultLayerOf } from '../core/model.js?v=20261018a';

export function renderInspector(el, app) {
  const p = app.project;
  const s = app.selection;
  let html = '';

  if (s.type === 'bone') {
    const rig = p.rigs[s.rigId];
    const b = rig.bones.find(x => x.id === s.boneId);
    if (b) {
      const pose = app.editedPoseOf(s.rigId + '/' + b.name);
      html += `<h3>骨骼 ${b.name}${boneCN(b.name) ? `<span class="muted">（${boneCN(b.name)}）</span>` : ''}</h3>
      ${num('色块长(骨长)', 'len', b.length)}${num('色块宽 qw', 'qw', b.qw || 16)}
      <div class="sec">挂点（相对父骨骼的骨架连接位置，改动能同步所有关键帧）</div>
      ${num('挂点 x', 'rx', b.rest.x)}${num('挂点 y', 'ry', b.rest.y)}
      <div class="sec">本地姿态（当前帧）</div>
      ${num('位置 x', 'x', pose.x)}${num('位置 y', 'y', pose.y)}
      ${num('旋转 °', 'rot', pose.rot)}${num('缩放 sx', 'sx', pose.sx)}${num('缩放 sy', 'sy', pose.sy)}
      <div class="hint">拖灰点=移动 · Shift+拖灰点=旋转 · Ctrl+拖灰点=改挂点 · 拖蓝条=旋转 · 拖角点=调色块</div>
      <div class="sec">贴图附件</div>`;
      const atts = rig.attachments.filter(a => a.bone === b.name);
      if (!atts.length) html += `<div class="muted">无（先上传贴图，再点下方添加）</div>`;
      for (const a of atts) {
        const flags = `${a.flipX ? ' ⇋' : ''}${a.flipY ? ' ⇵' : ''}${a.visible === false ? ' ·隐藏' : ''}`;
        html += `<div class="att-chip ${s.attId === a.id ? 'active' : ''}" data-att="${a.id}">${a.tex}${a.alpha != null && a.alpha < 1 ? ` (${Math.round(a.alpha * 100)}%)` : ''}${flags} <button data-delatt="${a.id}" title="删除附件">✕</button></div>`;
      }
      html += `<select id="add-att-tex">${Object.keys(p.textures).map(t => `<option>${t}</option>`).join('')}</select>
      <button data-act="add-att">+ 绑定贴图到此骨</button>`;
      // —— 贴图属性：作用于该骨骼下当前选中（或第一个）附件 ——
      if (atts.length) {
        const cur = atts.find(x => x.id === s.attId) || atts[0];
        html += `<div class="sec">贴图属性</div>`;
        if (atts.length > 1) {
          html += `<label class="fld"><span>当前贴图</span><select id="att-pick">${atts.map(a => `<option value="${a.id}" ${a.id === cur.id ? 'selected' : ''}>${a.tex}</option>`).join('')}</select></label>`;
        }
        html += attPropsHTML(cur, p.layers);
        html += `<div class="hint">反转沿贴图自身轴向镜像；层级数字越大越靠上，同层按 z 排序</div>`;
      }
    }
  } else if (s.type === 'att') {
    const rig = p.rigs[s.rigId];
    const a = rig.attachments.find(x => x.id === s.attId);
    if (a) {
      html += `<h3>贴图附件</h3>
      <div class="muted">骨: ${s.rigId}/${a.bone}</div>
      <select id="att-tex">${Object.keys(p.textures).map(t => `<option ${t === a.tex ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${attPropsHTML(a, p.layers)}
      <div class="hint">贴图已锁定骨骼框：拉伸铺满、边缘与色块框对齐——调骨骼框（选中骨骼拖角点/改色块长宽）即可改变贴图大小，旋转≈90° 时自动换算宽高映射</div>
      <div class="hint">也可在左侧「贴图层级」面板拖动贴图到目标层；层号越大越靠上</div>
      <button data-act="del-att">删除附件</button>`;
    }
  } else if (s.type === 'dock') {
    const d = p.docks.find(x => x.id === s.dockId);
    if (d) {
      html += `<h3>对接 Dock</h3>
      <div class="muted">${d.hostRig}/${d.hostBone} ← ${d.guestRig}/${d.guestBone}</div>
      <label class="chk big"><input type="checkbox" id="dock-attached" ${d.attached ? 'checked' : ''}> 挂接在一起（取消=分离）</label>
      <div class="hint">挂接：武器根骨落在手骨原点、随手臂一起动，导出时并入人形场景；分离：武器独立（可做御剑/飞剑），人形手部导出 Marker2D。</div>`;
    }
  } else {
    html += `<h3>动画</h3>
      <div class="sec">动画列表</div>
      <select id="anim-sel">${p.animations.map((a, i) => `<option value="${i}" ${i === app.curAnim ? 'selected' : ''}>${a.name}</option>`).join('')}</select>
      ${num('帧数', 'frames', app.anim().frames)}${num('FPS', 'fps', app.anim().fps)}
      <label class="chk"><input type="checkbox" id="anim-loop" ${app.anim().loop ? 'checked' : ''}>循环</label>
      <button data-act="new-anim">+ 新建动画</button>
      <button data-act="del-anim" ${p.animations.length <= 1 ? 'disabled' : ''}>删除当前动画</button>
      <div class="sec">导出</div>
      <label class="chk"><input type="radio" name="expmode" value="attached" ${app.exportMode === 'attached' ? 'checked' : ''}>人形+武器合并（单场景）</label>
      <label class="chk"><input type="radio" name="expmode" value="detached" ${app.exportMode === 'detached' ? 'checked' : ''}>分离导出（Marker2D 挂点）</label>
      <button data-act="export" class="primary">导出 ZIP（Godot 直接可用）</button>
      <div id="export-warn"></div>
      <div class="sec">帧图导出（按所见状态：骨骼/色块/贴图开关 + 单张贴图显隐）</div>
      <button data-act="export-png">导出当前帧 PNG（透明背景）</button>
      <div class="sheet-grid">
        列 <input type="number" id="sheet-cols" min="1" step="1" value="${app.spriteCols || Math.ceil(Math.sqrt(app.anim().frames))}">
        行 <input type="number" id="sheet-rows" min="1" step="1" value="${app.spriteRows || Math.ceil(app.anim().frames / Math.ceil(Math.sqrt(app.anim().frames)))}">
      </div>
      <button data-act="export-seq">导出 PNG 序列图（单张 · 按行列网格）</button>
      <button data-act="export-gif">导出 GIF 动图（全部帧，透明）</button>
      <div class="hint">PNG 支持半透明；GIF 格式只支持全透/不透明，半透明色块会以原色不透明近似呈现</div>
      <div class="sec">工程</div>
      <button data-act="save-proj">导出工程文件 (.json)</button>
      <button data-act="load-proj">导入工程文件</button>`;
  }
  el.innerHTML = html;
  bindInspector(el, app);
}

function num(label, key, val) {
  return `<label class="fld"><span>${label}</span><input type="number" step="any" data-k="${key}" value="${(+val).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}"></label>`;
}

function fmtNum(v) {
  const n = +v;
  if (!isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
}

// 贴图附件属性组：旋转 / 水平反转 / 垂直反转 / 显示 / 透明度 / 层级 / 层内顺序
// 统一用 data-attprop 绑定，骨骼面板与附件面板共用同一套控件
function attPropsHTML(a, layers) {
  const alpha = a.alpha == null ? 1 : a.alpha;
  const layer = a.layer == null ? 3 : a.layer;
  return `
  <label class="fld"><span>旋转 °</span><input type="number" step="any" data-attprop="rot" value="${fmtNum(a.rot)}"></label>
  <div class="chk-row">
    <label class="chk"><input type="checkbox" data-attprop="flipX" ${a.flipX ? 'checked' : ''} title="沿贴图自身 X 轴镜像">水平反转 ⇋</label>
    <label class="chk"><input type="checkbox" data-attprop="flipY" ${a.flipY ? 'checked' : ''} title="沿贴图自身 Y 轴镜像">垂直反转 ⇵</label>
  </div>
  <label class="chk big"><input type="checkbox" data-attprop="visible" ${a.visible !== false ? 'checked' : ''}> 显示（视口与导出按此状态）</label>
  <label class="fld"><span data-attalpha-label>透明度 ${Math.round(alpha * 100)}%</span>
    <input type="range" min="0" max="1" step="0.05" data-attprop="alpha" value="${alpha}"></label>
  <label class="fld"><span>所在层级</span>
    <select data-attprop="layer">${(layers || []).map((nm, i) => `<option value="${i}" ${layer === i ? 'selected' : ''}>L${i} ${nm}</option>`).join('')}</select></label>
  <label class="fld"><span>层内顺序 z</span><input type="number" step="1" data-attprop="z" value="${a.z | 0}"></label>`;
}

// 当前可编辑的附件：附件选中态取自身；骨骼选中态取该骨骼下 s.attId 或第一个附件
function currentAtt(app) {
  const s = app.selection || {};
  const rig = s.rigId ? app.project.rigs[s.rigId] : null;
  if (!rig) return null;
  if (s.type === 'att') return rig.attachments.find(x => x.id === s.attId) || null;
  if (s.type === 'bone') {
    const b = rig.bones.find(x => x.id === s.boneId);
    if (!b) return null;
    const list = rig.attachments.filter(x => x.bone === b.name);
    return list.find(x => x.id === s.attId) || list[0] || null;
  }
  return null;
}

function bindInspector(el, app) {
  const s = app.selection;
  el.querySelectorAll('input[data-k], select[data-k]').forEach(inp => {
    inp.onchange = () => {
      const v = parseFloat(inp.value) || 0;
      app.pushHistory();
      if (s.type === 'bone') {
        const bb = app.project.rigs[s.rigId].bones.find(x => x.id === s.boneId);
        if (inp.dataset.k === 'len' && bb) {
          const vL = Math.max(4, v);
          app.refitAttachments(s.rigId, bb.name, bb.length, bb.qw, vL, bb.qw);
          bb.length = vL;
        }
        else if (inp.dataset.k === 'qw' && bb) {
          const vQ = Math.max(4, v);
          app.refitAttachments(s.rigId, bb.name, bb.length, bb.qw, bb.length, vQ);
          bb.qw = vQ;
        }
        else if ((inp.dataset.k === 'rx' || inp.dataset.k === 'ry') && bb) {
          // 挂点编辑：改 rest 并同步平移该骨骼所有关键帧（setRestPos）
          app.setRestPos(s.rigId, bb,
            inp.dataset.k === 'rx' ? v : bb.rest.x,
            inp.dataset.k === 'ry' ? v : bb.rest.y);
        }
        else app.editBoneLocal(inp.dataset.k, v);
      } else if (s.type === 'att') {
        const a = app.project.rigs[s.rigId].attachments.find(x => x.id === s.attId);
        if (a) a[inp.dataset.k] = v;
      } else if (s.type === 'anim') {
        const a = app.anim();
        if (inp.dataset.k === 'frames') a.frames = Math.max(1, Math.min(600, v | 0));
        if (inp.dataset.k === 'fps') a.fps = Math.max(1, Math.min(60, v | 0));
      }
      app.changed();
    };
  });
  const bind = (sel, fn) => { const n = el.querySelector(sel); if (n) n.onchange = fn; };
  const click = (sel, fn) => { const n = el.querySelector(sel); if (n) n.onclick = fn; };

  // —— 贴图属性（data-attprop）：骨骼面板快捷区与附件面板共用同一套控件 ——
  el.querySelectorAll('[data-attprop]').forEach(inp => {
    const k = inp.dataset.attprop;
    const write = () => {
      const a = currentAtt(app);
      if (!a) return;
      if (k === 'flipX' || k === 'flipY' || k === 'visible') a[k] = inp.checked;
      else if (k === 'layer') a.layer = Math.max(0, Math.min((app.project.layers || []).length - 1, parseInt(inp.value, 10) || 0));
      else if (k === 'z') a.z = Math.round(parseFloat(inp.value) || 0);
      else a[k] = parseFloat(inp.value) || 0;
      if (k === 'alpha') {
        const lab = el.querySelector('[data-attalpha-label]');
        if (lab) lab.textContent = `透明度 ${Math.round((a.alpha == null ? 1 : a.alpha) * 100)}%`;
      }
    };
    if (inp.type === 'range') {
      // 拖动实时预览（不重渲染，避免控件失焦），松手才提交并入历史
      inp.onpointerdown = () => app.pushHistory();
      inp.oninput = () => { write(); app.redraw(); };
      inp.onchange = () => { write(); app.changed(); };
    } else {
      inp.onchange = () => { app.pushHistory(); write(); app.changed(); };
    }
  });

  if (s.type === 'bone') {
    el.querySelectorAll('.att-chip').forEach(n => n.onclick = (ev) => {
      if (ev.target.dataset.delatt) return;
      app.selection.attId = n.dataset.att; app.selection.type = 'att'; app.changed();
    });
    // 骨骼面板「当前贴图」切换：仅切 attId，保持骨骼选中态，下方属性组随之切换
    bind('#att-pick', (e) => { app.selection.attId = e.target.value; app.changed(); });
    el.querySelectorAll('[data-delatt]').forEach(n => n.onclick = () => {
      app.pushHistory();
      const rig = app.project.rigs[s.rigId];
      rig.attachments = rig.attachments.filter(a => a.id !== n.dataset.delatt);
      app.changed();
    });
    click('[data-act="add-att"]', () => {
      const tex = el.querySelector('#add-att-tex').value;
      if (!tex) { alert('请先上传贴图'); return; }
      app.pushHistory();
      const rig = app.project.rigs[s.rigId];
      const b = rig.bones.find(x => x.id === s.boneId);
      // 贴图锁定骨骼框：记录原图尺寸，视口/导出按框实时适配，默认居中
      // 竖版图（人物立绘）默认转 90°——长边对齐骨骼长度方向，避免适配过小
      const img = app.images.get(tex);
      const upright = img && img.naturalHeight > img.naturalWidth;
      rig.attachments.push({ id: 'a' + Date.now() % 100000, bone: b.name, tex, x: 0, y: 0, rot: upright ? 90 : 0, scale: 1, z: rig.attachments.length, alpha: 1, visible: true, flipX: false, flipY: false, layer: defaultLayerOf(b.name, rig.type, rig.id), iw: img && img.naturalWidth || 0, ih: img && img.naturalHeight || 0 });
      app.selection.type = 'att'; app.selection.attId = rig.attachments[rig.attachments.length - 1].id;
      app.changed();
    });
  } else if (s.type === 'att') {
    bind('#att-tex', (e) => {
      app.pushHistory();
      const a = app.project.rigs[s.rigId].attachments.find(x => x.id === s.attId);
      if (a) a.tex = e.target.value;
      app.changed();
    });
    click('[data-act="del-att"]', () => {
      app.pushHistory();
      const rig = app.project.rigs[s.rigId];
      rig.attachments = rig.attachments.filter(a => a.id !== s.attId);
      app.selection = { type: 'bone', rigId: s.rigId, boneId: s.boneId };
      app.changed();
    });
  } else if (s.type === 'dock') {
    bind('#dock-attached', (e) => {
      app.pushHistory();
      const d = app.project.docks.find(x => x.id === s.dockId);
      if (d) d.attached = e.target.checked;
      app.changed();
    });
  } else {
    bind('#anim-sel', (e) => { app.curAnim = +e.target.value; app.setFrame(0); app.changed(); });
    bind('#anim-loop', (e) => { app.anim().loop = e.target.checked; app.changed(); });
    click('[data-act="new-anim"]', () => app.newAnimation());
    click('[data-act="del-anim"]', () => app.deleteAnimation());
    el.querySelectorAll('input[name="expmode"]').forEach(r => r.onchange = () => { app.exportMode = r.value; });
    click('[data-act="export"]', () => app.doExport());
    click('[data-act="export-png"]', () => app.exportFramePng());
    click('[data-act="export-seq"]', () => {
      app.spriteCols = Math.max(1, parseInt(el.querySelector('#sheet-cols').value, 10) || 1);
      app.spriteRows = Math.max(1, parseInt(el.querySelector('#sheet-rows').value, 10) || 1);
      app.exportSpriteSheet();
    });
    click('[data-act="export-gif"]', () => app.exportGif());
    click('[data-act="save-proj"]', () => app.saveProjectFile());
    click('[data-act="load-proj"]', () => app.loadProjectFile());
  }
}
