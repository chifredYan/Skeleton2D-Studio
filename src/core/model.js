// core/model.js — 数据模型与模板（DOM-free，可在 Node 中复用）
let _id = 1;
export function newId(prefix = 'b') { return prefix + (_id++); }
export function resetIds() { _id = 1; }

export function matIdentity() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
// 本地矩阵 = 平移·旋转·缩放（rot 单位：度）
export function matTRS(x, y, rotDeg, sx = 1, sy = 1) {
  const r = rotDeg * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
  return { a: co * sx, b: si * sx, c: -si * sy, d: co * sy, e: x, f: y };
}
export function matMul(m, n) {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f
  };
}
export function matApply(m, p) { return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; }
export function matInvert(m) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-9) return matIdentity();
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, e: -(ia * m.e + ic * m.f), f: -(ib * m.e + id * m.f) };
}

export function mkBone(name, parent, x, y, len) {
  return { id: newId('b'), name, parent, length: len, qw: Math.max(10, Math.round(len * 0.55)), rest: { x, y, rot: 0 } };
}

// 旧工程补齐色块宽度 / 附件透明度字段
export function ensureQuads(project) {
  for (const rig of Object.values(project.rigs)) {
    for (const b of rig.bones) {
      if (b.qw == null) b.qw = Math.max(10, Math.round((b.length || 10) * 0.55));
    }
    for (const a of rig.attachments) {
      if (a.alpha == null) a.alpha = 1;
    }
  }
}

// 正面 T-pose 人形模板（15 骨）—— 2026-10-13 起默认尺寸 ×5（关节 rest 偏移同步 ×5，连接点比例不变）
// 层级：LowerBody(下身,根,腰→下) → UpperBody(上身,向上) → Head/手臂×2
//       双腿挂在下身最末端节点（下身尖端），不在上身
export function makeHumanoid(id = 'humanoid') {
  const B = (n, p, x, y, rot, l) => { const b = mkBone(n, p, x, y, l); b.rest.rot = rot; return b; };
  const lowerBody = B('LowerBody', null, 0, 0, 90, 100);           // 下身（根，腰部指向下）
  const upperBody = B('UpperBody', lowerBody.id, 0, 0, -180, 140); // 上身（从腰向上）
  const head = B('Head', upperBody.id, 140, 0, 0, 100);            // 头（无脖子）
  // 右臂（画面右侧，指向 +x）
  const uaR = B('UpperArmR', upperBody.id, 100, 70, 90, 100);
  const faR = B('ForeArmR', uaR.id, 100, 0, 0, 90);
  const handR = B('HandR', faR.id, 90, 0, 0, 40);
  // 左臂（指向 -x）
  const uaL = B('UpperArmL', upperBody.id, 100, -70, -90, 100);
  const faL = B('ForeArmL', uaL.id, 100, 0, 0, 90);
  const handL = B('HandL', faL.id, 90, 0, 0, 40);
  // 双腿：挂在下身末端（局部 (100,±25)），向下
  const ulR = B('UpperLegR', lowerBody.id, 100, -25, 0, 120);
  const llR = B('LowerLegR', ulR.id, 120, 0, 0, 110);
  const footR = B('FootR', llR.id, 110, 0, -90, 50);
  const ulL = B('UpperLegL', lowerBody.id, 100, 25, 0, 120);
  const llL = B('LowerLegL', ulL.id, 120, 0, 0, 110);
  const footL = B('FootL', llL.id, 110, 0, -90, 50);
  return {
    id, type: 'humanoid',
    bones: [lowerBody, upperBody, head, uaR, faR, handR, uaL, faL, handL, ulR, llR, footR, ulL, llL, footL],
    attachments: []
  };
}

// 武器模板：单段 Grip（一根骨骼即整把武器）；默认摆放在人物旁边（分离状态可见）
// 尺寸与人形模板同比例（×5）：len 60→300、qw 14→70
export function makeWeapon(id = 'weapon', ox = 550, oy = -100) {
  const grip = mkBone('Grip', null, ox, oy, 300);
  grip.qw = 70; // 剑形比例：细长（默认 0.55*300=165 太宽，视觉像厚板）
  return { id, type: 'weapon', visible: true, bones: [grip], attachments: [] };
}

export function newProject() {
  resetIds();
  const rigs = {
    humanoid: makeHumanoid('humanoid'),
    weapon: makeWeapon('weapon', 550, -100),
    weapon2: makeWeapon('weapon2', 550, 200)
  };
  rigs.weapon2.visible = false; // 默认单武器
  const animId = newId('a');
  return {
    version: 1,
    settings: { fps: 12, frames: 24 },
    dualWeapon: false,       // 单/双武器切换
    textures: {},            // name -> dataURL
    rigs,
    docks: [{
      id: newId('d'), hostRig: 'humanoid', hostBone: 'HandR',
      guestRig: 'weapon', guestBone: 'Grip',
      x: 0, y: 0, rot: 0, attached: false  // 默认分离：武器独立，便于御剑/飞剑效果
    }, {
      id: newId('d'), hostRig: 'humanoid', hostBone: 'HandL',
      guestRig: 'weapon2', guestBone: 'Grip',
      x: 0, y: 0, rot: 0, attached: false
    }],
    animations: [{ id: animId, name: 'idle', fps: 12, frames: 24, loop: true, tracks: [] }]
  };
}

