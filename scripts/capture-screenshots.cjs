const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startDesktopSession } = require('./desktop-session.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const demos = require('./create-demo.cjs');
  const output = path.join(root, 'docs', 'images'); await fs.mkdir(output, { recursive: true });
  const data = await fs.mkdtemp(path.join(root, 'qa-capture-'));
  const inputs = path.join(data, 'inputs'); await fs.mkdir(inputs);
  const files = [];
  for (const demo of demos) { const file = path.join(inputs, path.basename(demo)); await fs.copyFile(demo, file); files.push(file); }
  const options = { userData: data, outputDirectory: path.join(data, 'output') };
  let session;
  try {
    session = await startDesktopSession(options);
    const capture = async name => { await session.capture(path.join(output, name)); console.log(name); };
    await capture('welcome.png');
    await session.evaluate(`addBooks(window.illustrations.addBooks(${JSON.stringify(files)}))`);
    await session.evaluate('state.outputDirectory="D:\\\\Иллюстрации";updateExportBar();document.getElementById("toast").classList.add("hidden");Promise.all([...document.querySelectorAll(".image-card")].map(card=>card.loadPreview()))');
    await capture('gallery.png');
    await session.evaluate('openModal(state.books[0],state.books[0].items[2])'); await capture('viewer.png');
    const viewer = await session.evaluate('(()=>{const initial=viewer.scale;document.getElementById("zoom-in").click();const zoomWorks=viewer.scale>initial;document.getElementById("rotate-right").click();const rotateWorks=viewer.rotation===90;document.getElementById("actual-size").click();return {zoomWorks,rotateWorks,actualWorks:viewer.scale===1}})()');
    assert.ok(Object.values(viewer).every(Boolean));
    await session.evaluate('closeModal();document.getElementById("about-button").click();checkAppUpdates(true)'); await capture('about.png');
    const credits = await session.evaluate('document.getElementById("about-modal").innerText');
    assert.ok(credits.includes('dollar') && credits.includes('Дом Некроманта'));
    const updates = await session.evaluate('(()=>{const original=updateSnapshot;renderUpdateState({...original,status:"available",enabled:true,notify:true,release:{version:"9.9.9",asset:{name:"demo.exe"}}},true);const banner=!document.getElementById("update-notice").hidden;renderUpdateProgress({percent:42});const progress=document.getElementById("update-progress").value===42;renderUpdateState({...original,status:"unavailable",message:"Проверка сети: тест"});const offline=document.getElementById("update-status").textContent.includes("Проверка сети: тест");renderUpdateState(original);document.getElementById("update-progress").hidden=true;document.getElementById("about-modal").classList.add("hidden");return {banner,progress,offline}})()');
    assert.ok(Object.values(updates).every(Boolean));
    await session.evaluate('state.selected=new Set([...state.books[0].items.filter(item=>!item.isCover).slice(0,2).map(item=>key(state.books[0],item)),...state.books[1].items.filter(item=>!item.isCover).slice(0,1).map(item=>key(state.books[1],item))]);render()');
    for (const layout of ['chapters', 'flat', 'both']) {
      await session.evaluate(`(async()=>{state.exportLayout=${JSON.stringify(layout)};document.getElementById('export-layout').value=state.exportLayout;await api.setExportLayout(state.exportLayout);await exportSelected('folder')})()`);
    }
    const result = await session.evaluate('({history:state.history.length,counts:state.history.map(record=>[record.imageCount,record.fileCount]),selected:state.selected.size})');
    assert.equal(result.history, 3); assert.deepEqual(result.counts, [[3,6],[3,3],[3,3]]); assert.equal(result.selected, 3);
    assert.equal((await fs.readdir(options.outputDirectory, { recursive: true })).filter(file => file.endsWith('.svg')).length, 12);
    await session.evaluate('state.history=state.history.map(record=>({...record,destination:"D:\\\\Иллюстрации"}));state.view="history";document.getElementById("toast").classList.add("hidden");render()');
    await capture('history.png');
    await session.close();
    const stored = JSON.parse(await fs.readFile(path.join(data, 'library.json'), 'utf8'));
    assert.equal(stored.books.length, 2); assert.equal(stored.history.length, 3); assert.equal(stored.selected.length, 3); assert.equal(stored.layout, 'both');
    const moved = files[1] + '.moved'; await fs.rename(files[1], moved);
    session = await startDesktopSession(options);
    const restored = await session.evaluate('({books:state.books.length,history:state.history.length,selected:state.selected.size,unavailable:(state.unavailableSelected||new Set()).size,layout:state.exportLayout,missing:state.books.filter(book=>book.missing).length})');
    assert.deepEqual(restored, { books: 2, history: 3, selected: 2, unavailable: 1, layout: 'both', missing: 1 });
    const kept = await session.evaluate('(async()=>{document.querySelector(".card-check").click();document.querySelector(".card-check").click();const saved=await api.state();return saved.selected.filter(key=>saved.books.find(book=>book.missing&&key.startsWith(book.id+":"))).length})()');
    assert.equal(kept, 1);
    await fs.rename(moved, files[1]);
    await fs.utimes(files[1], new Date(), new Date());
    await session.evaluate(`addBooks(api.addBooks([${JSON.stringify(files[1])}]))`);
    assert.equal(await session.evaluate('state.books.filter(book=>book.missing).length'), 0);
    assert.equal(await session.evaluate('state.selected.size'), 3, 'Recovering a missing source must preserve its selected subset');
    await session.close(); await fs.rename(files[1], moved);
    session = await startDesktopSession(options);
    await fs.rename(moved, files[1]);
    await session.evaluate(`(async()=>{const result=await api.addBooks([${JSON.stringify(files[1])}]);let deliver;const pending=new Promise(resolve=>{deliver=resolve});const completion=addBooks(pending);document.getElementById('clear-selection').click();deliver(result);await completion})()`);
    assert.equal(await session.evaluate('state.selected.size'), 0, 'An intentionally empty subset must stay empty after recovery');
    assert.equal((await session.evaluate('api.state()')).selected.length, 0, 'Clear-all must also clear unavailable selections');
    const newFile = path.join(inputs, 'new-demo.epub'); await fs.copyFile(files[0], newFile);
    await session.evaluate(`(async()=>{let deliver;const pending=new Promise(resolve=>{deliver=resolve});const completion=addBooks(pending);document.getElementById('clear-selection').click();const result=await api.addBooks([${JSON.stringify(newFile)}]);deliver(result);await completion})()`);
    assert.equal(await session.evaluate('state.selected.size'), 0);
    assert.equal((await session.evaluate('api.state()')).selected.length, 0, 'Clear-all during new import must correct backend default marks');
    console.log('Viewer, updates, all export layouts, persistent history/selection, restart and missing-source recovery verified.');
  } finally {
    await session?.close();
    const resolved = path.resolve(data);
    if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('qa-capture-')) throw Error('Unsafe capture cleanup path');
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
