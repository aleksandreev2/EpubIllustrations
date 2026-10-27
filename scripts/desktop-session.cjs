const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { matchesTarget } = require('./capture-target.cjs');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startDesktopSession({ userData, outputDirectory }) {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const marker = `--epub-capture-session=${randomUUID()}`;
  const packaged = Boolean(process.env.EPUB_CAPTURE_EXECUTABLE);
  const executable = process.env.EPUB_CAPTURE_EXECUTABLE || require('electron');
  const args = [...(packaged ? [] : [root]), `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--enable-automation', marker];
  const child = spawn(executable, args, { cwd: root, windowsHide: true, env: { ...process.env, EPUB_ILLUSTRATIONS_USER_DATA: userData, ILLUSTRATION_EXPORT_DIR: outputDirectory }, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '', startupError, socket, sequence = 0, closed = false;
  child.stderr.on('data', value => { log = (log + value).slice(-4000); });
  child.on('error', error => { startupError = error; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { socket.removeEventListener('message', handler); reject(Error(`Timed out: ${method}`)); }, 20000);
    function handler(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer); socket.removeEventListener('message', handler);
      message.error ? reject(Error(message.error.message)) : resolve(message.result);
    }
    socket.addEventListener('message', handler); socket.send(JSON.stringify({ id, method, params }));
  });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async function close() {
    if (closed) return; closed = true;
    try { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' })); } catch {}
    for (let attempt = 0; attempt < 50 && child.exitCode === null; attempt++) await delay(100);
    socket?.close(); if (child.exitCode === null) child.kill();
  }
  try {
    let target;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw Error(`Electron stopped: ${log}`);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => matchesTarget(item, root, packaged)); } catch {}
      if (target) break;
      await delay(250);
    }
    if (!target) throw Error(`Electron debugger unavailable: ${log}`);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    if (!(await send('Browser.getBrowserCommandLine')).arguments?.includes(marker)) throw Error('Debugger belongs to a different process');
    await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if (await evaluate('Boolean(window.illustrations && typeof state !== "undefined" && state.ready)')) { ready = true; break; } } catch {}
      await delay(100);
    }
    if (!ready) throw Error('Application did not become ready; no screenshots captured');
    return { evaluate, close, async capture(file) {
      await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const result = await send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(file, Buffer.from(result.data, 'base64'));
    } };
  } catch (error) { await close(); throw error; }
}
module.exports = { startDesktopSession };