// 旧工程 rig 改名：hero→humanoid、sword→weapon、sword2→weapon2（含 docks/动画轨道引用）
export function renameLegacyRigs(project) {
  if (project.rigNamesV2) return;
  const map = { hero: 'humanoid', sword: 'weapon', sword2: 'weapon2' };
  const newRigs = {};
  for (const [id, rig] of Object.entries(project.rigs || {})) {
    rig.id = map[id] || id;
    newRigs[rig.id] = rig;
  }
  project.rigs = newRigs;
  for (const d of project.docks || []) {
    d.hostRig = map[d.hostRig] || d.hostRig;
    d.guestRig = map[d.guestRig] || d.guestRig;
  }
  for (const anim of project.animations || []) {
    for (const tr of anim.tracks || []) {
      const slash = tr.boneRef.indexOf('/');
      if (slash > 0) {
        const rid = tr.boneRef.slice(0, slash);
        tr.boneRef = (map[rid] || rid) + tr.boneRef.slice(slash);
      }
    }
  }
  project.rigNamesV2 = true;
}

// 旧工程补第二把武器（默认隐藏）+ 双武器 Dock
export function ensureWeapon2(project) {
  renameLegacyRigs(project);
  // 旧版两段武器（Grip→Blade）合并为单段 Grip
  for (const rig of Object.values(project.rigs)) {
    if (rig.type !== 'weapon') continue;
    const blade = (rig.bones || []).find(b => b.name === 'Blade');
    if (blade) {
      const grip = rig.bones.find(b => b.name === 'Grip');
      if (grip) {
        grip.length = (grip.length || 0) + (blade.length || 0);
        for (const a of rig.attachments || []) if (a.bone === 'Blade') a.bone = 'Grip';
      }
      rig.bones = rig.bones.filter(b => b.name !== 'Blade');
    }
  }
  // 对接偏移/旋转已废弃（挂接=武器根直接落在手骨原点）
  for (const d of project.docks || []) { d.x = 0; d.y = 0; d.rot = 0; }
  if (!project.rigs.weapon2) project.rigs.weapon2 = makeWeapon('weapon2', 550, 200);
  if (project.rigs.weapon2.visible == null) project.rigs.weapon2.visible = false;
  if (project.dualWeapon == null) project.dualWeapon = false;
  if (!project.docks.some(d => d.guestRig === 'weapon2')) {
    project.docks.push({
      id: newId('d'), hostRig: 'humanoid', hostBone: 'HandL',
      guestRig: 'weapon2', guestBone: 'Grip',
      x: 0, y: 0, rot: 0, attached: false
    });
  }
  // 旧 rig 补 visible 字段
  for (const rig of Object.values(project.rigs)) {
    if (rig.visible == null) rig.visible = true;
  }
}

