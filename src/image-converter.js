const path = require('node:path');
const { normalizeImageOptions } = require('./image-options');

function createImageConverter(BrowserWindow) {
  let window, ready;
  async function convert(data, format, settings) {
    const options = normalizeImageOptions(settings);
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: {
        sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
        partition: 'epub-image-conversion'
      } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
      window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (details, callback) => {
        const allowed = details.url.startsWith('file:') && ['converter.html', 'converter.js', 'image-options.js'].includes(path.basename(new URL(details.url).pathname));
        callback({ cancel: !allowed });
      });
      ready = window.loadFile(path.join(__dirname, 'converter.html'));
    }
    const worker = window;
    try {
      await ready;
      const args = [Buffer.from(data).toString('base64'), format.mime, options];
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { if (!worker.isDestroyed()) worker.destroy(); reject(Error('Преобразование заняло слишком много времени.')); }, 45000); });
      try {
        const encoded = await Promise.race([worker.webContents.executeJavaScript(`window.convertIllustration(...${JSON.stringify(args)})`), timeout]);
        return Buffer.from(encoded, 'base64');
      } finally { clearTimeout(timer); }
    } catch (error) {
      if (!worker.isDestroyed()) worker.destroy();
      throw error;
    }
  }
  return { convert, close() { if (window && !window.isDestroyed()) window.destroy(); window = null; ready = null; } };
}
module.exports = { createImageConverter };
