const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { buildExport, makeZip, imageFormat, safePart } = require('../src/export');

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
