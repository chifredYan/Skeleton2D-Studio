// export/zip.js — 纯 JS 实现 store-only ZIP（无压缩，零依赖）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// files: [{ name: 'dir/file.ext', data: Uint8Array }] → Uint8Array(zip)
export function makeZip(files) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  const u16 = v => [v & 0xFF, (v >> 8) & 0xFF];
  const u32 = v => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF];

  for (const f of files) {
    const nameB = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array([
      0x50, 0x4B, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length),
      ...u16(nameB.length), ...u16(0), ...nameB
    ]);
    locals.push(local, f.data);
    centrals.push(new Uint8Array([
      0x50, 0x4B, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length),
      ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset), ...nameB
    ]));
    offset += local.length + f.data.length;
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array([
    0x50, 0x4B, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0)
  ]);
  const all = [...locals, ...centrals, eocd];
  const total = all.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of all) { out.set(a, pos); pos += a.length; }
  return out;
}

// dataURL -> Uint8Array（浏览器/Node 通用）
export function dataURLToBytes(dataURL) {
  const b64 = dataURL.slice(dataURL.indexOf(',') + 1);
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function textBytes(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'utf-8'));
  return new TextEncoder().encode(str);
}