// 换父级：保持世界位置（rest 重算到新父空间），拖到哪就跟随哪
// 返回错误信息或 null
export function reparentBone(rig, boneName, newParentName) {
  const byName = new Map(rig.bones.map(b => [b.name, b]));
  const bone = byName.get(boneName);
  if (!bone) return '骨骼不存在';
  if (newParentName === boneName) return '不能拖到自己下面';
  let newParent = null;
  if (newParentName) {
    newParent = byName.get(newParentName);
    if (!newParent) return '目标骨骼不存在';
    // 禁止形成环：新父不能是自己后代
    let cur = newParent;
    while (cur) {
      if (cur.name === boneName) return '不能拖到自己的子孙下面（会成环）';
      cur = cur.parent ? byName.get(rig.bones.find(b => b.id === cur.parent)?.name) : null;
    }
  }
  // 当前 rest 世界矩阵
  const byId = new Map(rig.bones.map(b => [b.id, b]));
  const worldOf = (b) => {
    let m = matIdentity();
    let cur = b;
    while (cur) {
      m = matMul(matTRS(cur.rest.x, cur.rest.y, cur.rest.rot, 1, 1), m);
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    return m;
  };
  const w = worldOf(bone);
  const pw = newParent ? worldOf(newParent) : matIdentity();
  const local = matMul(matInvert(pw), w);
  bone.parent = newParent ? newParent.id : null;
  bone.rest.x = Math.round(local.e * 100) / 100;
  bone.rest.y = Math.round(local.f * 100) / 100;
  bone.rest.rot = Math.round(Math.atan2(local.b, local.a) * 180 / Math.PI * 10) / 10;
  return null;
}

// —— 8 层贴图层级（影响显示顺序，层号越大越靠上；武器1/武器2 分层）——
export const DEFAULT_LAYERS = ['底层(特效)', '腿', '下身', '上身', '手臂', '头', '武器1', '武器2'];

export function defaultLayerOf(boneName, rigType, rigId) {
  if (rigType === 'weapon') return rigId === 'weapon2' ? 7 : 6;
  if (/Head/.test(boneName || '')) return 5;
  if (/Arm|Hand/.test(boneName || '')) return 4;
  if (/Leg|Foot/.test(boneName || '')) return 1;
  if (/LowerBody/.test(boneName || '')) return 2;
  if (/UpperBody/.test(boneName || '')) return 3;
  return 3;
}

// 旧工程补齐 8 层结构与附件 layer 字段（旧 7 层的「顶层(武器)」拆为 武器1/武器2）
export function ensureLayers(project) {
  if (!Array.isArray(project.layers)) {
    project.layers = DEFAULT_LAYERS.slice();
  } else if (project.layers.length === 7) {
    // 旧 7 层迁移：L6「顶层(武器)」拆开 —— weapon→武器1(L6)、weapon2/其它→武器2(L7，保持最上层)
    project.layers = DEFAULT_LAYERS.slice();
    for (const [rigId, rig] of Object.entries(project.rigs)) {
      for (const a of rig.attachments) {
        if (a.layer === 6) a.layer = (rigId === 'weapon') ? 6 : 7;
      }
    }
  } else if (project.layers.length !== 8) {
    project.layers = DEFAULT_LAYERS.slice();
  }
  for (const [rigId, rig] of Object.entries(project.rigs)) {
    for (const a of rig.attachments) {
      if (a.layer == null) a.layer = defaultLayerOf(a.bone, rig.type, rigId);
      if (a.layer > project.layers.length - 1) a.layer = project.layers.length - 1; // 越界兜底
      if (a.visible == null) a.visible = true; // 贴图显隐（导出按所见状态）
    }
  }
}

// 附件的有效显示序：层 ×100 + 层内 z（跨 rig 全局排序）
export function effZ(a) {
  return (a.layer == null ? 3 : a.layer) * 100 + (a.z | 0);
}

export function boneByName(rig, name) { return rig.bones.find(b => b.name === name) || null; }

// 骨骼中文名（树/检查器里括号显示）
export const BONE_CN = {
  LowerBody: '下身', UpperBody: '上身', Head: '头',
  UpperArmR: '右上臂', ForeArmR: '右下臂', HandR: '右手',
  UpperArmL: '左上臂', ForeArmL: '左下臂', HandL: '左手',
  UpperLegR: '右大腿', LowerLegR: '右小腿', FootR: '右脚',
  UpperLegL: '左大腿', LowerLegL: '左小腿', FootL: '左脚',
  Grip: '握把'
};
export function boneCN(name) { return BONE_CN[name] || ''; }
export function boneChildren(rig, parentId) { return rig.bones.filter(b => b.parent === parentId); }
export function boneRoots(rig) { return rig.bones.filter(b => !b.parent); }
export function boneChain(rig, boneId) { // 根→该骨 的名称链
  const byId = new Map(rig.bones.map(b => [b.id, b]));
  const chain = [];
  let cur = byId.get(boneId);
  while (cur) { chain.unshift(cur); cur = cur.parent ? byId.get(cur.parent) : null; }
  return chain;
}
export function getDockFor(docks, guestRigId) { return docks.find(d => d.guestRig === guestRigId) || null; }
export function getDockByHost(docks, hostRig, hostBone) {
  return docks.find(d => d.hostRig === hostRig && d.hostBone === hostBone) || null;
}

// 轨道采样：返回 boneRef -> {x,y,rot,sx,sy}（与 rest 同构，rot 为度）
export function samplePose(anim, frame) {
  const out = new Map();
  for (const tr of anim.tracks) {
    const keys = tr.keys;
    if (!keys.length) continue;
    let v;
    if (frame <= keys[0].f) v = keys[0];
    else if (frame >= keys[keys.length - 1].f) v = keys[keys.length - 1];
    else {
      let i = 0;
      while (i < keys.length - 1 && keys[i + 1].f <= frame) i++;
      const k0 = keys[i], k1 = keys[i + 1];
      if (tr.stepped || k1.f === k0.f) { v = k0; }
      else {
        const t = (frame - k0.f) / (k1.f - k0.f);
        v = {
          f: frame,
          x: k0.x + (k1.x - k0.x) * t, y: k0.y + (k1.y - k0.y) * t,
          rot: k0.rot + (k1.rot - k0.rot) * t,
          sx: k0.sx + (k1.sx - k0.sx) * t, sy: k0.sy + (k1.sy - k0.sy) * t
        };
      }
    }
    out.set(tr.boneRef, { x: v.x, y: v.y, rot: v.rot, sx: v.sx, sy: v.sy });
  }
  return out;
}

// 某帧某骨的有效本地姿态：rest 覆盖 edits 覆盖 sampled
export function localPoseOf(rig, bone, sampled, edits, boneRef) {
  const base = { x: bone.rest.x, y: bone.rest.y, rot: bone.rest.rot, sx: 1, sy: 1 };
  const s = sampled.get(boneRef);
  if (s) Object.assign(base, s);
  const e = edits && edits.get(boneRef);
  if (e) Object.assign(base, e);
  return base;
}
