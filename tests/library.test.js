const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createLibraryStore } = require('../src/library');

test('custom folder name survives metadata refresh, restart and reset without changing completed history', async t => {
  const file = await fixture(t), store = createLibraryStore(file);
  await store.recordBook(book()); await store.setExportName('book1', 'Моя коллекция');
  await store.addExport({ ...operation(), sources: [{ ...operation().sources[0], folderName: 'Моя коллекция' }] });
  await store.recordBook({ ...book(), title: 'Новое название в EPUB' });
  const reopened = createLibraryStore(file); await reopened.load();
  assert.equal(reopened.snapshot().books[0].exportName, 'Моя коллекция');
  assert.equal(reopened.snapshot().history[0].sources[0].folderName, 'Моя коллекция');
  await assert.rejects(reopened.setExportName('book1', '../Чужая папка'), /названи|символ/i);
  await assert.rejects(reopened.setExportName('missing', 'Папка'), /книг/i);
  await reopened.setExportName('book1', ''); await reopened.flush();
  assert.equal(reopened.snapshot().books[0].exportName, '');
  assert.equal(reopened.snapshot().history[0].sources[0].folderName, 'Моя коллекция');
});

test('persists encoding preferences and exact settings in history across restart', async t => {
  const file = await fixture(t), store = createLibraryStore(file);
  const imageOptions = { format: 'webp', quality: 82, maxDimension: 1920 };
  await store.setImageOptions(imageOptions);
  await store.addExport({ format: 'folder', layout: 'both', destination: path.resolve('output'), sources: [], imageCount: 2, fileCount: 4, imageOptions, originalBytes: 5000, outputBytes: 1200 });
  const restarted = await createLibraryStore(file).load();
  assert.deepEqual(restarted.imageOptions, imageOptions);
  assert.deepEqual(restarted.history[0].imageOptions, imageOptions);
  assert.equal(restarted.history[0].outputBytes, 1200);
});
async function fixture(t) {
  const root = path.resolve(os.tmpdir()); const dir = await fs.mkdtemp(path.join(root, 'epub-library-'));
  t.after(async () => { const resolved = path.resolve(dir); assert.ok(resolved.startsWith(root + path.sep)); await fs.rm(resolved, { recursive: true, force: true }); });
  return path.join(dir, 'library.json');
}
const book = () => ({ id: 'book1', filePath: path.resolve('demo.epub'), filename: 'demo.epub', title: 'Демонстрационная книга', count: 3, fingerprint: { size: 1234, mtimeMs: 1000 } });
const operation = () => ({ format: 'zip', layout: 'both', imageCount: 2, fileCount: 4, destination: path.resolve('output.zip'), sources: [{ id: 'book1', title: 'Демонстрационная книга', filePath: path.resolve('demo.epub') }], errors: [] });
test('library, selected images, export layout and completed history survive reopening', async t => {
  const file = await fixture(t); const library = createLibraryStore(file); await library.load();
  await library.recordBook(book()); await library.setSelection(['book1:1', 'book1:2']); await library.setLayout('both');
  const record = await library.addExport(operation()); await library.flush();
  const restored = createLibraryStore(file); await restored.load(); const snapshot = restored.snapshot();
  assert.equal(snapshot.books[0].title, book().title);
  assert.deepEqual(snapshot.selected, ['book1:1', 'book1:2']); assert.equal(snapshot.layout, 'both');
  assert.equal(snapshot.history[0].id, record.id); assert.equal(snapshot.history[0].fileCount, 4);
  assert.equal(snapshot.history[0].destination, operation().destination);
});
test('removing a book keeps its completed export history and cleans its selection', async t => {
  const library = createLibraryStore(await fixture(t)); await library.load(); await library.recordBook(book());
  await library.setSelection(['book1:1']); await library.addExport(operation()); await library.removeBook('book1');
  assert.equal(library.snapshot().books.length, 0); assert.deepEqual(library.snapshot().selected, []);
  assert.equal(library.snapshot().history.length, 1);
});
test('concurrent history writes remain complete and invalid layout is rejected', async t => {
  const file = await fixture(t); const library = createLibraryStore(file); await library.load();
  await Promise.all([library.addExport(operation()), library.addExport(operation())]); await library.flush();
  const restored = createLibraryStore(file); await restored.load(); assert.equal(restored.snapshot().history.length, 2);
  await assert.rejects(library.setLayout('invalid'), /структур/);
});
test('corrupt history is preserved before a fresh library is used', async t => {
  const file = await fixture(t); await fs.writeFile(file, '{corrupt');
  const library = createLibraryStore(file); await library.load();
  assert.equal(library.snapshot().books.length, 0); assert.ok(library.snapshot().warning);
  const backup = (await fs.readdir(path.dirname(file))).find(name => name.includes('.corrupt-'));
  assert.ok(backup); assert.equal(await fs.readFile(path.join(path.dirname(file), backup), 'utf8'), '{corrupt');
});
test('quit flushing drains mutations started immediately before flush was requested', async t => {
  const file = await fixture(t); const library = createLibraryStore(file); await library.load(); await library.recordBook(book());
  const change = library.setLayout('flat');
  await library.flush();
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).layout, 'flat');
  await change;
});
