// render/viewport.js — Canvas 2D 视口：骨骼/贴图绘制、命中测试（DOM-free 的纯计算 + 绘制）
import {
  matIdentity, matTRS, matMul, matApply, matInvert,
  boneRoots, boneChildren, localPoseOf, effZ
} from '../core/model.js?v=20261012y';

const D2R = Math.PI / 180;

// 计算一个 rig 的世界矩阵表（含挂接的武器）
// poseOf(rigId, bone) -> local {x,y,rot,sx,sy}
export function computeWorld(project, opts) {
  const { poseOf, showAttached } = opts;
  const worlds = new Map(); // "rig/boneName" -> {mat, bone, rigId}
  const dockByHost = new Map();
  const mergedAway = new Set();
  for (const d of project.docks) if (d.attached) { dockByHost.set(d.hostRig + '/' + d.hostBone, d); mergedAway.add(d.guestRig); }

  const walkRig = (rig, baseMat) => {
    const walk = (bone, parentMat, dock) => {
      const ref = rig.id + '/' + bone.name;
      const lp = poseOf(rig.id, bone);
      const local = matTRS(lp.x, lp.y, lp.rot, lp.sx, lp.sy);
      const world = matMul(parentMat, local);
      worlds.set(ref, { mat: world, parentMat, bone, rigId: rig.id, dock, local });
      const childDock = dockByHost.get(ref);
      if (childDock && showAttached) {
        const guest = project.rigs[childDock.guestRig];
        if (guest) {
          const dockMat = matMul(world, matTRS(childDock.x, childDock.y, childDock.rot, 1, 1));
          for (const root of boneRoots(guest)) walkGuest(guest, root, dockMat, childDock);
        }
      }
      for (const c of boneChildren(rig, bone.id)) walk(c, world, dock);
    };
    const walkGuest = (rig, bone, parentMat, dock) => {
      const ref = rig.id + '/' + bone.name;
      const lp = poseOf(rig.id, bone);
      const local = matTRS(lp.x, lp.y, lp.rot, lp.sx, lp.sy);
      const world = matMul(parentMat, local);
      worlds.set(ref, { mat: world, parentMat, bone, rigId: rig.id, dock, local });
      for (const c of boneChildren(rig, bone.id)) walkGuest(rig, c, world, dock);
    };
    for (const root of boneRoots(rig)) walk(root, baseMat, null);
  };

  for (const rigId of Object.keys(project.rigs)) {
    const rig = project.rigs[rigId];
    if (rig.visible === false) continue; // 单/双武器切换：隐藏 rig 不绘制
    if (mergedAway.has(rigId)) continue; // 已挂接的武器随宿主绘制，不再按独立位置重算（否则覆盖挂接结果导致不跟手）
    walkRig(rig, matIdentity());
  }
  return worlds;
}

export function drawScene(ctx, project, opts) {
  const { worlds, images, view, selection, onionWorlds } = opts;
  const showQuads = opts.showQuads !== false;
  const showBones = opts.showBones !== false;
  const showTex = opts.showTex !== false;
  const { zoom, panX, panY } = view;
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!opts.clean) {
    // 网格
    ctx.strokeStyle = 'rgba(128,128,128,0.15)';
    ctx.lineWidth = 1;
    const step = 32 * zoom;
    if (step > 8) {
      const ox = ((panX % step) + step) % step, oy = ((panY % step) + step) % step;
      ctx.beginPath();
      for (let x = ox; x < ctx.canvas.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, ctx.canvas.height); }
      for (let y = oy; y < ctx.canvas.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(ctx.canvas.width, y); }
      ctx.stroke();
    }
    // 原点轴
    ctx.strokeStyle = 'rgba(200,80,80,0.5)';
    ctx.beginPath();
    ctx.moveTo(panX, 0); ctx.lineTo(panX, ctx.canvas.height);
    ctx.moveTo(0, panY); ctx.lineTo(ctx.canvas.width, panY);
    ctx.stroke();
  }

  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  // 洋葱皮（幽灵骨架）
  if (onionWorlds) {
    ctx.globalAlpha = 0.25;
    drawBones(ctx, onionWorlds, null, project, { showQuads, showBones, showTex, noHandles: true });
    ctx.globalAlpha = 1;
  }
  drawBones(ctx, worlds, selection, project, { showQuads, showBones, showTex });
  ctx.restore();
}

// 每骨一色：全部骨架的骨骼全局编号，色相均匀分布 → 互不相同
function buildHueMap(project) {
  let total = 0;
  for (const rig of Object.values(project.rigs)) total += rig.bones.length;
  const map = new Map();
  let gi = 0;
  for (const rig of Object.values(project.rigs)) {
    for (const b of rig.bones) map.set(rig.id + '/' + b.name, Math.round(gi++ * 360 / total));
  }
  return map;
}

