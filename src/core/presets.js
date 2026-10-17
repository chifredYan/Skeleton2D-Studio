// 姿势快捷预设：一键把当前动画覆盖为预设动作
// 循环保证：所有关节角写成 θ=2πf/8 的连续周期函数（函数式），
// 或按帧手写 8 元素数组且 f7→f0 过渡与相邻帧同量级（数组式）→ 首尾帧无缝衔接
// 约定：rot 为绝对局部角（rest.rot + delta）；x/y 覆盖 rest 偏移（非根骨必须带 rest offset）
// 朝向：人形面朝 +x（右）；画布 y 向下为正 → 上升 = y 负值

const TAU = Math.PI * 2;

// fn 为函数(th)=>delta 时按 8 相位采样；为数组时直接按帧取值（数组设计须保证 f7→f0 连续）
const sample8 = (fn) => (Array.isArray(fn) ? fn.slice() : Array.from({ length: 8 }, (_, f) => fn(TAU * f / 8)));

// 人形轨道构建器：track(bone, rot, x, y)，rot 为相对 rest 的偏移（度）
function makeTrackBuilder(project) {
  const rig = project.rigs.humanoid;
  const rest = {};
  for (const b of rig.bones) rest[b.name] = { x: b.rest.x, y: b.rest.y, rot: b.rest.rot };
  const tracks = [];
  const track = (bone, rotFn, xFn, yFn) => {
    const r = rest[bone];
    const rots = sample8(rotFn);
    const xs = xFn ? sample8(xFn) : null;
    const ys = yFn ? sample8(yFn) : null;
    tracks.push({
      boneRef: 'humanoid/' + bone,
      keys: Array.from({ length: 8 }, (_, f) => ({
        f,
        x: xs ? xs[f] : r.x,
        y: ys ? ys[f] : r.y,
        rot: r.rot + rots[f],
        sx: 1, sy: 1
      }))
    });
  };
  return { tracks, track, rest };
}

// 武器轨道（挂接态：基为 {0,0,0}，x/y 必须显式为 0，rot 为相对手骨的偏移）
function weaponTrack(rotArr) {
  return {
    boneRef: 'weapon/Grip',
    keys: rotArr.map((rot, f) => ({ f, x: 0, y: 0, rot, sx: 1, sy: 1 }))
  };
}

