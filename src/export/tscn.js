// export/tscn.js — 生成 Godot 4.x .tscn 场景（DOM-free）
import { boneChain, boneRoots, boneChildren, getDockFor, effZ } from '../core/model.js?v=20261018a';

const fmtF = (n) => {
  if (!isFinite(n)) n = 0;
  let s = (Math.round(n * 1e6) / 1e6).toString();
  if (!s.includes('.') && !s.includes('e') && !s.includes('E')) s += '.0';
  return s;
};
const V2 = (x, y) => `Vector2(${fmtF(x)}, ${fmtF(y)})`;
const T2D = (x, y, rotDeg) => {
  const r = rotDeg * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
  return `Transform2D(${fmtF(co)}, ${fmtF(si)}, ${fmtF(-si)}, ${fmtF(co)}, ${fmtF(x)}, ${fmtF(y)})`;
};
const sanitize = (s) => String(s).replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '_');
const safeTexFile = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_');

// dock 变换（武器根骨挂接到手骨时的本地变换）；动画键值需叠加 dock
function dockComposeKey(dock, key) {
  return {
    x: dock.x + Math.cos(dock.rot * Math.PI / 180) * key.x - Math.sin(dock.rot * Math.PI / 180) * key.y,
    y: dock.y + Math.sin(dock.rot * Math.PI / 180) * key.x + Math.cos(dock.rot * Math.PI / 180) * key.y,
    rot: dock.rot + key.rot
  };
}

// 收集一个场景内的所有骨（含合并进来的武器骨）
// 返回 [{rigId, bone, nodePath, base:{x,y,rot}, isGuestRoot, dock}]
function collectBones(project, rig, merges) {
  const out = [];
  const byId = new Map(rig.bones.map(b => [b.id, b]));
  const walk = (bone, parentPath, baseOverride, isGuestRoot, dock) => {
    const name = sanitize(bone.name);
    const nodePath = parentPath ? parentPath + '/' + name : name;
    const rest = baseOverride || bone.rest;
    out.push({ rigId: rig.id, bone, nodePath, base: { x: rest.x, y: rest.y, rot: rest.rot }, isGuestRoot, dock });
    for (const c of boneChildren(rig, bone.id)) walk(c, nodePath, null, false, dock);
  };
  for (const root of boneRoots(rig)) walk(root, '', null, false, null);
  // 合并进来的武器 rig
  for (const dock of merges) {
    const guest = project.rigs[dock.guestRig];
    if (!guest) continue;
    const hostEntry = out.find(e => e.rigId === rig.id && e.bone.name === dock.hostBone);
    if (!hostEntry) continue;
    const walkGuest = (bone, parentPath, isRoot) => {
      const name = sanitize(bone.name);
      const nodePath = parentPath ? parentPath + '/' + name : name;
      // 挂接时武器根骨直接落在手骨原点（忽略其独立摆放位置），随手臂一起动
      const base = isRoot ? { x: 0, y: 0, rot: 0 } : bone.rest;
      out.push({ rigId: guest.id, bone, nodePath, base, isGuestRoot: isRoot, dock });
      for (const c of boneChildren(guest, bone.id)) walkGuest(c, nodePath, false);
    };
    for (const root of boneRoots(guest)) walkGuest(root, hostEntry.nodePath, true);
  }
  return out;
}

// 把轨道键值换算到场景坐标（合并武器根骨需要叠加 dock）
function adaptKeys(track, entry, project) {
  const dock = entry.isGuestRoot ? entry.dock : null;
  return track.keys.map(k => dock ? { ...dockComposeKey(dock, k), f: k.f } : { ...k });
}

