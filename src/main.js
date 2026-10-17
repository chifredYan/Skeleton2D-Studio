// main.js — 应用控制器
import { newProject, samplePose, matInvert, matApply, matMul, matTRS, makeHumanoid, makeWeapon, ensureQuads, ensureLayers, ensureWeapon2 } from './core/model.js?v=20261018a';
import { computeWorld, drawScene, hitTest, setImagesCache } from './render/viewport.js?v=20261018a';
import { renderTree } from './ui/tree.js?v=20261018a';
import { renderTimeline } from './ui/timeline.js?v=20261018a';
import { renderInspector } from './ui/inspector.js?v=20261018a';
import { exportProject } from './export/pkg.js?v=20261018a';
import { textBytes } from './export/zip.js?v=20261018a';
import { encodeGif } from './export/gif.js?v=20261018a';
import { POSE_PRESETS } from './core/presets.js?v=20261018a';

const $ = (id) => document.getElementById(id);

const app = {
  project: null,
  selection: { type: 'none' },
  curRig: 'humanoid',
  curAnim: 0,
  curFrame: 0,
  playing: false,
  autoKey: true,
  onion: false,
  exportMode: 'attached',
  view: { zoom: 1, panX: 340, panY: 230, showQuads: true, showBones: true, showTex: true },  // 默认 100%（1 单位 = 1 屏幕像素）；pan 对准 ×5 后的角色躯干中心；骨骼/色块/贴图三开关（导出按所见状态）
  edits: new Map(),      // boneRef -> {x?,y?,rot?,sx?,sy?} 当前帧未K帧的编辑
  images: new Map(),     // texName -> HTMLImageElement
  history: [],
  redoStack: [],

  anim() { return this.project.animations[this.curAnim]; },
  selectedBoneRef() {
    const s = this.selection;
    if (s.type === 'bone') return s.rigId + '/' + this.project.rigs[s.rigId].bones.find(b => b.id === s.boneId)?.name;
    if (s.type === 'att') return s.rigId + '/' + this.project.rigs[s.rigId].attachments.find(a => a.id === s.attId)?.bone;
    return null;
  },
  editedPoseOf(ref) {
    const [rigId, boneName] = ref.split('/');
    const rig = this.project.rigs[rigId];
    const bone = rig.bones.find(b => b.name === boneName);
    if (!bone) return { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
    const sampled = samplePose(this.anim(), this.curFrame);
    const base = { x: bone.rest.x, y: bone.rest.y, rot: bone.rest.rot, sx: 1, sy: 1 };
    const s = sampled.get(ref); if (s) Object.assign(base, s);
    const e = this.edits.get(ref); if (e) Object.assign(base, e);
    return base;
  },
  poseOfForDraw() {
    return this.makePoseSampler(samplePoseCache, true);
  },
  // 采样器：挂接状态下武器根骨永远落在手骨原点（忽略其独立摆放位置与旧编辑残留），
  // 随手骨（含整个手臂链）一起旋转
  makePoseSampler(cache, useEdits) {
    const docks = this.project.docks, edits = this.edits;
    return (rigId, bone) => {
      const ref = rigId + '/' + bone.name;
      const isAttRoot = docks.some(d => d.attached && d.guestRig === rigId && d.guestBone === bone.name);
      if (isAttRoot) {
        // 挂接：忽略独立摆放 rest，落在手骨原点；已有 K 帧轨道/当前编辑仍相对手骨叠加
        const base = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
        const s = cache.get(ref); if (s) Object.assign(base, s);
        if (useEdits) { const e = edits.get(ref); if (e) Object.assign(base, e); }
        return base;
      }
      const base = { x: bone.rest.x, y: bone.rest.y, rot: bone.rest.rot, sx: 1, sy: 1 };
      const s = cache.get(ref); if (s) Object.assign(base, s);
      if (useEdits) { const e = edits.get(ref); if (e) Object.assign(base, e); }
      return base;
    };
  },

  pushHistory() {
    // 历史快照不含贴图数据（贴图可能数 MB，序列化会卡死主线程）
    this.history.push(JSON.stringify({ ...this.project, textures: {} }));
    if (this.history.length > 60) this.history.shift();
    this.redoStack.length = 0;
  },
  undo() {
    if (!this.history.length) return;
    this.redoStack.push(JSON.stringify({ ...this.project, textures: {} }));
    const tex = this.project.textures;
    this.project = JSON.parse(this.history.pop());
    this.project.textures = tex;
    this.postLoad(); this.changed();
  },
  redo() {
    if (!this.redoStack.length) return;
    this.history.push(JSON.stringify({ ...this.project, textures: {} }));
    const tex = this.project.textures;
    this.project = JSON.parse(this.redoStack.pop());
    this.project.textures = tex;
    this.postLoad(); this.changed();
  },

  postLoad() {
    this.migrateProject();
    ensureQuads(this.project);
    ensureLayers(this.project);
    this.edits.clear();
    this.selection = { type: 'none' };
    if (this.curAnim >= this.project.animations.length) this.curAnim = 0;
    this.ensureImages();
  },
  // 旧工程自动升级到 15 骨新模板（保留贴图与附件，骨骼名映射）
  migrateProject() {
    const p = this.project;
    if (!p || !p.rigs || (!p.rigs.humanoid && !p.rigs.hero)) { this.project = newProject(); return; }
    ensureWeapon2(p);  // rig 改名(hero→humanoid/sword→weapon) + 补第二把武器 + 双武器 Dock（旧工程）
    const humanoid = p.rigs.humanoid;
    if (humanoid.bones.length !== 15 || humanoid.bones[0].name !== 'LowerBody' || humanoid.bones[0].rest.rot === -90) {
      const map = { Hip: 'LowerBody', Spine: 'UpperBody', Chest: 'UpperBody', Neck: 'UpperBody' };
      const oldAtts = humanoid.attachments || [];
      const newBody = makeHumanoid('humanoid');
      newBody.attachments = oldAtts
        .map(a => ({ ...a, bone: map[a.bone] || a.bone }))
        .filter(a => newBody.bones.some(b => b.name === a.bone));
      const weapon = (p.rigs.weapon && p.rigs.weapon.bones && p.rigs.weapon.bones.length <= 2)
        ? p.rigs.weapon : makeWeapon('weapon');
      p.rigs = { humanoid: newBody, weapon };
      if (!Array.isArray(p.docks) || !p.docks.length) {
        p.docks = [{ id: 'd1', hostRig: 'humanoid', hostBone: 'HandR', guestRig: 'weapon', guestBone: 'Grip', x: 0, y: 0, rot: 0, attached: false }];
      }
      const hostOk = newBody.bones.some(b => b.name === p.docks[0].hostBone);
      if (!hostOk) { p.docks[0].hostBone = 'HandR'; }
    }
    // 偏移锁定迁移：贴图强制居中于骨骼框（x/y 固定 0，大小只随框变）
    if (p.attCenter !== true) {
      for (const rig of Object.values(p.rigs)) {
        for (const a of rig.attachments || []) { a.x = 0; a.y = 0; }
      }
      p.attCenter = true;
    }
  },
  ensureImages() {
    for (const [name, dataURL] of Object.entries(this.project.textures)) {
      if (!this.images.has(name)) {
        const img = new Image();
        img.onload = () => {
          // 回填旧附件缺失的原图尺寸；竖版图且未旋转的自动转 90°（长边对齐骨骼方向）
          for (const rig of Object.values(this.project.rigs)) {
            for (const a of rig.attachments) {
              if (a.tex !== name || a.iw) continue;
              a.iw = img.naturalWidth; a.ih = img.naturalHeight;
              if (img.naturalHeight > img.naturalWidth && !(a.rot % 180)) a.rot = 90;
            }
          }
          this.redraw();
        };
        img.src = dataURL;
        this.images.set(name, img);
      }
    }
    setImagesCache(this.images);
  },
  changed() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      // 贴图单独存储，避免每次编辑都序列化几 MB 的 base64
      const { textures, ...rest } = this.project;
      // ① localStorage（内嵌预览环境可能禁用/不持久化）
      try {
        localStorage.setItem('s2dproj_v2', JSON.stringify(rest));
        localStorage.setItem('s2dproj_tex', JSON.stringify(textures));
      } catch (e) {
        console.warn('localStorage 保存失败（可能禁用或超配额），已改用服务端磁盘保存', e);
      }
      // ② 服务端磁盘兜底：内嵌 iframe 刷新后 localStorage 丢失也能恢复
      try {
        fetch('/api/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: rest, textures })
        }).catch(() => {});
      } catch (e) { /* 非本服务打开时忽略 */ }
    }, 300);
    this.renderAll();
  },

  renderAll() {
    renderTree($('tree'), this);
    renderTimeline($('timeline'), this);
    renderInspector($('inspector'), this);
    // 全局色块透明度滑条与工程值同步（加载存档/导入工程后保持一致）
    const qaEl = $('qalpha-slider');
    if (qaEl) {
      const qa = this.project.qalpha == null ? 0.25 : this.project.qalpha;
      qaEl.value = qa;
      $('qalpha-val').textContent = Math.round(qa * 100) + '%';
    }
    this.redraw();
  },
  redraw() {
    const canvas = $('viewport');
    const ctx = canvas.getContext('2d');
    const anim = this.anim();
    samplePoseCache = this.curFrame >= 0 ? samplePose(anim, this.curFrame) : new Map();
    const worlds = computeWorld(this.project, { poseOf: this.poseOfForDraw(), showAttached: true });
    let onionWorlds = null;
    if (this.onion && this.curFrame > 0) {
      const ghost = samplePose(anim, this.curFrame - 1);
      onionWorlds = computeWorld(this.project, {
        poseOf: this.makePoseSampler(ghost, false), showAttached: true
      });
    }
    drawScene(ctx, this.project, {
      worlds, images: this.images, view: this.view,
      selection: this.selection, onionWorlds, showQuads: this.view.showQuads,
      showBones: this.view.showBones, showTex: this.view.showTex
    });    this._lastWorlds = worlds;
    // 缩放显示：绝对百分比 —— 默认 100%（1 单位 = 1 屏幕像素，即 1:1）
    const zoomTxt = `缩放 ${Math.round(this.view.zoom * 100)}%`;
    $('status').textContent = `帧 ${this.curFrame}/${anim.frames - 1} · ${zoomTxt} · ${this.playing ? '播放中' : '已暂停'}`;
  },
  worldsNow() { return this._lastWorlds || computeWorld(this.project, { poseOf: () => ({ x: 0, y: 0, rot: 0, sx: 1, sy: 1 }), showAttached: true }); },

  // 色块 (fromL,fromQ) → (toL,toQ)：同步贴图兜底 scale（视口绘制按框实时适配，此值仅导出兜底用）
  refitAttachments(rigId, boneName, fromL, fromQ, toL, toQ) {
    const rig = this.project.rigs[rigId];
    if (!rig || !fromL || !fromQ) return;
    for (const a of rig.attachments.filter(x => x.bone === boneName)) {
      a.scale = (a.scale || 1) * (toL / fromL);
    }
  },

  selectRig(rigId) { this.curRig = rigId; this.selection = { type: 'none' }; this.changed(); },
  selectBone(rigId, boneId) {
    this.selection = { type: 'bone', rigId, boneId };
    this.curRig = rigId; this.changed();
  },
  selectAtt(rigId, attId) {
    const att = this.project.rigs[rigId].attachments.find(a => a.id === attId);
    if (!att) return;
    const bone = this.project.rigs[rigId].bones.find(b => b.name === att.bone);
    this.selection = { type: 'att', rigId, attId, boneId: bone?.id };
    this.changed();
  },
  selectDock(dockId) { this.selection = { type: 'dock', dockId }; this.changed(); },

  // 修改骨骼挂点（rest.x/y），并同步平移该骨骼在所有动画轨道中的 x/y 关键帧与当前编辑——
  // 关键帧坐标是绝对局部值（不随 rest 联动），不平移会钉死在旧位置导致"骨骼分不开"（2026-10-13）
  setRestPos(rigId, bone, nx, ny) {
    if (!bone) return;
    const dx = Math.round(nx * 10) / 10 - bone.rest.x;
    const dy = Math.round(ny * 10) / 10 - bone.rest.y;
    if (!dx && !dy) return;
    bone.rest.x = Math.round((bone.rest.x + dx) * 10) / 10;
    bone.rest.y = Math.round((bone.rest.y + dy) * 10) / 10;
    const ref = rigId + '/' + bone.name;
    for (const a of this.project.animations) {
      const tr = a.tracks.find(t => t.boneRef === ref);
      if (!tr) continue;
      for (const k of tr.keys) {
        if (k.x != null) k.x = Math.round((k.x + dx) * 10) / 10;
        if (k.y != null) k.y = Math.round((k.y + dy) * 10) / 10;
      }
    }
    const e = this.edits.get(ref);
    if (e) {
      if (e.x != null) e.x = Math.round((e.x + dx) * 10) / 10;
      if (e.y != null) e.y = Math.round((e.y + dy) * 10) / 10;
    }
  },

  // —— 姿态编辑与 K 帧 ——
  editBoneLocal(key, value) {
    const ref = this.selectedBoneRef();
    if (!ref) return;
    const cur = this.editedPoseOf(ref);
    const e = { ...cur };
    e[key] = value;
    // 单独编辑某项时保留其余项
    this.edits.set(ref, e);
    if (this.autoKey) this.writeKey(ref, this.curFrame, e);
  },
  writeKey(ref, f, pose) {
    const anim = this.anim();
    let tr = anim.tracks.find(t => t.boneRef === ref);
    if (!tr) { tr = { boneRef: ref, stepped: true, keys: [] }; anim.tracks.push(tr); }
    const k = { f, x: pose.x, y: pose.y, rot: pose.rot, sx: pose.sx, sy: pose.sy };
    const i = tr.keys.findIndex(x => x.f === f);
    if (i >= 0) tr.keys[i] = k; else { tr.keys.push(k); tr.keys.sort((a, b) => a.f - b.f); }
  },
  keyAllBones() {
    this.pushHistory();
    const refs = new Set();
    for (const rigId of Object.keys(this.project.rigs)) {
      for (const b of this.project.rigs[rigId].bones) refs.add(rigId + '/' + b.name);
    }
    for (const ref of refs) this.writeKey(ref, this.curFrame, this.editedPoseOf(ref));
    this.changed();
  },
  copyPrevFrame() {
    this.pushHistory();
    const anim = this.anim();
    const f = this.curFrame;
    if (f === 0) { alert('已在第 0 帧'); return; }
    const prev = samplePose(anim, f - 1);
    const refs = new Set(prev.keys());
    for (const rigId of Object.keys(this.project.rigs)) {
      for (const b of this.project.rigs[rigId].bones) refs.add(rigId + '/' + b.name);
    }
    for (const ref of refs) {
      const pose = this.editedPoseOf(ref); // 当前帧姿态
      const target = prev.get(ref) ? { ...prev.get(ref) } : { ...pose };
      // 用上一帧姿态覆盖，其余维度保留当前
      const merged = { ...pose, ...target };
      this.writeKey(ref, f, merged);
    }
    this.edits.clear();
    this.changed();
  },
  deleteKey(ref, f) {
    if (!ref || f == null) return;
    this.pushHistory();
    const anim = this.anim();
    const tr = anim.tracks.find(t => t.boneRef === ref);
    if (tr) {
      tr.keys = tr.keys.filter(k => k.f !== f);
      if (!tr.keys.length) anim.tracks = anim.tracks.filter(t => t !== tr);
    }
    this.changed();
  },
  setFrame(f) {
    this.curFrame = Math.max(0, Math.min(this.anim().frames - 1, f));
    this.edits.clear();
    this.renderAll();
  },

  // —— 动画管理 ——
  newAnimation() {
    this.pushHistory();
    const name = prompt('动画名称:', 'anim' + (this.project.animations.length + 1));
    if (!name) return;
    this.project.animations.push({ id: 'a' + Date.now(), name, fps: this.project.settings.fps, frames: this.project.settings.frames, loop: false, tracks: [] });
    this.curAnim = this.project.animations.length - 1;
    this.setFrame(0);
  },
  deleteAnimation() {
    if (this.project.animations.length <= 1) return;
    this.pushHistory();
    this.project.animations.splice(this.curAnim, 1);
    this.curAnim = 0; this.setFrame(0);
  },

  // —— 导出 ——
  // 渲染某帧为透明背景离屏 canvas（按所见状态：骨骼/色块/贴图开关 + 单张贴图显隐）
  renderFrameCanvas(frameIdx, maxSide = 2048) {
    const anim = this.anim();
    const cache = frameIdx >= 0 ? samplePose(anim, frameIdx) : new Map();
    const worlds = computeWorld(this.project, { poseOf: this.makePoseSampler(cache, false), showAttached: true });
    // 收集可见内容的世界坐标包围盒（色块/骨骼线/贴图，与视口同一套绘制要素）
    const pts = [];
    const push = (m, x, y) => { const p = matApply(m, { x, y }); pts.push(p.x, p.y); };
    for (const [, w] of worlds) {
      const rig = this.project.rigs[w.rigId];
      const L = w.bone.length || 0, qw = Math.max(4, w.bone.qw || 16);
      if (this.view.showQuads) {
        for (const [cx, cy] of [[0, -qw / 2], [L, -qw / 2], [L, qw / 2], [0, qw / 2]]) push(w.mat, cx, cy);
      } else if (this.view.showBones) {
        push(w.mat, 0, 0); push(w.mat, L, 0);
      }
      if (this.view.showTex) {
        for (const a of rig.attachments.filter(x => x.bone === w.bone.name && x.visible !== false)) {
          const nw = a.iw || 0, nh = a.ih || 0;
          if (!nw || !nh) continue;
          // 贴图拉伸铺满骨骼框（与视口同一公式）：旋转≈90° 时宽高映射轴互换
          const swap = Math.abs((((a.rot || 0) % 180) + 180) % 180 - 90) < 45;
          const sx = Math.max(0.001, swap ? qw / nw : L / nw);
          const sy = Math.max(0.001, swap ? L / nh : qw / nh);
          const m = matMul(w.mat, matTRS(L / 2, 0, a.rot || 0, sx, sy));
          for (const [cx, cy] of [[-nw / 2, -nh / 2], [nw / 2, -nh / 2], [nw / 2, nh / 2], [-nw / 2, nh / 2]]) push(m, cx, cy);
        }
      }
    }
    if (!pts.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < minX) minX = pts[i]; if (pts[i] > maxX) maxX = pts[i];
      if (pts[i + 1] < minY) minY = pts[i + 1]; if (pts[i + 1] > maxY) maxY = pts[i + 1];
    }
    const pad = 12;
    let scale = this.view.zoom;
    const bw = (maxX - minX) * scale, bh = (maxY - minY) * scale;
    if (Math.max(bw, bh) > maxSide) scale *= maxSide / Math.max(bw, bh); // 超大画布限宽
    const cw = Math.max(1, Math.ceil((maxX - minX) * scale)) + pad * 2;
    const ch = Math.max(1, Math.ceil((maxY - minY) * scale)) + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    drawScene(ctx, this.project, {
      worlds, images: this.images,
      view: { zoom: scale, panX: -minX * scale + pad, panY: -minY * scale + pad },
      selection: null, onionWorlds: null, clean: true,
      showQuads: this.view.showQuads, showBones: this.view.showBones, showTex: this.view.showTex
    });
    return canvas;
  },
  downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  safeAnimName() {
    return (this.anim().name || 'anim').replace(/[\\/:*?"<>|]/g, '_');
  },
  // 导出当前帧透明 PNG
  exportFramePng() {
    const canvas = this.renderFrameCanvas(this.curFrame);
    if (!canvas) { alert('当前显示状态下没有可见内容'); return; }
    canvas.toBlob((blob) => {
      this.downloadBlob(blob, `${this.safeAnimName()}_frame${String(this.curFrame).padStart(3, '0')}.png`);
    }, 'image/png');
  },
  // 姿势快捷预设：把当前动画覆盖为预设动作（关键帧相位连续，首尾帧完美循环）
  applyPosePreset(key) {
    const preset = POSE_PRESETS[key];
    if (!preset) return;
    this.pushHistory();
    const anim = this.anim();
    anim.frames = preset.frames;
    anim.fps = preset.fps;
    anim.loop = preset.loop !== false; // 死亡等一次性动作可声明不循环
    anim.name = preset.id;
    anim.tracks = preset.buildTracks(this.project);
    // 武器策略：仅攻击预设显示武器并挂接右手；其余预设隐藏分离摆放的武器（避免混入导出画面）
    const useWeapon = preset.weapon === true;
    this.project.rigs.weapon.visible = useWeapon;
    const dock = (this.project.docks || []).find(d => d.guestRig === 'weapon');
    if (dock) dock.attached = useWeapon;
    this.edits.clear();
    this.curFrame = 0;
    this.changed();
  },
  // 导出全部帧为单张 PNG 网格图（行列自定义，每格内容居中，透明背景）
  async exportSpriteSheet() {
    const anim = this.anim();
    const n = anim.frames;
    const cols = Math.max(1, Math.min(n, parseInt($('sheet-cols').value, 10) || 1));
    const rows = Math.max(1, Math.min(n, parseInt($('sheet-rows').value, 10) || 1));
    if (cols * rows < n) {
      alert(`行列格数不够：${cols} × ${rows} = ${cols * rows} 格 < 帧数 ${n}，请调大行列`);
      return;
    }
    const cells = [];
    for (let i = 0; i < n; i++) {
      const canvas = this.renderFrameCanvas(i);
      if (!canvas) break;
      cells.push(canvas);
    }
    if (!cells.length) { alert('当前显示状态下没有可见内容'); return; }
    if (cells.length < n) { alert(`第 ${cells.length} 帧（0 起）没有可见内容，只导出前 ${cells.length} 帧`); return; }
    const cw = Math.max(...cells.map(c => c.width));
    const ch = Math.max(...cells.map(c => c.height));
    if (cols * cw > 16384 || rows * ch > 16384) {
      alert(`整图尺寸 ${cols * cw}×${rows * ch} 超出浏览器上限（16384），请减小行列数或缩放比例`);
      return;
    }
    const sheet = document.createElement('canvas');
    sheet.width = cols * cw; sheet.height = rows * ch;
    const ctx = sheet.getContext('2d');
    cells.forEach((c, i) => {
      const gx = (i % cols) * cw + Math.floor((cw - c.width) / 2);
      const gy = Math.floor(i / cols) * ch + Math.floor((ch - c.height) / 2);
      ctx.drawImage(c, gx, gy);
    });
    sheet.toBlob((blob) => {
      this.downloadBlob(blob, `${this.safeAnimName()}_序列图_${rows}x${cols}.png`);
    }, 'image/png');
  },
  // 导出 GIF 动图（全部帧，透明背景）
  async exportGif() {
    const anim = this.anim();
    const frames = [];
    for (let i = 0; i < anim.frames; i++) {
      const canvas = this.renderFrameCanvas(i);
      if (!canvas) break;
      const ctx = canvas.getContext('2d');
      frames.push({
        rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        w: canvas.width, h: canvas.height,
        delayCs: Math.max(2, Math.round(100 / Math.max(1, anim.fps)))
      });
    }
    if (!frames.length) { alert('当前显示状态下没有可见内容'); return; }
    const gif = encodeGif(frames, { transparent: true });
    this.downloadBlob(new Blob([gif], { type: 'image/gif' }), `${this.safeAnimName()}.gif`);
  },
  doExport() {
    const { zip, warnings, meta, fileCount } = exportProject(this.project, this.exportMode);
    const warnEl = $('export-warn');
    warnEl.innerHTML = warnings.length
      ? warnings.map(w => `<div class="warn">⚠ ${w}</div>`).join('')
      : `<div class="ok">✓ 导出 ${fileCount} 个文件，无警告</div>`;
    const blob = new Blob([zip], { type: 'application/zip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `godot-export-${this.exportMode}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  saveProjectFile() {
    const blob = new Blob([textBytes(JSON.stringify(this.project))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'project.skelproj.json';
    a.click();
    URL.revokeObjectURL(a.href);
  },
  loadProjectFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = () => {
      const r = new FileReader();
      r.onload = () => {
        try {
          this.pushHistory();
          this.project = JSON.parse(r.result);
          this.postLoad(); this.changed();
        } catch (e) { alert('工程文件无效: ' + e.message); }
      };
      r.readAsText(inp.files[0]);
    };
    inp.click();
  }
};

let samplePoseCache = new Map();

// 读取图片文件：降采样到 ≤1024px 再存 dataURL（避免大图卡死保存/历史）
function readImageFile(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale >= 1) { cb(r.result); return; }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/png'));
    };
    img.onerror = () => alert('图片无法解析: ' + file.name);
    img.src = r.result;
  };
  r.readAsDataURL(file);
}

// —— 初始化 ——
// 全局报错提示（避免静默白屏/卡死无提示）
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;max-width:70%;background:#5b1d1d;color:#ffd9d9;font:12px/1.5 monospace;padding:8px 12px;border-radius:6px;';
    el.textContent = '页面错误: ' + (ev.message || ev.error || 'unknown');
    document.body && document.body.appendChild(el);
  });
}

