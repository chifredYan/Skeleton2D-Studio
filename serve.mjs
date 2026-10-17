// serve.mjs — 零依赖静态 HTTP 服务器 + 工程自动保存（磁盘兜底，localStorage 失效也能恢复）
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8788;
const AUTOSAVE_DIR = join(ROOT, '.autosave');
const MAX_BODY = 80 * 1024 * 1024; // 80MB（多张 1024px PNG 的 dataURL 足够）

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);

    // —— 工程自动保存 API ——
    if (p === '/api/save' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body || typeof body !== 'object' || !body.project) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); return;
      }
      await mkdir(AUTOSAVE_DIR, { recursive: true });
      await writeFile(join(AUTOSAVE_DIR, 'project.json'), JSON.stringify(body.project));
      await writeFile(join(AUTOSAVE_DIR, 'textures.json'), JSON.stringify(body.textures || {}));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (p === '/api/load' && req.method === 'GET') {
      const out = { ok: true, project: null, textures: {} };
      try { out.project = JSON.parse(await readFile(join(AUTOSAVE_DIR, 'project.json'), 'utf8')); } catch (e) {}
      try { out.textures = JSON.parse(await readFile(join(AUTOSAVE_DIR, 'textures.json'), 'utf8')); } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
      return;
    }
    if (p === '/api/clear' && req.method === 'POST') {
      try {
        await writeFile(join(AUTOSAVE_DIR, 'project.json'), 'null');
        await writeFile(join(AUTOSAVE_DIR, 'textures.json'), '{}');
      } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      return;
    }

    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
}).listen(PORT, () => {
  console.log(`Skeleton2D Studio 已启动: http://localhost:${PORT}`);
});