// 选中态兼容：selection 可能是 {ref:'rig/name'}（hitTest 原始值）或 {rigId,boneId}（selectBone 存储）
// 统一换算成 'rig/boneName' 形式（2026-10-13 修复：真实点击选中后红线条/绿圈不显示——字段不匹配）
function selBoneRef(selection, project) {
  if (!selection || selection.type !== 'bone') return null;
  if (selection.ref) return selection.ref;
  const rig = project.rigs[selection.rigId];
  const bone = rig && rig.bones.find(b => b.id === selection.boneId);
  return bone ? selection.rigId + '/' + bone.name : null;
}

function drawBones(ctx, worlds, selection, project, flags) {
  const showQuads = flags.showQuads !== false;
  const showBones = flags.showBones !== false;
  const showTex = flags.showTex !== false;
  const selRefStr = selBoneRef(selection, project);
  const hueMap = showQuads ? buildHueMap(project) : null;
  // 色块透明度：全局统一（project.qalpha，0~1，缺省 0.25）
  const gQa = Math.max(0, Math.min(1, project.qalpha == null ? 0.25 : project.qalpha));
  // 半透明圆角色块（每骨一色，包裹骨骼段）
  if (showQuads) {
    for (const [ref, w] of worlds) {
      const qw = Math.max(4, w.bone.qw || 16), L = w.bone.length || 0;
      const sel = selRefStr === ref;
      const hue = hueMap.get(ref) || 0;
      const p1 = matApply(w.mat, { x: 0, y: -qw / 2 });
      const p2 = matApply(w.mat, { x: L, y: -qw / 2 });
      const p3 = matApply(w.mat, { x: L, y: qw / 2 });
      const p4 = matApply(w.mat, { x: 0, y: qw / 2 });
      const r = Math.min(8, qw / 2, L / 2); // 圆角半径（骨骼局部单位）
      ctx.fillStyle = `hsla(${hue}, 72%, 55%, ${sel ? Math.min(1, gQa * 1.8) : gQa})`;
      ctx.beginPath();
      // 沿四边圆角（arcTo 在世界坐标下构建，描边宽度保持屏幕像素）
      const seg = (a, b, d) => ({ x: a.x + (b.x - a.x) * d, y: a.y + (b.y - a.y) * d });
      const e12 = seg(p1, p2, r / Math.max(1e-6, Math.hypot(p2.x - p1.x, p2.y - p1.y)));
      const e23 = seg(p2, p3, r / Math.max(1e-6, Math.hypot(p3.x - p2.x, p3.y - p2.y)));
      const e34 = seg(p3, p4, r / Math.max(1e-6, Math.hypot(p4.x - p3.x, p4.y - p3.y)));
      const e41 = seg(p4, p1, r / Math.max(1e-6, Math.hypot(p1.x - p4.x, p1.y - p4.y)));
      ctx.moveTo(e12.x, e12.y);
      ctx.arcTo(p2.x, p2.y, e23.x, e23.y, r);
      ctx.lineTo(e23.x, e23.y);
      ctx.arcTo(p3.x, p3.y, e34.x, e34.y, r);
      ctx.lineTo(e34.x, e34.y);
      ctx.arcTo(p4.x, p4.y, e41.x, e41.y, r);
      ctx.lineTo(e41.x, e41.y);
      ctx.arcTo(p1.x, p1.y, e12.x, e12.y, r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 72%, 48%, ${Math.min(1, sel ? gQa * 3.8 : gQa * 2.2)})`;
      ctx.lineWidth = sel ? 8 : 5; // 色块边框 ×5（2026-10-13，随骨骼 ×5；原 1.6/1）
      ctx.stroke();
    }
  }
  // 贴图（z 排序；全局开关 + 单张贴图隐藏）
  const sprites = [];
  if (showTex) {
    for (const [ref, w] of worlds) {
      const rig = project.rigs[w.rigId];
      for (const att of rig.attachments.filter(a => a.bone === w.bone.name && a.visible !== false)) {
        sprites.push({ att, w, ref, z: att.z });
      }
    }
  }
  sprites.sort((a, b) => effZ(a.att) - effZ(b.att));
  for (const s of sprites) {
    const img = images_cache.get(s.att.tex);
    if (!img || !img.complete || !img.naturalWidth) continue;
    // 贴图强制锁定骨骼框：拉伸铺满（边缘与色块框对齐，非等比拉伸；大小/偏移只随骨骼框变）
    // 旋转≈90° 时图片宽高映射轴互换：宽→骨骼横向、高→骨骼长度方向
    const L = s.w.bone.length || 0, qwb = Math.max(4, s.w.bone.qw || 16);
    const swap = Math.abs((((s.att.rot || 0) % 180) + 180) % 180 - 90) < 45;
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const sx = Math.max(0.001, swap ? qwb / nw : L / nw);
    const sy = Math.max(0.001, swap ? L / nh : qwb / nh);
    const m = matMul(s.w.mat, matTRS(L / 2, 0, s.att.rot, sx, sy));
    ctx.save();
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    if (selection && selection.type === 'att' && selection.attId === s.att.id
      && (selection.ref ? selection.ref === s.ref : selection.rigId === s.w.rigId)) {
      ctx.shadowColor = '#e24b4a'; ctx.shadowBlur = 6 / (ctx.getTransform().a || 1);
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, s.att.alpha == null ? 1 : s.att.alpha));
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }
  // 骨骼线 + 关节（骨骼开关；隐藏时不绘制）
  if (showBones) {
    for (const [ref, w] of worlds) {
      const end = matApply(w.mat, { x: w.bone.length, y: 0 });
      const sel = selRefStr === ref;
      ctx.strokeStyle = sel ? '#ff2d2d' : (w.rigId === 'humanoid' ? '#378add' : '#ba7517'); // 选中骨骼线条=红色
      ctx.lineWidth = (sel ? 6.25 : 3.75); // 骨骼线条 ×5（2026-10-13，随骨骼 ×5；原 1.25/0.75）
      ctx.beginPath();
      ctx.moveTo(w.mat.e, w.mat.f);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // 关节（灰点：拖动=改位置；选中时灰底+绿色描边圈便于辨认）
      ctx.fillStyle = '#888780';
      ctx.beginPath();
      ctx.arc(w.mat.e, w.mat.f, sel ? 12.5 : 8.75, 0, Math.PI * 2); // 灰点 ×5（2026-10-13；原 2.5/1.75）；点击热区仍为 7/zoom 不变
      ctx.fill();
      if (sel) { // 选中骨骼的关节：绿色描边圈
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }
    }
  }
  // 选中骨骼的四个角点手柄（拖动=调色块大小）
  if (selRefStr && showBones && !flags.noHandles) {
    const w = worlds.get(selRefStr);
    if (w) {
      const qw = Math.max(4, w.bone.qw || 16), L = w.bone.length || 0;
      const hs = 3.5 / Math.max(0.4, ctx.getTransform().a || 1);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e24b4a';
      ctx.lineWidth = 1.2;
      for (const [cx, cy] of [[0, -qw / 2], [L, -qw / 2], [L, qw / 2], [0, qw / 2]]) {
        const pt = matApply(w.mat, { x: cx, y: cy });
        ctx.beginPath();
        ctx.rect(pt.x - hs, pt.y - hs, hs * 2, hs * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

// 命中测试：返回 {type:'handle'|'bone'|'att', ref, part?, corner?, attId?} 或 null
export function hitTest(project, worlds, worldPt, zoom, selection) {
  const px = 8 / zoom;
  // 选中骨骼的四边形角点手柄（拖动=调色块大小）
  if (selection && selection.type === 'bone') {
    const w = worlds.get(selBoneRef(selection, project));
    if (w) {
      const qw = Math.max(4, w.bone.qw || 16), L = w.bone.length || 0;
      const corners = [[0, -qw / 2, 0], [L, -qw / 2, 1], [L, qw / 2, 2], [0, qw / 2, 3]];
      for (const [cx, cy, idx] of corners) {
        const pt = matApply(w.mat, { x: cx, y: cy });
        if (Math.hypot(worldPt.x - pt.x, worldPt.y - pt.y) <= 7 / zoom) {
          return { type: 'handle', ref: selBoneRef(selection, project), corner: idx };
        }
      }
    }
  }
  // 贴图不可点击/拖动（锁定骨骼框）——选中贴图请用左侧「贴图层级」面板
  // 关节圆点（拖动=改位置）：优先于骨骼段
  const jr = 7 / zoom;
  let bestJ = null, bestJD = Infinity;
  for (const [ref, w] of worlds) {
    const d = Math.hypot(worldPt.x - w.mat.e, worldPt.y - w.mat.f);
    if (d < bestJD) { bestJD = d; bestJ = ref; }
  }
  if (bestJ && bestJD <= jr) {
    return { type: 'bone', ref: bestJ, part: 'joint' };
  }
  // 色块内任意位置 = 选中该骨骼（取包含点的面积最小的框；拖动=改角度）
  let bestQ = null, bestQA = Infinity;
  for (const [ref, w] of worlds) {
    const lp = matApply(matInvert(w.mat), worldPt);
    const L = w.bone.length || 0, q = Math.max(4, w.bone.qw || 16);
    if (lp.x >= -px && lp.x <= L + px && Math.abs(lp.y) <= q / 2 + px) {
      const area = (L + 2 * px) * (q + 2 * px);
      if (area < bestQA) { bestQA = area; bestQ = ref; }
    }
  }
  if (bestQ) {
    return { type: 'bone', ref: bestQ, part: 'bar' };
  }
  // 兜底：骨骼线段近距离（拖动=改角度）
  let best = null, bestD = Infinity;
  for (const [ref, w] of worlds) {
    const a = { x: w.mat.e, y: w.mat.f };
    const b = matApply(w.mat, { x: w.bone.length, y: 0 });
    const d = distToSeg(worldPt, a, b);
    if (d < bestD) { bestD = d; best = ref; }
  }
  if (best && bestD <= Math.max(px, 6 / zoom)) {
    return { type: 'bone', ref: best, part: 'bar' };
  }
  return null;
}

// 供 hitTest 使用的图片缓存注入
let images_cache = new Map();
export function setImagesCache(m) { images_cache = m; }
function images_get(cache, name) { return cache.get(name); }

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + dx * t, cy = a.y + dy * t;
  return Math.hypot(p.x - cx, p.y - cy);
}
