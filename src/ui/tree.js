// ui/tree.js — 左侧骨架树（折叠+拖拽换父级） + Dock 管理 + 7 层贴图层级（拖拽调层）
import { effZ, reparentBone, boneCN } from '../core/model.js?v=20261012y';

let dragAtt = null; // {rigId, attId}
let dragBone = null; // {rigId, boneName}
const collapsedRigs = new Set(); // 折叠的 rig（会话级）

export function renderTree(el, app) {
  const p = app.project;
  let html = '';
  for (const rigId of Object.keys(p.rigs)) {
    const rig = p.rigs[rigId];
    const collapsed = collapsedRigs.has(rigId);
    const hidden = rig.visible === false;
    html += `<div class="tree-rig ${app.curRig === rigId ? 'active' : ''}" data-rig="${rigId}" data-rig-drop="1">
      <span class="rig-caret" data-caret="${rigId}">${collapsed ? '▶' : '▼'}</span><span class="rig-dot ${rig.type}"></span>${rigId}
      <span class="muted">(${rig.type === 'humanoid' ? '人形' : '武器'})</span>${hidden ? '<span class="tag off">隐藏</span>' : ''}</div>`;
    if (!collapsed) html += renderBoneLi(rig, rig.bones.filter(b => !b.parent), app, 0);
  }
  // Dock 区
  html += `<div class="tree-rig"><span class="rig-dot dock"></span>对接 (Dock)</div>`;
  for (const d of p.docks) {
    const sel = app.selection.type === 'dock' && app.selection.dockId === d.id;
    html += `<div class="tree-item dock-item ${sel ? 'active' : ''}" data-dock="${d.id}">
      ${d.hostRig}/${d.hostBone} ← ${d.guestRig} ${d.attached ? '<span class="tag on">已挂接</span>' : '<span class="tag off">分离</span>'}</div>`;
  }
  // 贴图层级区（拖动贴图到目标层）
  html += `<div class="tree-rig"><span class="rig-dot dock"></span>贴图层级（${p.layers.length} 层，拖动调整）</div>`;
  for (let i = 0; i < p.layers.length; i++) {
    const items = [];
    for (const rigId of Object.keys(p.rigs)) {
      for (const a of p.rigs[rigId].attachments.filter(x => (x.layer == null ? 3 : x.layer) === i)) {
        const sel = app.selection.type === 'att' && app.selection.rigId === rigId && app.selection.attId === a.id;
        items.push(`<div class="layer-att ${sel ? 'active' : ''}" draggable="true"
          data-att-rig="${rigId}" data-att-id="${a.id}" title="${rigId}/${a.bone}">${rigId.slice(0, 4)}·${a.tex}
          <button class="att-eye" data-eye-rig="${rigId}" data-eye-id="${a.id}" title="显示/隐藏贴图（导出按所见状态）">${a.visible === false ? '🚫' : '👁'}</button></div>`);
      }
    }
    html += `<div class="layer-row" data-layer="${i}">
      <div class="layer-head"><span class="layer-idx">L${i}</span>${p.layers[i]}</div>
      <div class="layer-items">${items.join('') || '<span class="muted">空</span>'}</div></div>`;
  }
  el.innerHTML = html;

  el.querySelectorAll('[data-rig]').forEach(n => n.onclick = (ev) => {
    if (ev.target.dataset.caret) return; // 折叠箭头单独处理
    app.selectRig(n.dataset.rig);
  });
  el.querySelectorAll('[data-bone]').forEach(n => n.onclick = () => {
    app.selectBone(n.dataset.rig, n.dataset.bone);
  });
  el.querySelectorAll('[data-dock]').forEach(n => n.onclick = () => { app.selectDock(n.dataset.dock); });

  // —— 折叠 ——
  el.querySelectorAll('[data-caret]').forEach(n => n.onclick = (ev) => {
    ev.stopPropagation();
    const rigId = n.dataset.caret;
    if (collapsedRigs.has(rigId)) collapsedRigs.delete(rigId); else collapsedRigs.add(rigId);
    renderTree(el, app);
  });

  // —— 骨骼拖拽换父级（拖到哪个层级下面就跟随哪个层级旋转）——
  el.querySelectorAll('[data-bone]').forEach(n => {
    n.addEventListener('dragstart', (ev) => {
      dragBone = { rigId: n.dataset.rig, boneId: n.dataset.bone };
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', n.dataset.bone); } catch (e) {}
    });
    n.addEventListener('dragend', () => { dragBone = null; });
    n.addEventListener('dragover', (ev) => {
      if (!dragBone) return;
      ev.preventDefault();
      n.classList.add('drop-hover');
    });
    n.addEventListener('dragleave', () => n.classList.remove('drop-hover'));
    n.addEventListener('drop', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      n.classList.remove('drop-hover');
      doReparent(el, app, n.dataset.rig, boneNameOf(app, n.dataset.rig, n.dataset.bone));
    });
  });
  // 拖到 rig 标题 = 变为根骨
  el.querySelectorAll('[data-rig-drop]').forEach(n => {
    n.addEventListener('dragover', (ev) => {
      if (!dragBone) return;
      ev.preventDefault();
      n.classList.add('drop-hover');
    });
    n.addEventListener('dragleave', () => n.classList.remove('drop-hover'));
    n.addEventListener('drop', (ev) => {
      ev.preventDefault();
      n.classList.remove('drop-hover');
      doReparent(el, app, n.dataset.rig, null);
    });
  });

  // 附件 chip：点击选中
  el.querySelectorAll('.layer-att').forEach(n => n.onclick = () => {
    app.selectAtt(n.dataset.attRig, n.dataset.attId);
  });
  // 附件 chip 显隐小按钮（不影响选中）
  el.querySelectorAll('.att-eye').forEach(n => n.onclick = (ev) => {
    ev.stopPropagation();
    const rig = app.project.rigs[n.dataset.eyeRig];
    const a = rig && rig.attachments.find(x => x.id === n.dataset.eyeId);
    if (!a) return;
    app.pushHistory();
    a.visible = a.visible === false; // undefined → true（隐藏）
    app.changed();
  });
  // 拖拽：贴图 chip → 目标层
  el.querySelectorAll('.layer-att').forEach(n => {
    n.addEventListener('dragstart', (ev) => {
      dragAtt = { rigId: n.dataset.attRig, attId: n.dataset.attId };
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', n.dataset.attId); } catch (e) {}
    });
    n.addEventListener('dragend', () => { dragAtt = null; });
  });
  el.querySelectorAll('.layer-row').forEach(row => {
    row.addEventListener('dragover', (ev) => { ev.preventDefault(); row.classList.add('drop-hover'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-hover'));
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      row.classList.remove('drop-hover');
      if (!dragAtt) return;
      const rig = app.project.rigs[dragAtt.rigId];
      const a = rig && rig.attachments.find(x => x.id === dragAtt.attId);
      if (!a) return;
      const target = +row.dataset.layer;
      if (a.layer === target) return;
      app.pushHistory();
      a.layer = target;
      dragAtt = null;
      app.changed();
    });
  });
}