function buildAnimationSub(project, anim, sceneBones, idAssign) {
  const lines = [];
  const fps = anim.fps || project.settings.fps;
  const length = anim.frames / fps;
  const L = [];
  L.push(`[sub_resource type="Animation" id="${idAssign.animId}"]`);
  L.push(`resource_name = "${sanitize(anim.name)}"`);
  L.push(`length = ${fmtF(length)}`);
  L.push(`loop_mode = ${anim.loop ? 1 : 0}`);
  L.push(`step = ${fmtF(1 / fps)}`);

  const bonesByRef = new Map(sceneBones.map(e => [e.rigId + '/' + e.bone.name, e]));
  let ti = 0;
  for (const tr of anim.tracks) {
    const entry = bonesByRef.get(tr.boneRef);
    if (!entry) continue; // 该轨道不属于此场景
    const keys = adaptKeys(tr, entry, project).sort((a, b) => a.f - b.f);
    if (!keys.length) continue;
    const times = keys.map(k => fmtF(k.f / fps)).join(', ');
    const trans = keys.map(() => '1').join(', ');
    const path = entry.nodePath;
    const mkHeader = (prop, interp, update) =>
      [`tracks/${ti}/type = "value"`, `tracks/${ti}/imported = false`, `tracks/${ti}/enabled = true`,
       `tracks/${ti}/path = NodePath("${path}:${prop}")`, `tracks/${ti}/interp = ${interp}`,
       `tracks/${ti}/loop_wrap = true`];

    // position
    L.push(...mkHeader('position', tr.stepped ? 0 : 1, tr.stepped ? 1 : 0));
    L.push(`tracks/${ti}/keys = {`);
    L.push(`"times": PackedFloat32Array(${times}),`);
    L.push(`"transitions": PackedFloat32Array(${trans}),`);
    L.push(`"update": ${tr.stepped ? 1 : 0},`);
    L.push(`"values": [${keys.map(k => V2(k.x, k.y)).join(', ')}]`);
    L.push(`}`);
    ti++;
    // rotation（弧度）
    L.push(...mkHeader('rotation', tr.stepped ? 0 : 1, tr.stepped ? 1 : 0));
    L.push(`tracks/${ti}/keys = {`);
    L.push(`"times": PackedFloat32Array(${times}),`);
    L.push(`"transitions": PackedFloat32Array(${trans}),`);
    L.push(`"update": ${tr.stepped ? 1 : 0},`);
    L.push(`"values": [${keys.map(k => fmtF(k.rot * Math.PI / 180)).join(', ')}]`);
    L.push(`}`);
    ti++;
    // scale（仅当有非 1 缩放才导出）
    if (keys.some(k => Math.abs(k.sx - 1) > 1e-6 || Math.abs(k.sy - 1) > 1e-6)) {
      L.push(...mkHeader('scale', tr.stepped ? 0 : 1, tr.stepped ? 1 : 0));
      L.push(`tracks/${ti}/keys = {`);
      L.push(`"times": PackedFloat32Array(${times}),`);
      L.push(`"transitions": PackedFloat32Array(${trans}),`);
      L.push(`"update": ${tr.stepped ? 1 : 0},`);
      L.push(`"values": [${keys.map(k => V2(k.sx, k.sy)).join(', ')}]`);
      L.push(`}`);
      ti++;
    }
  }
  return L.join('\n');
}

