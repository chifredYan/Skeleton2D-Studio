// export/pkg.js — 组装导出产物（DOM-free）
import { buildExport } from './tscn.js?v=20261012y';
import { makeZip, dataURLToBytes, textBytes } from './zip.js?v=20261012y';

// 返回 { zip: Uint8Array, warnings, meta }
export function exportProject(project, mode = 'attached') {
  const { files, warnings, meta } = buildExport(project, mode);
  const zipFiles = files.map(f => ({
    name: f.path,
    data: f.isDataURL ? dataURLToBytes(f.bytes) : textBytes(f.text)
  }));
  return { zip: makeZip(zipFiles), warnings, meta, fileCount: zipFiles.length };
}
