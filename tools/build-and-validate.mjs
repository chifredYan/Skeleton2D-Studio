// tools/build-and-validate.mjs — 构建样例工程 → 导出 → Godot headless 验证
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { newProject } from '../src/core/model.js';
import { buildExport } from '../src/export/tscn.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '..', '.godot-validate');
const GODOT_CANDIDATES = [
  process.env.GODOT_PATH,
  'E:/AI/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe',
  'E:/AI/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64.exe'
].filter(Boolean);
const GODOT = GODOT_CANDIDATES.find(p => existsSync(p));

// —— 最小 PNG 生成器（RGBA，zlib deflate）——
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (u8) => {
  let c = 0xFFFFFFFF;
  for (const b of u8) c = CRC_T[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function makePNG(w, h, fn) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fn(x, y);
      const o = y * (1 + w * 4) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}
const flat = (r, g, b) => makePNG(16, 16, () => [r, g, b, 255]);

// —— 样例工程 ——
function sampleProject() {
  const p = newProject();
  p.docks[0].attached = true; // attached 模式测试需要挂接
  p.textures = {
    'torso.png': 'data:image/png;base64,' + flat(60, 110, 200).toString('base64'),
    'head.png': 'data:image/png;base64,' + flat(240, 200, 160).toString('base64'),
    'arm.png': 'data:image/png;base64,' + flat(80, 160, 90).toString('base64'),
    'blade.png': 'data:image/png;base64,' + flat(200, 200, 220).toString('base64'),
    'hilt.png': 'data:image/png;base64,' + flat(120, 80, 40).toString('base64')
  };
  const hero = p.rigs.humanoid, sword = p.rigs.weapon;
  hero.attachments.push(
    { id: 'x1', bone: 'UpperBody', tex: 'torso.png', x: 0, y: -10, rot: 0, scale: 2.2, z: 10 },
    { id: 'x2', bone: 'Head', tex: 'head.png', x: 0, y: 8, rot: 0, scale: 2.0, z: 12 },
    { id: 'x3', bone: 'UpperArmR', tex: 'arm.png', x: 0, y: 0, rot: 0, scale: 1.4, z: 11 }
  );
  sword.attachments.push(
    { id: 'x4', bone: 'Grip', tex: 'blade.png', x: 0, y: 0, rot: 0, scale: 1.5, z: 20 }
  );
  const k = (f, x, y, rot, sx = 1, sy = 1) => ({ f, x, y, rot, sx, sy });
  p.animations.push({
    id: 'a2', name: 'attack', fps: 12, frames: 12, loop: true,
    tracks: [
      { boneRef: 'humanoid/LowerBody', stepped: true, keys: [k(0, 0, 0, 0), k(4, 0, 10, 0), k(8, 0, -6, 0), k(11, 0, 0, 0)] },
      { boneRef: 'humanoid/UpperArmR', stepped: true, keys: [k(0, 20, 14, 0), k(4, 20, 14, -120), k(8, 20, 14, 30), k(11, 20, 14, 0)] },
      { boneRef: 'weapon/Grip', stepped: false, keys: [k(0, 0, 0, 0), k(4, 0, 0, -40), k(11, 0, 0, 0)] }
    ]
  });
  return p;
}

const VALIDATE_GD = `extends SceneTree

func _init() -> void:
	var errors := 0
	var dir := DirAccess.open("res://")
	for f in dir.get_files():
		if not f.ends_with(".tscn"):
			continue
		var ps: PackedScene = load(f)
		if ps == null:
			print("ERR load failed: ", f); errors += 1; continue
		var inst := ps.instantiate()
		if inst == null:
			print("ERR instantiate failed: ", f); errors += 1; continue
		root.add_child(inst)
		var skels := inst.find_children("*", "Skeleton2D", true, false)
		var bones := inst.find_children("*", "Bone2D", true, false)
		var markers := inst.find_children("*", "Marker2D", true, false)
		print("SCENE ", f, " skeletons=", skels.size(), " bones=", bones.size(), " markers=", markers.size())
		var players := inst.find_children("*", "AnimationPlayer", true, false)
		if players.size() > 0:
			var player: AnimationPlayer = players[0]
			for a in player.get_animation_list():
				var anim := player.get_animation(a)
				player.play(a)
				player.advance(anim.length)
				print("  ANIM ", a, " length=", snappedf(anim.length, 0.001), " tracks=", anim.get_track_count())
		else:
			print("  no AnimationPlayer")
		inst.queue_free()
		root.remove_child(inst)
		inst.free()
	if errors == 0:
		print("VALIDATION OK")
		quit(0)
	else:
		print("VALIDATION FAILED")
		quit(1)
`;

const PROJECT_GODOT = `config_version=5

[application]
config/name="s2d_validate"
`;

function writeScene(dir, project, mode) {
  const { files, warnings } = buildExport(project, mode);
  for (const w of warnings) console.log(`  [警告] ${w}`);
  for (const f of files) {
    const p = join(dir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    if (f.isDataURL) {
      const b64 = f.bytes.slice(f.bytes.indexOf(',') + 1);
      writeFileSync(p, Buffer.from(b64, 'base64'));
    } else {
      writeFileSync(p, f.text, 'utf-8');
    }
  }
}

function runGodot(args, cwd) {
  const opts = { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
  return execFileSync(GODOT, args, opts);
}

function main() {
  if (!GODOT) {
    console.log('未找到 Godot 可执行文件（设置 GODOT_PATH 环境变量可指定），跳过 headless 验证，仅生成导出产物。');
  }
  rmSync(OUT, { recursive: true, force: true });
  const proj = sampleProject();

  for (const mode of ['attached', 'detached']) {
    const dir = join(OUT, mode);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'project.godot'), PROJECT_GODOT, 'utf-8');
    writeFileSync(join(dir, 'validate.gd'), VALIDATE_GD, 'utf-8');
    console.log(`\n=== 模式: ${mode} ===`);
    writeScene(dir, proj, mode);
    if (!GODOT) continue;
    try {
      console.log('[1/2] 导入资源 (--import) ...');
      runGodot(['--headless', '--path', dir, '--import'], dir);
      console.log('[2/2] 运行验证脚本 ...');
      const out = runGodot(['--headless', '--path', dir, '--script', 'res://validate.gd'], dir);
      console.log(out);
    } catch (e) {
      console.log('GODOT 运行失败:', e.stdout || '', e.stderr || '', e.message || '');
      process.exitCode = 1;
    }
  }
  if (GODOT) console.log(`\n产物目录: ${OUT}`);
}

main();