// 构建单个场景文本；merges = 挂接到本 rig 的 dock 列表（attached 模式）
function buildSceneText(project, rig, merges, sceneName) {
  const bones = collectBones(project, rig, merges);
  const nameSet = new Set();
  const uniqueName = (n) => { let x = n, i = 2; while (nameSet.has(x)) x = n + i++; nameSet.add(x); return x; };
  for (const e of bones) e.nodeName = uniqueName(e.bone.name === '' ? 'Bone' : sanitize(e.bone.name));
  // nodePath 用 nodeName 重建
  const byNodeName = new Map();
  for (const e of bones) byNodeName.set(e.rigId + '/' + e.bone.name, e);
  // 重建路径（父链）
  const pathOf = (e) => {
    // 找父 entry
    if (e.isGuestRoot) {
      const host = bones.find(b => b.rigId === e.dock.hostRig && b.bone.name === e.dock.hostBone);
      return (host ? host.nodeName : '') + '/' + e.nodeName;
    }
    if (!e.bone.parent) return e.nodeName;
    // 父骨：同 rig 内 parent id
    const rig_ = project.rigs[e.rigId];
    const parent = rig_.bones.find(b => b.id === e.bone.parent);
    const pe = parent ? byNodeName.get(e.rigId + '/' + parent.name) : null;
    return pe ? pathOf(pe) + '/' + e.nodeName : e.nodeName;
  };
  for (const e of bones) e.nodePath = pathOf(e);

  const ext = new Map(); // texName -> id
  for (const e of bones) {
    const rig_ = project.rigs[e.rigId];
    for (const att of rig_.attachments.filter(a => a.bone === e.bone.name)) {
      if (project.textures[att.tex] && !ext.has(att.tex)) {
        ext.set(att.tex, `${ext.size + 1}_${safeTexFile(att.tex).replace(/\.\w+$/, '')}`);
      }
    }
  }

  const subs = [];   // sub_resource 文本
  const animLibEntries = [];
  let subI = 0;
  for (const anim of project.animations) {
    const animId = `Animation_${++subI}`;
    subs.push(buildAnimationSub(project, anim, bones, { animId }));
    animLibEntries.push(`"${sanitize(anim.name)}": SubResource("${animId}")`);
  }
  let libId = null;
  if (animLibEntries.length) {
    libId = `AnimationLibrary_${++subI}`;
    subs.push(`[sub_resource type="AnimationLibrary" id="${libId}"]\n_data = {\n${animLibEntries.join(',\n')}\n}`);
  }

  const L = [];
  const loadSteps = ext.size + subs.length + 1;
  L.push(`[gd_scene load_steps=${loadSteps} format=3]`, '');
  for (const [tex, id] of ext) {
    L.push(`[ext_resource type="Texture2D" path="res://textures/${safeTexFile(tex)}" id="${id}"]`);
  }
  if (ext.size) L.push('');
  for (const s of subs) { L.push(s, ''); }

  L.push(`[node name="${sanitize(sceneName)}" type="Skeleton2D"]`, '');
  // 节点：按父先子后输出（bones 收集顺序已保证）
  const emitted = new Set();
  const emitBone = (e) => {
    if (emitted.has(e)) return;
    emitted.add(e);
    const parentPath = e.nodePath.includes('/')
      ? 'parent="' + e.nodePath.slice(0, e.nodePath.lastIndexOf('/')) + '"'
      : 'parent="."';
    L.push(`[node name="${e.nodeName}" type="Bone2D" ${parentPath}]`);
    L.push(`position = ${V2(e.base.x, e.base.y)}`);
    L.push(`rotation = ${fmtF(e.base.rot * Math.PI / 180)}`);
    L.push(`rest = ${T2D(e.base.x, e.base.y, e.base.rot)}`);
    L.push(`default_length = ${fmtF(e.bone.length)}`, '');
    // 该骨的贴图
    const rig_ = project.rigs[e.rigId];
    let ai = 0;
    for (const att of rig_.attachments.filter(a => a.bone === e.bone.name)) {
      if (att.visible === false) continue; // 按所见状态导出：隐藏的贴图不导出
      const id = ext.get(att.tex);
      if (!id) continue;
      L.push(`[node name="${safeTexFile(att.tex).replace(/\.\w+$/, '')}_${++ai}" type="Sprite2D" ${parentPath}]`);
      L.push(`texture = ExtResource("${id}")`);
      // 贴图锁定骨骼框：位置=框中心；拉伸铺满（边缘与框对齐，非等比缩放；与视口同一公式，含 90° 旋转换算）
      const Lb = e.bone.length || 0, qwb = Math.max(4, e.bone.qw || 16);
      let scx, scy;
      if (att.iw) {
        const swap = Math.abs((((att.rot || 0) % 180) + 180) % 180 - 90) < 45;
        scx = Math.max(0.001, swap ? qwb / att.iw : Lb / att.iw);
        scy = Math.max(0.001, swap ? Lb / att.ih : qwb / att.ih);
      } else {
        scx = att.scale || 1; scy = scx;
      }
      L.push(`position = ${V2(Lb / 2, 0)}`);
      L.push(`rotation = ${fmtF(att.rot * Math.PI / 180)}`);
      L.push(`scale = ${V2(scx, scy)}`);
      if (att.flipX) L.push('flip_h = true');
      if (att.flipY) L.push('flip_v = true');
      const alpha = att.alpha == null ? 1 : att.alpha;
      if (alpha < 1) L.push(`self_modulate = Color(1, 1, 1, ${fmtF(alpha)})`);
      L.push(`z_index = ${effZ(att)}`, '');
    }
  };
  for (const e of bones) emitBone(e);

  // Dock 标记（宿主 rig 的所有 dock 都导出 Marker2D，方便分离模式运行时挂接）
  const sceneRigIds = new Set(bones.map(b => b.rigId));
  for (const d of project.docks) {
    if (!sceneRigIds.has(d.hostRig)) continue;
    const host = bones.find(b => b.rigId === d.hostRig && b.bone.name === d.hostBone);
    if (!host) continue;
    const parentPath = 'parent="' + host.nodePath + '"';
    L.push(`[node name="Dock_${sanitize(d.hostBone)}" type="Marker2D" ${parentPath}]`);
    L.push(`position = ${V2(d.x, d.y)}`);
    L.push(`rotation = ${fmtF(d.rot * Math.PI / 180)}`, '');
  }

  if (libId) {
    L.push(`[node name="AnimationPlayer" type="AnimationPlayer" parent="."]`);
    L.push(`libraries = {`);
    L.push(`"": SubResource("${libId}")`);
    L.push(`}`, '');
  }
  return { text: L.join('\n'), bones };
}

