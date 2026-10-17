// ui/timeline.js — 帧式时间轴
export function renderTimeline(el, app) {
  const anim = app.anim();
  if (!anim) { el.innerHTML = '<div class="muted" style="padding:8px">无动画</div>'; return; }
  const F = anim.frames;

  const rows = [];
  // 每条轨道一行
  for (const tr of anim.tracks) {
    rows.push({ ref: tr.boneRef, keys: new Set(tr.keys.map(k => k.f)), stepped: tr.stepped, track: tr });
  }
  // 选中骨骼若无轨道，给一行可 K 帧的空行
  const selRef = app.selectedBoneRef();
  if (selRef && !rows.find(r => r.ref === selRef)) {
    rows.push({ ref: selRef, keys: new Set(), stepped: true, track: null });
  }

  let html = `<div class="tl-toolbar">
    <span class="tl-anim">${anim.name}</span>
    <span class="muted">${anim.fps}fps · ${anim.frames}帧 · ${anim.loop ? '循环' : '单次'}</span>
    <button data-act="kall" title="把当前姿态K为所有骨骼的关键帧">K帧(全部)</button>
    <button data-act="copy-prev" title="复制上一帧姿态到当前帧">⧉上一帧</button>
    <button data-act="del-key" title="删除选中骨骼当前帧关键帧">删K</button>
    <label class="chk"><input type="checkbox" id="tl-onion" ${app.onion ? 'checked' : ''}>洋葱皮</label>
    <label class="chk"><input type="checkbox" id="tl-autokey" ${app.autoKey ? 'checked' : ''}>自动K帧</label>
  </div>`;

  // 帧号行
  html += `<div class="tl-row tl-head"><div class="tl-name">帧</div><div class="tl-cells">`;
  for (let f = 0; f < F; f++) html += `<div class="tl-cell num ${f === app.curFrame ? 'cur' : ''}">${f}</div>`;
  html += `</div></div>`;

  for (const r of rows) {
    const nm = r.ref.split('/');
    html += `<div class="tl-row"><div class="tl-name" title="${r.ref}">${nm[0]}/${nm[1]}${r.track ? (r.track.stepped ? ' <span class="muted">·步进</span>' : ' <span class="muted">·补间</span>') : ''}</div><div class="tl-cells">`;
    for (let f = 0; f < F; f++) {
      const hasKey = r.keys.has(f);
      html += `<div class="tl-cell ${f === app.curFrame ? 'cur' : ''}" data-ref="${r.ref}" data-f="${f}">${hasKey ? '<span class="key">◆</span>' : ''}</div>`;
    }
    html += `</div></div>`;
  }
  el.innerHTML = html;

  el.querySelectorAll('.tl-cell[data-f]').forEach(n => {
    n.onclick = (ev) => {
      const f = +n.dataset.f;
      if (ev.shiftKey && n.querySelector('.key')) { app.deleteKey(n.dataset.ref, f); }
      else app.setFrame(f);
    };
  });
  el.querySelector('[data-act="kall"]').onclick = () => app.keyAllBones();
  el.querySelector('[data-act="copy-prev"]').onclick = () => app.copyPrevFrame();
  el.querySelector('[data-act="del-key"]').onclick = () => app.deleteKey(selRef, app.curFrame);
  el.querySelector('#tl-onion').onchange = (e) => { app.onion = e.target.checked; app.redraw(); };
  el.querySelector('#tl-autokey').onchange = (e) => { app.autoKey = e.target.checked; };
}
