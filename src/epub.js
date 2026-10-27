const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');

const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|avif|bmp|svg)$/i;
const DOC_EXT = /\.(?:xhtml|html|htm)$/i;

function decodeEntities(value) {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return named[entity.toLowerCase()] || _;
  });
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function tagText(html, name) {
  const match = html.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeEntities(match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()) : '';
}

function archivePath(from, href) {
  const clean = href.split(/[?#]/)[0].replace(/\\/g, '/');
  let decoded;
  try { decoded = decodeURIComponent(clean); } catch { decoded = clean; }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded));
  if (!resolved || resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) return null;
  return resolved;
}

function isRemoteImage(href) {
  try {
    const url = new URL(href.startsWith('//') ? `https:${href}` : href);
    return ['http:', 'https:'].includes(url.protocol) &&
      (IMAGE_EXT.test(url.pathname) || url.hostname.toLowerCase() === 'images.novelpia.com');
  } catch { return false; }
}

function orderedDocuments(entries) {
  const fallback = Object.keys(entries).filter(name => DOC_EXT.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const container = entries['META-INF/container.xml'];
  if (!container) return fallback;
  const rootTag = strFromU8(container).match(/<rootfile\b[^>]*>/i)?.[0];
  const opfPath = rootTag && attributes(rootTag)['full-path'];
  const opf = opfPath && entries[opfPath];
  if (!opf) return fallback;
  const xml = strFromU8(opf);
  const manifest = new Map();
  for (const match of xml.matchAll(/<item\b[^>]*>/gi)) {
    const a = attributes(match[0]);
    if (a.id && a.href) manifest.set(a.id, archivePath(opfPath, a.href));
  }
  const spine = [];
  for (const match of xml.matchAll(/<itemref\b[^>]*>/gi)) {
    const name = manifest.get(attributes(match[0]).idref);
    if (name && entries[name] && DOC_EXT.test(name) && !spine.includes(name)) spine.push(name);
  }
  return [...spine, ...fallback.filter(name => !spine.includes(name))];
}

function scanEpub(data, filename) {
  const entries = unzipSync(data);
  const opf = Object.entries(entries).find(([name]) => name.toLowerCase().endsWith('.opf'));
  const title = (opf && tagText(strFromU8(opf[1]), 'dc:title')) || path.basename(filename, path.extname(filename));
  const items = [];
  const referenced = new Set();
  const docs = orderedDocuments(entries);

  function add(source, chapter, chapterIndex, seen) {
    if (!source || source.startsWith('data:')) return;
    let item;
    if (isRemoteImage(source)) {
      const url = source.startsWith('//') ? `https:${source}` : source;
      if (seen.has(url)) return;
      seen.add(url);
      item = { sourceType: 'remote', url, originalName: path.posix.basename(new URL(url).pathname) };
    } else if (!/^[a-z][\w+.-]*:/i.test(source)) {
      const resolved = archivePath(chapter.path, source);
      if (!resolved || !entries[resolved] || !IMAGE_EXT.test(resolved) || seen.has(resolved)) return;
      seen.add(resolved);
      referenced.add(resolved);
      item = { sourceType: 'embedded', archivePath: resolved, originalName: path.posix.basename(resolved), size: entries[resolved].length };
    } else return;
    items.push({ id: String(items.length + 1), chapter: chapter.name, chapterIndex, isCover: /(?:^|\/)cover\.[^/]+$/i.test(item.archivePath || item.originalName), ...item });
  }

  docs.forEach((docPath, index) => {
    const html = strFromU8(entries[docPath]);
    const chapter = { path: docPath, name: tagText(html, 'h1') || tagText(html, 'title') || `Глава ${index + 1}` };
    const seen = new Set();
    for (const match of html.matchAll(/<(?:img|image|a)\b[^>]*>/gi)) {
      const tag = match[0];
      const a = attributes(tag);
      const anchor = /^<a\b/i.test(tag);
      const source = anchor ? a.href : (a['data-src'] || a['xlink:href'] || a.href || a.src);
      add(source, chapter, index + 1, seen);
    }
  });

  for (const name of Object.keys(entries).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (!IMAGE_EXT.test(name) || referenced.has(name) || name.startsWith('__MACOSX/')) continue;
    const isCover = /(?:^|\/)cover\.[^/]+$/i.test(name);
    items.push({
      id: String(items.length + 1), sourceType: 'embedded', archivePath: name,
      originalName: path.posix.basename(name), size: entries[name].length,
      chapter: isCover ? 'Обложка' : 'Вне глав', chapterIndex: 0, isCover
    });
  }
  return { title, filename, items, entries };
}

module.exports = { scanEpub, archivePath, decodeEntities };
