const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { scanEpub } = require('./epub');
const { buildExport, makeZip, imageFormat } = require('./export');

const books = new Map();
const remoteCache = new Map();
let window;
let outputDirectory;

function publicBook(book) {
  return { id: book.id, title: book.title, filename: book.filename, items: book.items };
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }

async function loadSettings() {
  const fallback = process.env.ILLUSTRATION_EXPORT_DIR || path.join(app.getPath('desktop'), 'вытянуть иллюстрации новелпиа');
  try {
    const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    outputDirectory = typeof saved.outputDirectory === 'string' ? saved.outputDirectory : fallback;
  } catch { outputDirectory = fallback; }
}

async function saveSettings() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify({ outputDirectory }), 'utf8');
}

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.local') || h === '::1' ||
    /^(?:127|10|0|169\.254|192\.168)\./.test(h) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(h);
}

async function downloadRemote(initialUrl) {
  if (remoteCache.has(initialUrl)) return remoteCache.get(initialUrl);
  const task = (async () => {
    let current = initialUrl;
    for (let redirect = 0; redirect < 4; redirect++) {
      const url = new URL(current);
      if (url.protocol !== 'https:' || isPrivateHost(url.hostname)) throw Error('допускаются только публичные HTTPS-ссылки');
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Mozilla/5.0 EPUB-Illustrations/1.0', Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw Error('пустое перенаправление');
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw Error(`сервер ответил ${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (declared > 30 * 1024 * 1024) throw Error('изображение больше 30 МБ');
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 30 * 1024 * 1024) throw Error('изображение больше 30 МБ');
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      const contentType = response.headers.get('content-type') || '';
      if (!imageFormat(data, contentType, url.pathname)) throw Error('ссылка вернула не изображение');
      return { data, contentType };
    }
    throw Error('слишком много перенаправлений');
  })();
  remoteCache.set(initialUrl, task);
  try { return await task; } catch (error) { remoteCache.delete(initialUrl); throw error; }
}

async function addBooks(paths) {
  const added = [];
  const errors = [];
  for (const filePath of [...new Set(paths)].slice(0, 30)) {
    try {
      if (path.extname(filePath).toLowerCase() !== '.epub') throw Error('нужен файл EPUB');
      const existing = [...books.values()].find(book => book.filePath.toLowerCase() === filePath.toLowerCase());
      if (existing) { added.push(publicBook(existing)); continue; }
      const data = await fs.readFile(filePath);
      const book = { id: randomUUID(), filePath, ...scanEpub(data, path.basename(filePath)) };
      books.set(book.id, book);
      added.push(publicBook(book));
    } catch (error) { errors.push(`${path.basename(filePath)}: ${error.message}`); }
  }
  return { added, errors };
}

async function writeUnique(target, data) {
  const ext = path.extname(target);
  const stem = target.slice(0, -ext.length);
  for (let attempt = 1; attempt < 1000; attempt++) {
    const candidate = attempt === 1 ? target : `${stem} (${attempt})${ext}`;
    try {
      await fs.writeFile(candidate, data, { flag: 'wx' });
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw Error('слишком много одноимённых файлов');
}

function createWindow() {
  window = new BrowserWindow({
    width: 1320, height: 850, minWidth: 870, minHeight: 620,
    backgroundColor: '#f4f6fa', title: 'Иллюстрации EPUB', icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, 'index.html'));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(async () => {
  await loadSettings();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('state', () => ({ books: [...books.values()].map(publicBook), outputDirectory, version: app.getVersion() }));
ipcMain.handle('open-link', async (_, name) => {
  const links = {
    repository: 'https://github.com/aleksandreev2/EpubIllustrations',
    developer: 'https://ranobelib.me/ru/user/726236',
    team: 'https://ranobelib.me/ru/team/11969--dom-nekromanta'
  };
  if (!Object.hasOwn(links, name)) throw Error('неизвестная ссылка');
  await require('electron').shell.openExternal(links[name]);
});
ipcMain.handle('choose-books', async () => {
  const choice = await dialog.showOpenDialog(window, { title: 'Добавить EPUB', properties: ['openFile', 'multiSelections'], filters: [{ name: 'EPUB', extensions: ['epub'] }] });
  return choice.canceled ? { added: [], errors: [] } : addBooks(choice.filePaths);
});
ipcMain.handle('add-books', (_, paths) => addBooks(Array.isArray(paths) ? paths.filter(p => typeof p === 'string') : []));
ipcMain.handle('remove-book', (_, id) => books.delete(id));
ipcMain.handle('choose-directory', async () => {
  const choice = await dialog.showOpenDialog(window, { title: 'Папка для иллюстраций', defaultPath: outputDirectory, properties: ['openDirectory', 'createDirectory'] });
  if (!choice.canceled && choice.filePaths[0]) {
    outputDirectory = choice.filePaths[0];
    await saveSettings();
  }
  return outputDirectory;
});
ipcMain.handle('preview', async (_, bookId, itemId) => {
  const book = books.get(bookId);
  const item = book?.items.find(image => image.id === itemId);
  if (!item) throw Error('иллюстрация не найдена');
  const response = item.sourceType === 'embedded'
    ? { data: book.entries[item.archivePath], contentType: '' }
    : await downloadRemote(item.url);
  const format = imageFormat(response.data, response.contentType, item.originalName, item.sourceType === 'embedded');
  if (!format) throw Error('не удалось прочитать изображение');
  return `data:${format.mime};base64,${Buffer.from(response.data).toString('base64')}`;
});
ipcMain.handle('export', async (_, mode, selectedKeys) => {
  if (!['folder', 'zip'].includes(mode) || !Array.isArray(selectedKeys)) throw Error('неверные параметры экспорта');
  if (!selectedKeys.length) throw Error('выберите хотя бы одну иллюстрацию');
  let destination = outputDirectory;
  if (mode === 'zip') {
    const choice = await dialog.showSaveDialog(window, { title: 'Сохранить ZIP', defaultPath: path.join(outputDirectory, 'Иллюстрации EPUB.zip'), filters: [{ name: 'ZIP архив', extensions: ['zip'] }] });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    destination = choice.filePath;
  }
  const { files, errors } = await buildExport([...books.values()], selectedKeys, downloadRemote);
  if (!files.size) return { count: 0, errors, destination: null };
  if (mode === 'zip') {
    await fs.writeFile(destination, makeZip(files));
  } else {
    await fs.mkdir(destination, { recursive: true });
    for (const [relative, data] of files) {
      const fullPath = path.join(destination, ...relative.split('/'));
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await writeUnique(fullPath, data);
    }
  }
  return { count: files.size, errors, destination };
});
ipcMain.handle('open-folder', async (_, folder) => {
  const { shell } = require('electron');
  if (folder && typeof folder === 'string') {
    const stat = await fs.stat(folder);
    if (stat.isDirectory()) await shell.openPath(folder);
    else shell.showItemInFolder(folder);
  }
});
