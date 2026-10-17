// ui/inspector.js — 右侧属性面板（动态表单）
import { boneCN } from '../core/model.js?v=20261012y';

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
        html += `<div class="att-chip ${s.attId === a.id ? 'active' : ''}" data-att="${a.id}">${a.tex}${a.alpha != null && a.alpha < 1 ? ` (${Math.round(a.alpha * 100)}%)` : ''} <button data-delatt="${a.id}" title="删除附件">✕</button></div>`;
      }
      html += `<select id="add-att-tex">${Object.keys(p.textures).map(t => `<option>${t}</option>`).join('')}</select>
      <button data-act="add-att">+ 绑定贴图到此骨</button>`;
    }
  } else if (s.type === 'att') {
    const rig = p.rigs[s.rigId];
    const a = rig.attachments.find(x => x.id === s.attId);
    if (a) {
      html += `<h3>贴图附件</h3>
      <div class="muted">骨: ${s.rigId}/${a.bone}</div>
      <label class="chk big"><input type="checkbox" id="att-visible" ${a.visible !== false ? 'checked' : ''}> 显示（视口与导出按此状态）</label>
      <select id="att-tex">${Object.keys(p.textures).map(t => `<option ${t === a.tex ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${num('旋转 °', 'rot', a.rot)}${num('层内顺序 z', 'z', a.z)}
      <div class="hint">贴图已锁定骨骼框：拉伸铺满、边缘与色块框对齐——调骨骼框（选中骨骼拖角点/改色块长宽）即可改变贴图大小，旋转≈90° 时自动换算宽高映射</div>
      <label class="fld"><span>所在层级</span>
        <select data-k="layer">${(p.layers || []).map((nm, i) => `<option value="${i}" ${(a.layer == null ? 3 : a.layer) === i ? 'selected' : ''}>L${i} ${nm}</option>`).join('')}</select></label>
      <div class="hint">也可在左侧「贴图层级」面板拖动贴图到目标层；层号越大越靠上</div>
      <label class="fld"><span>透明度 ${(Math.round((a.alpha == null ? 1 : a.alpha) * 100))}%</span>
        <input type="range" min="0" max="1" step="0.05" data-k="alpha" value="${a.alpha == null ? 1 : a.alpha}" data-alpha-label></label>
      <div class="hint">调低透明度便于观察骨骼与色块</div>
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

  // 透明度滑条：input 实时预览，change 才入历史
  el.querySelectorAll('input[data-alpha-label]').forEach(inp => {
    inp.oninput = () => {
      if (s.type !== 'att') return;
      const a = app.project.rigs[s.rigId].attachments.find(x => x.id === s.attId);
      if (!a) return;
      a.alpha = +inp.value;
      inp.closest('.fld').querySelector('span').textContent = `透明度 ${Math.round(a.alpha * 100)}%`;
      app.redraw();
    };
  });

  if (s.type === 'bone') {
    el.querySelectorAll('.att-chip').forEach(n => n.onclick = (ev) => {
      if (ev.target.dataset.delatt) return;
      app.selection.attId = n.dataset.att; app.selection.type = 'att'; app.changed();
    });
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
      rig.attachments.push({ id: 'a' + Date.now() % 100000, bone: b.name, tex, x: 0, y: 0, rot: upright ? 90 : 0, scale: 1, z: rig.attachments.length, alpha: 1, iw: img && img.naturalWidth || 0, ih: img && img.naturalHeight || 0 });
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
    bind('#att-visible', (e) => {
      app.pushHistory();
      const a = app.project.rigs[s.rigId].attachments.find(x => x.id === s.attId);
      if (a) a.visible = e.target.checked;
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