export const POSE_PRESETS = {

  // —— 待机：缓慢呼吸起伏，2 次谐波 ——
  idle: {
    id: 'idle',
    name: '待机呼吸 (8帧)',
    fps: 8,
    frames: 8,
    weapon: false,
    buildTracks(project) {
      const { tracks, track } = makeTrackBuilder(project);
      track('LowerBody', () => 0, null, th => 1.2 * Math.sin(th));
      track('UpperBody', th => 2.5 + 1.5 * Math.sin(th));
      track('Head', th => -2.5 - 1.2 * Math.sin(th));
      track('UpperArmR', th => 62 + 2.5 * Math.sin(th));
      track('ForeArmR', th => -14 + 3 * Math.sin(th + 0.3));
      track('HandR', th => 2 * Math.sin(th));
      track('UpperArmL', th => 242 + 2.5 * Math.sin(th));
      track('ForeArmL', th => -14 + 3 * Math.sin(th + 0.3));
      track('HandL', th => 2 * Math.sin(th));
      track('UpperLegR', th => 1.5 * Math.sin(th));
      track('LowerLegR', th => 1.5 * Math.sin(th));
      track('FootR', () => 0);
      track('UpperLegL', th => 1.5 * Math.sin(th + Math.PI));
      track('LowerLegL', th => 1.5 * Math.sin(th + Math.PI));
      track('FootL', () => 0);
      return tracks;
    }
  },

  // —— 跑步：侧身跑（面朝 +x），双臂与同侧腿反相摆 ——
  run: {
    id: 'run',
    name: '跑步循环 (8帧·侧身)',
    fps: 12,
    frames: 8,
    weapon: false,
    buildTracks(project) {
      const { tracks, track } = makeTrackBuilder(project);
      track('LowerBody', () => 0, th => 1.2 * Math.sin(2 * th), th => 2.5 * Math.cos(2 * th));
      track('UpperBody', th => 10 + 3 * Math.sin(2 * th));
      track('Head', th => -6 - 2 * Math.sin(2 * th));
      track('UpperArmR', th => 60 + 25 * Math.cos(th));
      track('ForeArmR', th => -75 + 18 * Math.sin(th + 1.0));
      track('HandR', th => 4 * Math.sin(th + 0.5));
      track('UpperArmL', th => 240 + 25 * Math.cos(th + Math.PI)); // rest=-90(朝左)，+240 才自然下垂
      track('ForeArmL', th => -75 + 18 * Math.sin(th + Math.PI + 1.0));
      track('HandL', th => 4 * Math.sin(th + Math.PI + 0.5));
      track('UpperLegR', th => -35 * Math.cos(th));
      track('LowerLegR', th => 15 + 55 * Math.max(0, Math.sin(th - 2.6)));
      track('FootR', th => 10 - 12 * Math.sin(th));
      track('UpperLegL', th => -35 * Math.cos(th + Math.PI));
      track('LowerLegL', th => 15 + 55 * Math.max(0, Math.sin(th + Math.PI - 2.6)));
      track('FootL', th => 10 - 12 * Math.sin(th + Math.PI));
      return tracks;
    }
  },

  // —— 攻击：右手持武器（挂接右手）由上后向前下劈砍；蓄力→挥砍→收招，唯一带武器的预设 ——
  // 2026-10-13 起采用用户在工具内调好的 project.skelproj.json 攻击动作（挥砍轨迹重调）
  attack: {
    id: 'attack',
    name: '攻击挥砍 (8帧·武器)',
    fps: 12,
    frames: 8,
    weapon: true,
    buildTracks(project) {
      const { tracks, track, rest } = makeTrackBuilder(project);
      // 重心：后坐蓄力 → 跨步前压
      track('LowerBody', () => 0,
        [0, -1, -2, -2, 0, 2, 2, 0],
        [0, 0.5, 1, 1.5, 0.5, -0.5, -1, -0.5]);
      // 躯干：后仰蓄力(-32°) → 挥砍瞬间前送(+18°) → 收招
      track('UpperBody', [-5, -15, -26, -32, -8, 14, 18, 2]);
      track('Head', [4, 10, 18, 22, 8, -8, -12, -2]);
      // 持械右臂：抬起后引(-95°) → 收臂下劈(手部微移贴近身侧) → 回位
      // x/y 为 rest 偏移的相对量（2026-10-13 骨骼默认 ×5 后不能再用绝对值硬编码）
      const armR = rest.UpperArmR;
      track('UpperArmR', [55, 20, -40, -95, -60, -42.1, -3.8, 52.3],
        [0, 0, 0, 0, 0, 1.1, -1.1, 0].map(d => armR.x + d),
        [0, 0, 0, 0, 0, -5.9, -6.5, 0].map(d => armR.y + d));
      track('ForeArmR', [-20, -30, -45, -55, -30, -10, -11.3, -12]);
      track('HandR', [0, -5, -10, -15, -5, 5, 8, 4]);
      // 左臂：反侧平衡摆动
      track('UpperArmL', [235, 245, 255, 262, 255, 245, 238, 236]);
      track('ForeArmL', [-12, -18, -25, -30, -22, -14, -10, -11]);
      track('HandL', () => 0);
      // 弓步：右腿前跨，左腿蹬直
      track('UpperLegR', [-5, -10, -15, -18, -8, 5, 10, 4]);
      track('LowerLegR', [5, 10, 15, 18, 10, 4, 2, 4]);
      track('FootR', () => 0);
      track('UpperLegL', [8, 12, 16, 18, 10, 2, 0, 6]);
      track('LowerLegL', [-3, 5, 12, 16, 8, 0, -4, -2]);
      track('FootL', () => 0);
      // 武器随劈砍小幅摆动（挂接态 rot 相对手骨）
      tracks.push(weaponTrack([-10, -25, -45, -20, 15, -17.2, -16.3, -5.4]));
      return tracks;
    }
  },

  // —— 跳跃：下蹲蓄力 → 蹬地腾空（收腿团身）→ 下落 → 落地缓冲 ——
  jump: {
    id: 'jump',
    name: '跳跃循环 (8帧)',
    fps: 10,
    frames: 8,
    weapon: false,
    buildTracks(project) {
      const { tracks, track } = makeTrackBuilder(project);
      // 根骨：下蹲(+3) → 腾空最高(-16) → 落地缓冲(+3)
      track('LowerBody', [0, -4, 8, 12, 14, 10, 2, 0],
        [0, 0, 1, 2, 2, 1, 0, 0],
        [0, 3, -8, -16, -14, -4, 3, 1]);
      track('UpperBody', [5, 12, 18, 22, 20, 14, 8, 4]);
      track('Head', [-4, -8, -12, -14, -12, -8, -3, -2]);
      // 双臂同时上摆后回落（起跳甩臂）
      track('UpperArmR', [62, 30, -30, -70, -60, 0, 50, 60]);
      track('ForeArmR', [-15, -30, -50, -60, -50, -30, -18, -14]);
      track('HandR', () => 0);
      track('UpperArmL', [242, 275, 330, 362, 355, 305, 255, 244]);
      track('ForeArmL', [-14, -28, -48, -58, -48, -28, -16, -13]);
      track('HandL', () => 0);
      // 空中收腿团身，落地伸直
      track('UpperLegR', [2, -15, -55, -70, -60, -25, 5, 2]);
      track('LowerLegR', [3, 25, 70, 85, 75, 35, 5, 3]);
      track('FootR', [0, 15, 25, 20, 10, 5, 0, 0]);
      track('UpperLegL', [2, -10, -40, -55, -50, -20, 6, 2]);
      track('LowerLegL', [3, 18, 55, 70, 60, 28, 5, 3]);
      track('FootL', [0, 12, 20, 16, 8, 4, 0, 0]);
      return tracks;
    }
  },

  // —— 被攻击：正面受击后仰（面朝 +x，力从 +x 方向来 → 向 -x 击退）——
  hurt: {
    id: 'hurt',
    name: '被击后仰 (8帧)',
    fps: 10,
    frames: 8,
    weapon: false,
    buildTracks(project) {
      const { tracks, track } = makeTrackBuilder(project);
      track('LowerBody', [0, 2, 5, 6, 4, 2, 0, 0],
        [0, -1.5, -3, -4, -3, -1.5, -0.5, 0], null);
      track('UpperBody', [0, -10, -22, -28, -22, -12, -4, 0]);
      track('Head', [0, 8, 18, 24, 18, 9, 2, 0]);
      // 双臂向后上甩开
      track('UpperArmR', [62, 40, 10, -5, 5, 30, 50, 60]);
      track('ForeArmR', [-15, -35, -60, -70, -55, -30, -18, -14]);
      track('HandR', () => 0);
      track('UpperArmL', [242, 220, 190, 175, 185, 210, 232, 240]);
      track('ForeArmL', [-14, -30, -55, -65, -50, -28, -16, -13]);
      track('HandL', () => 0);
      // 踉跄步
      track('UpperLegR', [0, -8, -18, -22, -15, -6, 0, 0]);
      track('LowerLegR', [0, 10, 25, 30, 20, 8, 2, 0]);
      track('FootR', () => 0);
      track('UpperLegL', [0, 6, 14, 18, 12, 5, 0, 0]);
      track('LowerLegL', [0, -4, -12, -15, -9, -3, 0, 0]);
      track('FootL', () => 0);
      return tracks;
    }
  },

  // —— 倒地死亡：向后倒地一次成型（一次性动作，不循环）——
  dead: {
    id: 'dead',
    name: '倒地死亡 (8帧·不循环)',
    fps: 8,
    frames: 8,
    weapon: false,
    loop: false,
    buildTracks(project) {
      const { tracks, track } = makeTrackBuilder(project);
      // 躯干整体向后旋转放平（-86° ≈ 仰面躺平），重心下沉贴地
      track('LowerBody', [0, -6, -16, -30, -48, -64, -78, -86],
        [0, -1, -2.5, -4.5, -7, -9, -10.5, -11],
        [0, 1, 2.5, 5, 8, 11, 14, 16]);
      track('UpperBody', [2, 0, -4, -8, -10, -12, -12, -12]);
      track('Head', [0, 2, 4, 5, 6, 6, 6, 6]);
      // 手臂摊开
      track('UpperArmR', [62, 60, 55, 50, 48, 46, 45, 44]);
      track('ForeArmR', [-15, -12, -8, -5, -3, 0, 0, 0]);
      track('HandR', () => 0);
      track('UpperArmL', [242, 238, 230, 222, 218, 214, 212, 210]);
      track('ForeArmL', [-14, -10, -6, -3, 0, 0, 0, 0]);
      track('HandL', () => 0);
      // 右腿微屈，左腿伸展
      track('UpperLegR', [0, -6, -14, -22, -26, -28, -30, -30]);
      track('LowerLegR', [0, 8, 20, 30, 36, 40, 42, 42]);
      track('FootR', () => 0);
      track('UpperLegL', [0, -3, -8, -12, -14, -15, -16, -16]);
      track('LowerLegL', [0, 4, 10, 14, 16, 17, 18, 18]);
      track('FootL', () => 0);
      return tracks;
    }
  },

  // —— 后退：倒着走（面朝 +x，向 -x 退），迈步幅度小于跑步，身体微后仰 ——
  backstep: {
    id: 'backstep',
    name: '后退循环 (8帧)',
    fps: 10,
    frames: 8,
    weapon: false,
    buildTracks(project) {
      const { tracks, track } = makeTrackBuilder(project);
      track('LowerBody', () => 0, th => -1.2 * Math.sin(2 * th), th => 1.8 * Math.cos(2 * th));
      track('UpperBody', th => -6 + 2 * Math.sin(2 * th));
      track('Head', th => 4 + 1.5 * Math.sin(2 * th));
      track('UpperArmR', th => 62 - 18 * Math.cos(th));
      track('ForeArmR', th => -35 + 12 * Math.sin(th + 1.0));
      track('HandR', th => 3 * Math.sin(th + 0.5));
      track('UpperArmL', th => 242 - 18 * Math.cos(th + Math.PI));
      track('ForeArmL', th => -35 + 12 * Math.sin(th + Math.PI + 1.0));
      track('HandL', th => 3 * Math.sin(th + Math.PI + 0.5));
      // 腿相位与前进跑相反（倒步）
      track('UpperLegR', th => 28 * Math.cos(th));
      track('LowerLegR', th => 10 + 38 * Math.max(0, Math.sin(th - 0.55)));
      track('FootR', th => -6 + 9 * Math.sin(th));
      track('UpperLegL', th => 28 * Math.cos(th + Math.PI));
      track('LowerLegL', th => 10 + 38 * Math.max(0, Math.sin(th + Math.PI - 0.55)));
      track('FootL', th => -6 + 9 * Math.sin(th + Math.PI));
      return tracks;
    }
  },

  // —— 冲刺：深前倾、大步幅、手臂后摆，节奏最快的循环 ——
  dash: {
    id: 'dash',
    name: '冲刺循环 (8帧)',
    fps: 14,
    frames: 8,
    weapon: false,
    buildTracks(project) {
      const { tracks, track } = makeTrackBuilder(project);
      track('LowerBody', () => 0, th => 2 * Math.sin(2 * th), th => 1.8 * Math.cos(2 * th));
      track('UpperBody', th => 28 + 3 * Math.sin(2 * th));
      track('Head', th => -20 - 3 * Math.sin(2 * th));
      // 双臂后摆（贴近身体后方），随步幅微幅交替
      track('UpperArmR', th => 105 + 15 * Math.cos(th));
      track('ForeArmR', th => -30 + 10 * Math.sin(th + 1.0));
      track('HandR', () => 0);
      track('UpperArmL', th => 287 + 15 * Math.cos(th + Math.PI));
      track('ForeArmL', th => -30 + 10 * Math.sin(th + Math.PI + 1.0));
      track('HandL', () => 0);
      // 大步幅 + 强收腿
      track('UpperLegR', th => -45 * Math.cos(th));
      track('LowerLegR', th => 10 + 60 * Math.max(0, Math.sin(th - 2.6)));
      track('FootR', th => 12 - 15 * Math.sin(th));
      track('UpperLegL', th => -45 * Math.cos(th + Math.PI));
      track('LowerLegL', th => 10 + 60 * Math.max(0, Math.sin(th + Math.PI - 2.6)));
      track('FootL', th => 12 - 15 * Math.sin(th + Math.PI));
      return tracks;
    }
  }
};
