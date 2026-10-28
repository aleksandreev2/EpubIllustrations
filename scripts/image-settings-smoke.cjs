const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startDesktopSession } = require('./desktop-session.cjs');
const { imageFormat } = require('../src/export');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const root = path.resolve(__dirname, '..');
async function main() {
  const files = require('./create-demo.cjs');
  const data = await fs.mkdtemp(path.join(root, 'qa-image-settings-'));
  const expanded = unzipSync(await fs.readFile(files[0]));
  for (const name of Object.keys(expanded).filter(name => name.endsWith('.svg'))) expanded[name] = strToU8(strFromU8(expanded[name]).replace('width="900" height="1200"', 'width="1800" height="2400"'));
  const input = path.join(data, 'large-demo.epub'); await fs.writeFile(input, zipSync(expanded));
  const options = { userData: data, outputDirectory: path.join(data, 'output') };
  let session;
  try {
    session = await startDesktopSession(options);
    await session.evaluate(`addBooks(api.addBooks([${JSON.stringify(input)}]))`);
    await session.evaluate('state.selected=new Set([key(state.books[0],state.books[0].items.find(item=>!item.isCover))]);render()');
    const originalKeys = await session.evaluate('[...state.selected]');
    const sourceBook = await session.evaluate('state.books[0].id');
    for (const format of ['webp', 'jpeg', 'png']) {
      await session.evaluate(`(async()=>{document.getElementById('image-settings-button').click();document.getElementById('image-format').value=${JSON.stringify(format)};document.getElementById('image-format').dispatchEvent(new Event('change'));document.getElementById('image-quality').value=82;document.getElementById('image-quality').dispatchEvent(new Event('input'));document.getElementById('image-max-dimension').value=1280;document.getElementById('save-image-settings').click();for(let i=0;i<100&&document.getElementById('image-settings-modal').open;i++)await new Promise(r=>setTimeout(r,20));if(document.getElementById('image-settings-modal').open)throw Error(document.getElementById('image-settings-error').textContent||'Settings did not save');await exportSelected('folder')})()`);
      const current = await session.evaluate('({options:state.imageOptions,history:state.history[0],selected:[...state.selected]})');
      assert.equal(current.options.format, format); assert.equal(current.history.imageOptions.format, format); assert.deepEqual(current.selected, originalKeys);
      assert.equal(current.history.sources[0].id, sourceBook);
      const extension = format === 'jpeg' ? 'jpg' : format;
      const exported = (await fs.readdir(options.outputDirectory, { recursive: true })).filter(file => file.endsWith('.' + extension));
      assert.equal(exported.length, 1); const bytes = await fs.readFile(path.join(options.outputDirectory, exported[0])); assert.equal(imageFormat(bytes).ext, extension);
      const size = await session.evaluate(`(async()=>{const image=new Image();image.src='data:image/${format};base64,${bytes.toString('base64')}';await image.decode();return {width:image.naturalWidth,height:image.naturalHeight}})()`);
      assert.equal(Math.max(size.width, size.height), 1280);
    }
    await session.evaluate('document.getElementById("image-settings-button").click();document.getElementById("image-format").value="webp";document.getElementById("image-format").dispatchEvent(new Event("change"));document.getElementById("image-quality").value=85;document.getElementById("image-quality").dispatchEvent(new Event("input"))');
    await session.evaluate('state.outputDirectory="D:\\\\Иллюстрации";updateExportBar();document.getElementById("toast").classList.add("hidden")');
    await session.capture(path.join(root, 'docs/images/format-quality.png'));
    await session.evaluate('document.getElementById("cancel-image-settings").click()');
    assert.equal(await session.evaluate('state.imageOptions.format'), 'png', 'Cancelling a draft must not change saved preferences');
    const layout = await session.evaluate('(()=>{const bounds=document.getElementById("export-bar").getBoundingClientRect();return {right:bounds.right,width:innerWidth,settingsVisible:document.getElementById("image-settings-button").getBoundingClientRect().width>0}})()');
    assert.ok(layout.right <= layout.width && layout.settingsVisible);
    await session.close(); session = await startDesktopSession(options);
    assert.deepEqual(await session.evaluate('state.imageOptions'), { format: 'png', quality: 82, maxDimension: 1280 });
    assert.equal(await session.evaluate('state.history.length'), 3);
    assert.match(await session.evaluate('state.history.map(item=>ImageOptions.describeImageOptions(item.imageOptions)).join(";")'), /WebP.*JPEG.*PNG|PNG.*JPEG.*WebP/);
    console.log('Format/quality dialog, WebP/JPEG/PNG folder export, resizing, cancel, history and restart verified.');
  } finally {
    await session?.close();
    if (!path.resolve(data).startsWith(root + path.sep) || !path.basename(data).startsWith('qa-image-settings-')) throw Error('Unsafe test cleanup');
    await fs.rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
