const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { matchesTarget } = require('./capture-target.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'images');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const demos = require('./create-demo.cjs');
  await fs.mkdir(output, { recursive: true });
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const sessionArgument = `--epub-capture-session=${randomUUID()}`;
  const executable = process.env.EPUB_CAPTURE_EXECUTABLE || require('electron');
  const args = [...(process.env.EPUB_CAPTURE_EXECUTABLE ? [] : [root]), `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--enable-automation', sessionArgument];
  const child = spawn(executable, args, { cwd: root, windowsHide: true, env: { ...process.env, ILLUSTRATION_EXPORT_DIR: 'D:\\Иллюстрации' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let startupLog = '';
  let startupError;
  child.on('error', error => { startupError = error; });
  child.stderr.on('data', data => { startupLog = (startupLog + data.toString()).slice(-4000); });
  let socket;
  try {
    let target;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw Error(`Electron stopped: ${startupLog}`);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => matchesTarget(item, root, Boolean(process.env.EPUB_CAPTURE_EXECUTABLE))); } catch {}
      if (target) break;
      await delay(250);
    }
    if (!target) throw Error(`Electron debugger unavailable: ${startupLog}`);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { socket.removeEventListener('message', handler); reject(Error(`Timed out: ${method}`)); }, 20000);
        function handler(event) {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          clearTimeout(timer);
          socket.removeEventListener('message', handler);
          message.error ? reject(Error(message.error.message)) : resolve(message.result);
        }
        socket.addEventListener('message', handler);
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
      return result.result?.value;
    }
    async function capture(filename) {
      await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const result = await send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(output, filename), Buffer.from(result.data, 'base64'));
      console.log(filename);
    }
    const commandLine = await send('Browser.getBrowserCommandLine');
    if (!commandLine.arguments?.includes(sessionArgument)) throw Error('Debugger does not belong to this screenshot session');
    await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if (await evaluate('Boolean(window.illustrations && typeof state !== "undefined" && state.outputDirectory)')) { ready = true; break; } } catch {}
      await delay(100);
    }
    if (!ready) throw Error('Application did not become ready; no screenshots captured');
    await capture('welcome.png');
    await evaluate(`addBooks(window.illustrations.addBooks(${JSON.stringify(demos)}))`);
    await evaluate('state.outputDirectory="D:\\\\Иллюстрации";updateExportBar();document.getElementById("toast").classList.add("hidden");Promise.all([...document.querySelectorAll(".image-card")].map(card=>card.loadPreview()))');
    await capture('gallery.png');
    await evaluate('openModal(state.books[0],state.books[0].items[2])');
    await capture('viewer.png');
    const viewerChecks = await evaluate('(()=>{const initial=viewer.scale;document.getElementById("zoom-in").click();const zoomWorks=viewer.scale>initial;document.getElementById("rotate-right").click();const rotateWorks=viewer.rotation===90;document.getElementById("actual-size").click();return {zoomWorks,rotateWorks,actualWorks:viewer.scale===1}})()');
    if (!Object.values(viewerChecks).every(Boolean)) throw Error(`Viewer verification failed: ${JSON.stringify(viewerChecks)}`);
    await evaluate('closeModal();document.getElementById("about-button").click()');
    await capture('about.png');
    const credits = await evaluate('document.getElementById("about-modal").innerText');
    if (!credits.includes('dollar') || !credits.includes('Дом Некроманта')) throw Error('Developer credits missing');
    console.log('Viewer and developer credits verified.');
  } finally {
    socket?.close();
    child.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