function boneNameOf(app, rigId, boneId) {
  const rig = app.project.rigs[rigId];
  const b = rig && rig.bones.find(x => x.id === boneId);
  return b ? b.name : null;
}

function doReparent(el, app, rigId, newParentName /* null=根 */) {
  if (!dragBone || dragBone.rigId !== rigId) { dragBone = null; return; }
  const rig = app.project.rigs[rigId];
  const bone = rig.bones.find(x => x.id === dragBone.boneId);
  dragBone = null;
  if (!bone) return;
  if ((newParentName || null) === bone.name) return;
  const err = reparentBone(rig, bone.name, newParentName);
  if (err) { alert('无法移动: ' + err); return; }
  app.pushHistory();
  app.edits.clear();  // 本地编辑缓存按旧层级记录，清掉避免错乱
  app.changed();
  renderTree(el, app);
}

function renderBoneLi(rig, bones, app, depth) {
  let html = '';
  for (const b of bones) {
    const sel = app.selection.type === 'bone' && app.selection.rigId === rig.id && app.selection.boneId === b.id;
    const hasAtt = rig.attachments.some(a => a.bone === b.name);
    const hasKids = rig.bones.some(x => x.parent === b.id);
    html += `<div class="tree-item ${sel ? 'active' : ''}" draggable="true" data-rig="${rig.id}" data-bone="${b.id}" data-bone-drop="1" style="padding-left:${8 + depth * 14}px">
      <span class="bone-name">${b.name}${boneCN(b.name) ? `<span class="muted">（${boneCN(b.name)}）</span>` : ''}</span>${hasKids ? '<span class="tag">⛓</span>' : ''}${hasAtt ? '<span class="tag tex">贴图</span>' : ''}</div>`;
    html += renderBoneLi(rig, rig.bones.filter(x => x.parent === b.id), app, depth + 1);
  }
  return html;
}