// 入口：project + 模式 → { files: [{path, text|bytes}], meta }
export function buildExport(project, mode) {
  const files = [];
  const warnings = [];
  const rigVisible = (rigId) => {
    const r = project.rigs[rigId];
    return r && r.visible !== false;
  };
  // 隐藏 rig（如单武器模式下的第二把武器）不参与合并与导出
  const mergesAll = mode === 'attached'
    ? project.docks.filter(d => d.attached && rigVisible(d.guestRig) && rigVisible(d.hostRig))
    : [];
  const sceneInfos = [];

  for (const rigId of Object.keys(project.rigs)) {
    const rig = project.rigs[rigId];
    if (rig.visible === false) continue;
    const mergedHere = mergesAll.filter(d => d.hostRig === rigId);
    const isMergedAway = mergesAll.some(d => d.guestRig === rigId);
    if (isMergedAway) continue;
    const { text, bones } = buildSceneText(project, rig, mergedHere, rigId);
    files.push({ path: `${sanitize(rigId)}.tscn`, text });
    sceneInfos.push({ rigId, file: `${sanitize(rigId)}.tscn`, bones });
  }

  // meta.json
  const sceneRigOf = (rigId) => sceneInfos.find(s => s.bones.some(b => b.rigId === rigId));
  const meta = {
    mode, fps: project.settings.fps,
    docks: project.docks
      .filter(d => rigVisible(d.guestRig) && rigVisible(d.hostRig))
      .map(d => {
      const hostScene = sceneRigOf(d.hostRig);
      const guestScene = sceneRigOf(d.guestRig);
      return {
        hostRig: d.hostRig, hostBone: d.hostBone,
        guestRig: d.guestRig, guestBone: d.guestBone,
        marker: `Dock_${sanitize(d.hostBone)}`,
        offset: { x: d.x, y: d.y }, rot: d.rot,
        merged: mode === 'attached' && !!d.attached,
        hostScene: hostScene ? hostScene.file : null,
        guestScene: (mode === 'attached' && d.attached) ? null : (guestScene ? guestScene.file : null)
      };
    })
  };
  files.push({ path: 'meta.json', text: JSON.stringify(meta, null, 2) });

  // 贴图
  for (const [tex, dataURL] of Object.entries(project.textures)) {
    if (!dataURL) { warnings.push(`贴图 ${tex} 数据无效`); continue; }
    files.push({ path: `textures/${safeTexFile(tex)}`, bytes: dataURL, isDataURL: true });
  }
  // 校验贴图引用
  for (const rigId of Object.keys(project.rigs)) {
    for (const att of project.rigs[rigId].attachments) {
      if (!project.textures[att.tex]) warnings.push(`${rigId}.${att.bone} 引用了不存在的贴图 "${att.tex}"`);
    }
  }
  return { files, warnings, meta };
}
