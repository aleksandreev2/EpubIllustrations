const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { buildExport, makeZip, imageFormat, safePart } = require('../src/export');

test('converts once for both layouts and packages actual encoded bytes and extension', async () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
  const webp = Buffer.from('RIFF0000WEBPencoded');
  const book = { id: 'b', title: 'Книга', entries: { '1.png': png }, items: [{ id: '1', chapter: 'Начало', chapterIndex: 1, sourceType: 'embedded', archivePath: '1.png', originalName: '1.png' }] };
  const options = { format: 'webp', quality: 80, maxDimension: 1920 }; let calls = 0;
  const result = await buildExport([book], ['b:1'], null, 'both', options, async (data, format, received) => {
    calls++; assert.deepEqual(Buffer.from(data), png); assert.equal(format.mime, 'image/png'); assert.deepEqual(received, options); return webp;
  });
  assert.equal(calls, 1); assert.equal(result.files.size, 2); assert.equal(result.imageCount, 1);
  assert.equal(result.originalBytes, png.length); assert.equal(result.outputBytes, webp.length);
  const zipped = unzipSync(makeZip(result.files));
  for (const [name, bytes] of Object.entries(zipped)) { assert.ok(name.endsWith('.webp')); assert.deepEqual(Buffer.from(bytes), webp); }
  const original = await buildExport([book], ['b:1'], null, 'flat', { format: 'original' }, () => { throw Error('must not reencode original'); });
  assert.deepEqual(Buffer.from([...original.files.values()][0]), png);
  const failed = await buildExport([book], ['b:1'], null, 'flat', options, async () => png);
  assert.equal(failed.files.size, 0); assert.equal(failed.errors.length, 1);
  await assert.rejects(buildExport([book], ['b:1'], null, 'flat', { format: 'bad' }), /формат/i);
});

test('keeps book and chapter structure while removing unsafe filename characters', async () => {
  const book = {
    id: 'book1', title: 'Книга: первая?', entries: { 'Images/1.jpg': Buffer.from('picture') },
    items: [{ id: '1', chapter: 'Глава 1: начало?', chapterIndex: 1, sourceType: 'embedded', archivePath: 'Images/1.jpg', originalName: '1.jpg' }]
  };
  const result = await buildExport([book], ['book1:1'], async () => { throw Error('unexpected network'); });
  assert.deepEqual([...result.files.keys()], ['Книга первая/0001 Глава 1 начало/001.jpg']);
  assert.deepEqual([...result.files.values()][0], new Uint8Array(book.entries['Images/1.jpg']));
  assert.equal(result.errors.length, 0);
  const zipped = unzipSync(makeZip(result.files));
  assert.equal(strFromU8(zipped['Книга первая/0001 Глава 1 начало/001.jpg']), 'picture');
});

test('recognizes image bytes behind .file URL and rejects HTML response', async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.equal(imageFormat(png, 'image/jpeg', 'x.file').ext, 'png');
  const book = {
    id: 'remote', title: 'Ссылки', entries: {},
    items: [
      { id: '1', chapter: 'Первая', chapterIndex: 1, sourceType: 'remote', url: 'https://images.novelpia.com/1.file', originalName: '1.file' },
      { id: '2', chapter: 'Вторая', chapterIndex: 2, sourceType: 'remote', url: 'https://images.novelpia.com/2.file', originalName: '2.file' }
    ]
  };
  const result = await buildExport([book], ['remote:1', 'remote:2'], async url => ({
    data: url.endsWith('1.file') ? png : Buffer.from('<html>blocked</html>'), contentType: 'application/octet-stream'
  }));
  assert.deepEqual([...result.files.keys()], ['Ссылки/0001 Первая/001.png']);
  assert.equal(result.errors.length, 1);
});

test('normalizes reserved Windows directory names', () => {
  assert.equal(safePart('CON'), 'CON_');
  assert.equal(safePart('пусто<>:"/\\|?*   '), 'пусто');
});

test('does not mistake an HTML login page for a remote image based on its URL', () => {
  const html = Buffer.from('<!doctype html><html>login required</html>');
  assert.equal(imageFormat(html, 'text/html; charset=utf-8', 'picture.png'), null);
  assert.equal(imageFormat(html, 'image/png', 'picture.png'), null);
  assert.equal(imageFormat(html, '', 'picture.png'), null);
});

test('flat layout keeps all illustrations of each book in one folder with chapter names', async () => {
  const book = { id: 'b', title: 'Книга', entries: { '1.jpg': Buffer.from('one'), '2.jpg': Buffer.from('two') }, items: [
    { id: '1', chapter: 'Начало', chapterIndex: 1, sourceType: 'embedded', archivePath: '1.jpg', originalName: '1.jpg' },
    { id: '2', chapter: 'Финал', chapterIndex: 2, sourceType: 'embedded', archivePath: '2.jpg', originalName: '2.jpg' }
  ] };
  const result = await buildExport([book], ['b:1', 'b:2'], null, 'flat');
  assert.deepEqual([...result.files.keys()], ['Книга/0001 Начало - 001.jpg', 'Книга/0002 Финал - 001.jpg']);
  assert.equal(result.imageCount, 2);
});
test('both layouts share one downloaded original and create two complete structures in ZIP', async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]); let calls = 0;
  const book = { id: 'b', title: 'Книга', entries: {}, items: [{ id: '1', chapter: 'Начало', chapterIndex: 1, sourceType: 'remote', url: 'https://images.novelpia.com/one.file', originalName: 'one.file' }] };
  const result = await buildExport([book], ['b:1'], async () => { calls++; return { data: png }; }, 'both');
  assert.equal(calls, 1); assert.equal(result.imageCount, 1);
  const zipped = unzipSync(makeZip(result.files));
  assert.deepEqual(Object.keys(zipped), ['Книга/По главам/0001 Начало/001.png', 'Книга/Все иллюстрации/0001 Начало - 001.png']);
  for (const value of Object.values(zipped)) assert.deepEqual(value, png);
  await assert.rejects(buildExport([book], ['b:1'], null, 'unknown'), /структур/);
});
test('duplicate titles cannot collide with natural suffixes or Windows letter casing', async () => {
  const books = ['Книга', 'Книга', 'Книга (2)', 'книга'].map((title, i) => ({ id: String(i), title, entries: { 'a.jpg': Buffer.from(String(i)) }, items: [{ id: 'a', chapter: 'Глава', chapterIndex: 1, sourceType: 'embedded', archivePath: 'a.jpg', originalName: 'a.jpg' }] }));
  for (const layout of ['flat', 'both']) {
    const result = await buildExport(books, books.map(book => `${book.id}:a`), null, layout);
    assert.equal(result.files.size, layout === 'both' ? 8 : 4);
    assert.equal(new Set([...result.files.keys()].map(name => name.toLowerCase())).size, result.files.size);
    assert.deepEqual(new Set([...result.files.values()].map(value => Buffer.from(value).toString())), new Set(['0','1','2','3']));
  }
});
