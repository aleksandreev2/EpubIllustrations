const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startDesktopSession } = require('./desktop-session.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const demos = require('./create-demo.cjs');
  const data = await fs.mkdtemp(path.join(root, 'qa-folder-name-'));
  const input = path.join(data, 'second-copy.epub'); await fs.copyFile(demos[0], input);
  const options = { userData: data, outputDirectory: path.join(data, 'output') };
  let session;
  try {
    session = await startDesktopSession(options);
    await session.evaluate(`addBooks(api.addBooks(${JSON.stringify([demos[0], input])}))`);
    const initial = await session.evaluate('state.books.map(book=>({id:book.id,title:book.title}))');
    assert.equal(initial[0].title, initial[1].title);
    for (let index = 0; index < 2; index++) {
      const name = index ? 'Иллюстрации — второй том' : 'Иллюстрации — первый том';
      await session.evaluate(`(async()=>{document.querySelectorAll('.rename-book')[${index}].click();document.getElementById('folder-name-input').value=${JSON.stringify(name)};document.getElementById('folder-name-input').dispatchEvent(new Event('input'));document.getElementById('save-folder-name').click();for(let i=0;i<100&&document.getElementById('folder-name-modal').open;i++)await new Promise(r=>setTimeout(r,20));if(document.getElementById('folder-name-modal').open)throw Error(document.getElementById('folder-name-error').textContent||'Folder name did not save');})()`);
    }
    assert.deepEqual(await session.evaluate('state.books.map(book=>book.exportName)'), ['Иллюстрации — первый том', 'Иллюстрации — второй том']);
    assert.deepEqual(await session.evaluate('state.books.map(book=>({id:book.id,title:book.title}))'), initial);
    await session.evaluate('state.selected=new Set(state.books.map(book=>key(book,book.items.find(item=>!item.isCover))));render()');
    const selection = await session.evaluate('[...state.selected]');
    for (const layout of ['chapters', 'flat', 'both']) await session.evaluate(`(async()=>{state.exportLayout=${JSON.stringify(layout)};await api.setExportLayout(state.exportLayout);await exportSelected('folder')})()`);
    assert.deepEqual((await fs.readdir(options.outputDirectory)).sort(), ['Иллюстрации — второй том', 'Иллюстрации — первый том'].sort());
    assert.equal(await session.evaluate('state.history.length'), 3);
    assert.deepEqual(await session.evaluate('state.history[0].sources.map(source=>source.folderName)'), ['Иллюстрации — первый том', 'Иллюстрации — второй том']);
    await session.close(); session = await startDesktopSession(options);
    assert.deepEqual(await session.evaluate('state.books.map(book=>book.exportName).sort()'), ['Иллюстрации — первый том', 'Иллюстрации — второй том'].sort());
    assert.deepEqual((await session.evaluate('[...state.selected]')).sort(), selection.sort());
    const first = initial[0].id;
    await session.evaluate(`state.activeBook=${JSON.stringify(first)};render();document.getElementById('edit-book-folder').click();document.getElementById('folder-name-input').value='Моя коллекция';document.getElementById('folder-name-input').dispatchEvent(new Event('input'));state.outputDirectory='D:\\\\Иллюстрации';updateExportBar();document.getElementById('toast').classList.add('hidden')`);
    await session.capture(path.join(root, 'docs/images/folder-name.png'));
    await session.evaluate('document.getElementById("cancel-folder-name").click()');
    assert.equal(await session.evaluate('state.books.find(book=>book.id===state.activeBook).exportName'), 'Иллюстрации — первый том');
    await session.evaluate('document.getElementById("edit-book-folder").click();document.getElementById("folder-name-input").value="../escape";document.getElementById("folder-name-input").dispatchEvent(new Event("input"))');
    assert.equal(await session.evaluate('document.getElementById("save-folder-name").disabled'), true);
    await session.evaluate('(async()=>{document.getElementById("reset-folder-name").click();document.getElementById("save-folder-name").click();for(let i=0;i<100&&document.getElementById("folder-name-modal").open;i++)await new Promise(r=>setTimeout(r,20))})()');
    assert.equal(await session.evaluate('state.books.find(book=>book.id===state.activeBook).exportName'), '');
    assert.equal(await session.evaluate('state.history[0].sources.find(source=>source.id===state.activeBook).folderName'), 'Иллюстрации — первый том');
    await session.close();
    const saved = JSON.parse(await fs.readFile(path.join(data, 'library.json'), 'utf8'));
    const second = initial[1].id;
    const source = saved.books.find(book => book.id === second); await fs.rename(source.filePath, source.filePath + '.moved');
    try {
      session = await startDesktopSession(options);
      assert.equal(await session.evaluate(`state.books.find(book=>book.id===${JSON.stringify(second)}).exportName`), 'Иллюстрации — второй том');
      assert.equal(await session.evaluate(`state.books.find(book=>book.id===${JSON.stringify(second)}).missing`), true);
      await fs.rename(source.filePath + '.moved', source.filePath);
      await session.evaluate(`addBooks(api.addBooks([${JSON.stringify(source.filePath)}]))`);
      assert.equal(await session.evaluate(`state.books.find(book=>book.id===${JSON.stringify(second)}).exportName`), 'Иллюстрации — второй том');
      assert.equal(await session.evaluate(`state.books.find(book=>book.id===${JSON.stringify(second)}).missing`), false);
    } finally { try { await fs.access(source.filePath + '.moved'); await fs.rename(source.filePath + '.moved', source.filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    console.log('Duplicate titles, per-book folders, all layouts, history, restart, cancel, validation and reset verified.');
  } finally {
    await session?.close();
    if (!path.resolve(data).startsWith(root + path.sep) || !path.basename(data).startsWith('qa-folder-name-')) throw Error('Unsafe test cleanup');
    await fs.rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
