const { zipSync } = require('fflate');

function safePart(value) {
  let result = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 72);
  if (!result) result = 'Без названия';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(result)) result += '_';
  return result;
}

function imageFormat(input, contentType = '', name = '', allowExtensionFallback = false) {
  const b = Buffer.from(input);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii'))) return { ext: 'gif', mime: 'image/gif' };
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(b.toString('ascii', 8, 12))) return { ext: 'avif', mime: 'image/avif' };
  if (b.length >= 2 && b.toString('ascii', 0, 2) === 'BM') return { ext: 'bmp', mime: 'image/bmp' };
  const head = b.subarray(0, 500).toString('utf8').trim();
  if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(head)) return { ext: 'svg', mime: 'image/svg+xml' };
  const ext = String(name).match(/\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i)?.[1]?.toLowerCase();
  if (allowExtensionFallback && ext) return { ext: ext === 'jpeg' ? 'jpg' : ext, mime: `image/${ext === 'jpg' ? 'jpeg' : ext}` };
  return null;
}

async function buildExport(books, selectedKeys, loadRemote) {
  const selected = new Set(selectedKeys);
  const files = new Map();
  const errors = [];
  const bookNames = new Map();
  for (const book of books) {
    const candidates = book.items.filter(item => selected.has(`${book.id}:${item.id}`));
    if (!candidates.length) continue;
    const base = safePart(book.title);
    const count = (bookNames.get(base) || 0) + 1;
    bookNames.set(base, count);
    const folder = count === 1 ? base : `${base} (${count})`;
    const indices = new Map();
    for (const item of candidates) {
      try {
        const response = item.sourceType === 'embedded'
          ? { data: book.entries[item.archivePath], contentType: '' }
          : await loadRemote(item.url);
        if (!response?.data) throw Error('файл недоступен');
        const format = imageFormat(response.data, response.contentType, item.originalName, item.sourceType === 'embedded');
        if (!format) throw Error('ссылка вернула не изображение');
        const chapterFolder = item.isCover ? '0000 Обложка' : item.chapterIndex
          ? `${String(item.chapterIndex).padStart(4, '0')} ${safePart(item.chapter)}`
          : '9999 Вне глав';
        const sequence = (indices.get(chapterFolder) || 0) + 1;
        indices.set(chapterFolder, sequence);
        const relativePath = `${folder}/${chapterFolder}/${String(sequence).padStart(3, '0')}.${format.ext}`;
        files.set(relativePath, new Uint8Array(response.data));
      } catch (error) {
        errors.push(`${book.title} — ${item.chapter}: ${error.message}`);
      }
    }
  }
  return { files, errors };
}

function makeZip(files) {
  return zipSync(Object.fromEntries(files), { level: 0 });
}

module.exports = { safePart, imageFormat, buildExport, makeZip };