// 安全模式：?reset=1 清空所有存档后以默认工程打开
async function safeModeReset() {
  try { localStorage.removeItem('s2dproj_v2'); localStorage.removeItem('s2dproj_tex'); } catch (e) {}
  try { await fetch('/api/clear', { method: 'POST' }); } catch (e) {}
  console.info('安全模式：已清空 localStorage 与服务端存档');
  return false; // 不加载任何存档
}

async function loadFromServerFallback() {
  // localStorage 没有工程时（内嵌预览不持久化/超配额），从本机服务端磁盘恢复
  try {
    const r = await fetch('/api/load', { cache: 'no-store' });
    if (!r.ok) return false;
    const d = await r.json();
    if (d && d.project && d.project.rigs && (d.project.rigs.humanoid || d.project.rigs.hero)) {
      d.project.textures = d.textures || {};
      app.project = d.project;
      return true;
    }
  } catch (e) { /* 非本服务打开时忽略 */ }
  return false;
}

function init() {
  // 界面显示当前版本号（与模块链 ?v= 同步 bump，用于排查浏览器缓存/旧页面）
  try {
    const m = (document.querySelector('script[src*="main.js"]')?.src || '').match(/v=([\w-]+)/);
    const ver = m ? m[1] : 'dev';
    const av = $('appver');
    if (av) av.textContent = ver;
    window.APP_VERSION = ver;
  } catch (e) {}
  const safeMode = typeof location !== 'undefined' && location.search.includes('reset=1');
  let saved = null, savedTex = null;
  if (safeMode) {
    safeModeReset();
  } else {
    try {
      saved = localStorage.getItem('s2dproj_v2');
      savedTex = localStorage.getItem('s2dproj_tex');
    } catch (e) { /* 预览环境可能禁用 localStorage */ }
  }
  let loaded = false;
  if (saved) {
    try {
      app.project = JSON.parse(saved);
      if (savedTex) app.project.textures = JSON.parse(savedTex);
      if (!app.project.textures) app.project.textures = {};
      loaded = !!app.project.rigs;
    } catch (e) { app.project = null; }
  }
  if (!loaded) {
    // 同步先给默认工程，随后异步尝试从服务端磁盘恢复（安全模式跳过恢复）
    app.project = newProject();
    if (!safeMode) {
      loadFromServerFallback().then((ok) => {
        if (ok) { app.postLoad(); app.changed(); console.info('已从服务端磁盘恢复工程'); }
      });
    }
  }
  app.postLoad();
  $('chk-dual').checked = !!app.project.dualWeapon;

  const canvas = $('viewport');
  const fit = () => {
    const r = canvas.parentElement.getBoundingClientRect();
    canvas.width = r.width; canvas.height = r.height;
    app.redraw();
  };
  new ResizeObserver(fit).observe(canvas.parentElement);
  fit();

  // 视口交互
  let drag = null;
  const worldPt = (ev) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - app.view.panX) / app.view.zoom,
      y: (ev.clientY - r.top - app.view.panY) / app.view.zoom
    };
  };
  // 缩放 UI：绝对百分比，滑条范围 20% ~ 1000%，默认 300%（默认大小）
  const zSlider = $('zoom-slider'), zVal = $('zoom-val');
  const syncZoomUI = () => {
    const pct = Math.round(app.view.zoom * 100);
    zSlider.value = String(pct);
    zVal.textContent = pct + '%';
  };
  const zoomAt = (mx, my, nz) => {
    const old = app.view.zoom;
    if (nz === old) { syncZoomUI(); return; }
    app.view.panX = mx - (mx - app.view.panX) * nz / old;
    app.view.panY = my - (my - app.view.panY) * nz / old;
    app.view.zoom = nz;
    app.redraw(); syncZoomUI();
  };
  const clampZoom = (z) => Math.max(0.2, Math.min(10, z));
  zSlider.oninput = () => {
    const r = canvas.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, clampZoom(parseFloat(zSlider.value) / 100));
  };
  syncZoomUI();
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const old = app.view.zoom;
    const nz = clampZoom(old * (ev.deltaY < 0 ? 1.1 : 0.9));
    zoomAt(mx, my, nz);
  }, { passive: false });
  canvas.addEventListener('mousedown', (ev) => {
    if (ev.button === 2 || ev.button === 1) {
      drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, px: app.view.panX, py: app.view.panY };
      return;
    }
    const wp = worldPt(ev);
    const hit = hitTest(app.project, app.worldsNow(), wp, app.view.zoom, app.selection);
    if (!hit) { app.selection = { type: 'anim' }; app.changed(); return; }
    if (hit.type === 'handle') {
      // 色块角点：只调大小，不改变选中
      const w0 = app.worldsNow().get(hit.ref);
      drag = { kind: 'handle', ref: hit.ref, corner: hit.corner, mat: w0.mat };
      const [rigId, boneName] = hit.ref.split('/');
      const b0 = app.project.rigs[rigId].bones.find(b => b.name === boneName);
      drag.startLen = b0.length; drag.startQw = b0.qw;
      return;
    }
    app.selectBone(hit.ref.split('/')[0], app.project.rigs[hit.ref.split('/')[0]].bones.find(b => b.name === hit.ref.split('/')[1]).id);
    const worlds = app.worldsNow();
    const w = worlds.get(hit.ref);
    drag = { kind: hit.type, ref: hit.ref, startWp: wp, startPose: app.editedPoseOf(hit.ref) };
    if (hit.type === 'bone') {
      drag.parentMat = w.parentMat;
      drag.startLocal = { x: w.local.e, y: w.local.f, rot: Math.atan2(w.local.b, w.local.a) * 180 / Math.PI };
      if (hit.part === 'joint' && ev.ctrlKey) {
        drag.kind = 'restmove'; // Ctrl+拖灰点 = 改骨架挂点（rest），区别于普通拖动（当前帧姿态）
      } else {
        // 关节点=改位置，骨骼条=改角度（按住 Shift 反过来）
        drag.mode = (hit.part === 'joint') !== ev.shiftKey ? 'move' : 'rotate';
      }
    }
  });
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      app.view.panX = drag.px + ev.clientX - drag.sx;
      app.view.panY = drag.py + ev.clientY - drag.sy;
      app.redraw(); return;
    }
    const wp = worldPt(ev);
    if (drag.kind === 'restmove') {
      // Ctrl 拖灰点：把骨骼挂点（rest）拖到鼠标处（父骨骼局部坐标），同步平移关键帧
      const [rigId, boneName] = drag.ref.split('/');
      const bone = app.project.rigs[rigId].bones.find(b => b.name === boneName);
      if (bone) {
        const local = matApply(matInvert(drag.parentMat), wp);
        app.setRestPos(rigId, bone, local.x, local.y);
        app.redraw(); renderInspector($('inspector'), app);
      }
      return;
    }
    if (drag.kind === 'handle') {
      // 角点拖拽 → 调骨骼长/色块宽（骨骼局部空间），并强制缩放框内贴图
      const ref = drag.ref;
      const rigId = ref.split('/')[0];
      const bone = app.project.rigs[rigId].bones.find(b => b.name === ref.split('/')[1]);
      if (!bone) return;
      const local = matApply(matInvert(drag.mat), wp);
      const newL = Math.max(4, Math.round(local.x * 10) / 10);
      const newQ = Math.max(4, Math.round(Math.abs(local.y) * 2 * 10) / 10);
      if (newL !== drag.startLen || newQ !== drag.startQw) {
        app.refitAttachments(rigId, bone.name, drag.startLen, drag.startQw, newL, newQ);
        bone.length = newL; bone.qw = newQ;
        drag.startLen = newL; drag.startQw = newQ;
      }
      app.redraw();
      return;
    }
    if (drag.kind === 'bone') {
      const ref = drag.ref;
      const inv = matInvert(drag.parentMat);
      const local = matApply(inv, wp);
      const e = { ...drag.startPose };
      if (drag.mode === 'move') {
        e.x = Math.round(local.x * 10) / 10; e.y = Math.round(local.y * 10) / 10;
      } else {
        const pa = Math.atan2(drag.parentMat.b, drag.parentMat.a) * 180 / Math.PI;
        const wa = Math.atan2(wp.y - drag.parentMat.f, wp.x - drag.parentMat.e) * 180 / Math.PI;
        e.rot = Math.round((wa - pa) * 10) / 10;
      }
      app.edits.set(ref, e);
      if (app.autoKey) app.writeKey(ref, app.curFrame, e);
      app.redraw(); renderInspector($('inspector'), app);
    }
  });
  window.addEventListener('mouseup', () => {
    if (drag && drag.kind !== 'pan') app.changed();
    drag = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 工具栏
  $('btn-undo').onclick = () => app.undo();
  $('btn-redo').onclick = () => app.redo();
  $('btn-tex').onclick = () => $('file-tex').click();
  $('file-tex').onchange = () => {
    for (const f of $('file-tex').files) {
      readImageFile(f, (dataURL) => {
        app.project.textures[f.name] = dataURL;
        app.ensureImages(); app.changed();
      });
    }
    $('file-tex').value = '';
  };
  $('btn-quads').onclick = () => {
    app.view.showQuads = !app.view.showQuads;
    $('btn-quads').textContent = app.view.showQuads ? '色块:开' : '色块:关';
    app.redraw();
  };
  // 色块透明度：全局统一（project.qalpha，全部色块一起调整）
  const syncQaSlider = () => {
    const qa = app.project.qalpha == null ? 0.25 : app.project.qalpha;
    $('qalpha-slider').value = qa;
    $('qalpha-val').textContent = Math.round(qa * 100) + '%';
  };
  syncQaSlider();
  $('qalpha-slider').oninput = (e) => {
    app.project.qalpha = Math.max(0, Math.min(1, +e.target.value));
    $('qalpha-val').textContent = Math.round(app.project.qalpha * 100) + '%';
    app.redraw();
  };
  $('qalpha-slider').onchange = () => app.changed(); // 松手才入历史+存档
  // 骨骼/贴图显示开关（导出帧图/GIF 按所见状态）
  $('btn-bones').onclick = () => {
    app.view.showBones = !app.view.showBones;
    $('btn-bones').textContent = app.view.showBones ? '骨骼:开' : '骨骼:关';
    app.changed();
  };
  $('btn-texvis').onclick = () => {
    app.view.showTex = !app.view.showTex;
    $('btn-texvis').textContent = app.view.showTex ? '贴图:开' : '贴图:关';
    app.changed();
  };
  // 单/双武器切换：开启=启用第二把武器（左手 Dock）
  $('chk-dual').onchange = () => {
    app.pushHistory();
    app.project.dualWeapon = $('chk-dual').checked;
    app.project.rigs.weapon2.visible = $('chk-dual').checked;
    app.changed();
  };
  // 姿势快捷预设下拉（应用后复位选择，便于再次选择）
  const poseSel = $('pose-preset');
  for (const [key, p] of Object.entries(POSE_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.name;
    poseSel.appendChild(opt);
  }
  poseSel.onchange = () => {
    if (!poseSel.value) return;
    app.applyPosePreset(poseSel.value);
    poseSel.value = '';
  };
  $('btn-reset').onclick = () => {
    if (confirm('重置为默认工程？未导出的工作将丢失。')) {
      try { localStorage.removeItem('s2dproj_v2'); localStorage.removeItem('s2dproj_tex'); } catch (e) {}
      try { fetch('/api/clear', { method: 'POST' }).catch(() => {}); } catch (e) {}
      app.project = newProject();
      app.images.clear();
      app.postLoad(); app.changed();
    }
  };
  // 播放控制
  $('btn-play').onclick = () => { app.playing = !app.playing; app.redraw(); };
  $('btn-stop').onclick = () => { app.playing = false; app.setFrame(0); };
  $('btn-prev').onclick = () => { app.setFrame(app.curFrame - 1); };
  $('btn-next').onclick = () => { app.setFrame(app.curFrame + 1); };

  // 播放循环
  let lastT = 0, acc = 0;
  function loop(t) {
    if (app.playing && app.anim()) {
      const dt = t - lastT;
      acc += dt;
      const frameMs = 1000 / app.anim().fps;
      while (acc >= frameMs) {
        acc -= frameMs;
        let f = app.curFrame + 1;
        if (f >= app.anim().frames) f = app.anim().loop ? 0 : app.anim().frames - 1;
        app.curFrame = f;
      }
      app.edits.clear();
      app.redraw();
      if (app.curFrame !== app._lastPlayedFrame) {
        app._lastPlayedFrame = app.curFrame;
        renderTimeline($('timeline'), app);
      }
    }
    lastT = t;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 快捷键
  window.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); app.undo(); }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'y' || (ev.shiftKey && ev.key === 'Z'))) { ev.preventDefault(); app.redo(); }
    if (ev.key === ' ') { ev.preventDefault(); $('btn-play').click(); }
    if (ev.key === 'ArrowLeft') app.setFrame(app.curFrame - 1);
    if (ev.key === 'ArrowRight') app.setFrame(app.curFrame + 1);
  });

  app.changed();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.app = app;  // 控制台调试用
}
export { app };
