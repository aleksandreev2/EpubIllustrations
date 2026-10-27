const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createLibraryStore } = require('../src/library');
test('recovering an EPUB cannot undo a selection changed while its metadata was saving', async t => {
  const base = path.resolve(os.tmpdir()), dir = await fs.mkdtemp(path.join(base, 'epub-recovery-'));
  t.after(async () => { assert.ok(path.resolve(dir).startsWith(base + path.sep)); await fs.rm(dir, { recursive: true, force: true }); });
  const library = createLibraryStore(path.join(dir, 'library.json')); await library.load();
  const book = { id: 'recover', filePath: path.join(dir, 'book.epub'), filename: 'book.epub', title: 'Книга', fingerprint: { sha256: 'same' }, items: [{ id: '1' }, { id: '2' }] };
  await library.recordBook({ ...book, count: 2 }); await library.recordBook({ ...book, id: 'other' });
  await library.setSelection(['other:1', 'recover:1']);
  const source = path.join(__dirname, '..', 'src'); const module = { exports: {} };
  const code = await fs.readFile(path.join(source, 'main.js'), 'utf8');
  vm.runInNewContext(code + '\nmodule.exports={useLibrary(value){library=value},rememberImportedBook,books};', { module, Buffer, console, __dirname: source, process: { env: {}, platform: 'win32' },
    require(name) { if (name === 'electron') return { app: { whenReady: () => new Promise(() => {}), on() {} }, ipcMain: { handle() {} } }; return name.startsWith('./') ? require(path.join(source, name)) : require(name); }
  });
  module.exports.useLibrary(library); module.exports.books.set(book.id, book);
  let release;
  const gate = new Promise(resolve => { release = resolve; }); const record = library.recordBook;
  library.recordBook = async value => { await gate; return record(value); };
  const recovery = module.exports.rememberImportedBook(book, book);
  await library.setSelection(['recover:1']);
  release(); await recovery;
  assert.deepEqual(library.snapshot().selected, ['recover:1']);
});
