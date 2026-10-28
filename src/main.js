const { app, BrowserWindow, dialog, ipcMain, shell, Notification } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { scanEpub } = require('./epub');
const { buildExport, makeZip, imageFormat, safePart } = require('./export');
const { initializeUpdates } = require('./update-runtime');
const { createLibraryStore, LAYOUTS } = require('./library');
const { normalizeImageOptions } = require('./image-options');
const { createImageConverter } = require('./image-converter');
if (process.env.EPUB_ILLUSTRATIONS_USER_DATA && path.isAbsolute(process.env.EPUB_ILLUSTRATIONS_USER_DATA)) app.setPath('userData', process.env.EPUB_ILLUSTRATIONS_USER_DATA);

const books = new Map();
const remoteCache = new Map();
let window;
let outputDirectory;
let updateRuntime;
let importing = 0;
let exporting = false;
let library;
let libraryWarning = '';

function publicBook(book) {
  return { id: book.id, title: book.title, exportName: book.exportName || '', folderName: safePart(book.exportName || book.title), filename: book.filename, items: book.items, missing: Boolean(book.missing), missingReason: book.missingReason || '', count: book.missing ? book.count || 0 : book.items.length };
}
async function readBook(filePath, id = randomUUID()) {
  const stat = await fs.stat(filePath);
  const data = await fs.readFile(filePath);
  return { id, filePath, fingerprint: { size: stat.size, mtimeMs: stat.mtimeMs, sha256: createHash('sha256').update(data).digest('hex') }, ...scanEpub(data, path.basename(filePath)) };
}
function bookRecord(book) { return { id: book.id, filePath: book.filePath, filename: book.filename, title: book.title, count: book.items.length, fingerprint: book.fingerprint }; }
function sameSource(a, b) { return Boolean(a && b && (a.sha256 && b.sha256 ? a.sha256 === b.sha256 : a.size === b.size && a.mtimeMs === b.mtimeMs)); }
async function rememberImportedBook(book, previous) {
  const available = new Set(book.items.map(item => `${book.id}:${item.id}`));
  const defaults = book.items.filter(item => !item.isCover).map(item => `${book.id}:${item.id}`);
  const preserve = Boolean(previous && sameSource(previous.fingerprint, book.fingerprint));
  let warning = previous && !preserve ? 'Содержимое EPUB изменилось: отмечены все иллюстрации глав новой версии.' : '';
  try { await library.recordBook(bookRecord(book)); } catch (error) { warning += ` Метаданные книги не сохранены: ${error.message}`; }
  book.exportName = library.snapshot().books.find(record => record.id === book.id)?.exportName ?? previous?.exportName ?? '';
  let chosen;
  try {
    chosen = await library.mergeSelection({ bookId: book.id, itemKeys: [...available], defaultKeys: defaults, preserve,
      fallback: [...books.values()].flatMap(item => item.items.filter(image => !image.isCover).map(image => `${item.id}:${image.id}`)) });
  } catch (error) {
    warning += ` Выбор не сохранён: ${error.message}`;
    chosen = (library.snapshot().selected || defaults).filter(key => available.has(key));
  }
  return { chosen, warning };
}
async function restoreLibrary() {
  const saved = await library.load(); libraryWarning = saved.warning;
  let selected = saved.selected;
  for (const record of saved.books) {
    try {
      const book = await readBook(record.filePath, record.id); book.exportName = record.exportName || ''; books.set(book.id, book);
      if (JSON.stringify(record.fingerprint) !== JSON.stringify(book.fingerprint)) {
        try { await library.recordBook(bookRecord(book)); } catch (error) { libraryWarning = error.message; }
        if (selected && !sameSource(record.fingerprint, book.fingerprint)) {
          selected = [...selected.filter(key => !key.startsWith(book.id + ':')), ...book.items.filter(item => !item.isCover).map(item => `${book.id}:${item.id}`)];
          if (!libraryWarning) libraryWarning = 'Содержимое одного из EPUB изменилось: его иллюстрации глав отмечены заново.';
        }
      }
    } catch (error) {
      books.set(record.id, { ...record, items: [], missing: true, missingReason: error.code === 'ENOENT' ? 'Исходный EPUB перемещён или удалён.' : 'Не удалось прочитать исходный EPUB.' });
    }
  }
  if (selected) {
    const valid = new Set([...books.values()].flatMap(book => book.items.map(item => `${book.id}:${item.id}`)));
    const missing = new Set([...books.values()].filter(book => book.missing).map(book => book.id));
    selected = selected.filter(key => valid.has(key) || missing.has(key.split(':')[0]));
    try { await library.setSelection(selected); } catch (error) { libraryWarning = error.message; }
  }
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
  if (updateRuntime?.isInstalling()) throw Error('Дождитесь завершения обновления приложения.');
  importing++;
  try { return await scanBooks(paths); } finally { importing--; }
}
async function scanBooks(paths) {
  const added = [];
  const errors = [];
  const selectionByBook = {};
  for (const filePath of [...new Set(paths)].slice(0, 30)) {
    try {
      if (path.extname(filePath).toLowerCase() !== '.epub') throw Error('нужен файл EPUB');
      const existing = [...books.values()].find(book => book.filePath.toLowerCase() === filePath.toLowerCase());
      if (existing && !existing.missing) { added.push(publicBook(existing)); continue; }
      const book = await readBook(filePath, existing?.id);
      books.set(book.id, book);
      const remembered = await rememberImportedBook(book, existing);
      selectionByBook[book.id] = remembered.chosen;
      if (remembered.warning) errors.push(remembered.warning);
      added.push(publicBook(book));
    } catch (error) { errors.push(`${path.basename(filePath)}: ${error.message}`); }
  }
  return { added, errors, selectionByBook };
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
  library = createLibraryStore(path.join(app.getPath('userData'), 'library.json'));
  await restoreLibrary();
  if (process.platform === 'win32') app.setAppUserModelId('local.novelpia.illustrations');
  updateRuntime = initializeUpdates({ app, ipcMain, dialog, shell, Notification, getWindow: () => window, isBusy: () => exporting || importing > 0 });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let flushingQuit = false, savedQuit = false;
app.on('before-quit', event => {
  if (!library || savedQuit) return;
  event.preventDefault();
  if (flushingQuit) return;
  flushingQuit = true;
  library.flush().catch(error => console.error('Library save:', error.message)).finally(() => { savedQuit = true; app.quit(); });
});

ipcMain.handle('state', () => {
  const saved = library.snapshot();
  return { books: [...books.values()].map(publicBook), outputDirectory, version: app.getVersion(), history: saved.history, selected: saved.selected, exportLayout: saved.layout, imageOptions: saved.imageOptions, libraryWarning };
});
ipcMain.handle('library:selection', async (_, keys, clearUnavailable) => {
  if (!Array.isArray(keys)) throw Error('Некорректный выбор иллюстраций.');
  const valid = new Set([...books.values()].flatMap(book => book.items.map(item => `${book.id}:${item.id}`)));
  const missing = new Set([...books.values()].filter(book => book.missing).map(book => book.id));
  const preserved = (library.snapshot().selected || []).filter(key => missing.has(key.split(':')[0]));
  const allowed = new Set([...valid, ...preserved]);
  await library.setSelection([...keys.filter(key => allowed.has(key)), ...(clearUnavailable === true ? [] : preserved)]);
});
ipcMain.handle('library:layout', (_, layout) => library.setLayout(layout));
ipcMain.handle('library:export-name', async (_, id, name) => {
  if (exporting || importing > 0 || updateRuntime?.isInstalling()) throw Error('Дождитесь завершения добавления книг, сохранения или обновления.');
  const book = books.get(id);
  if (!book) throw Error('Книга не найдена.');
  await library.setExportName(id, name);
  book.exportName = library.snapshot().books.find(record => record.id === id)?.exportName || '';
  return publicBook(book);
});
ipcMain.handle('library:image-options', (_, options) => {
  if (exporting || updateRuntime?.isInstalling()) throw Error('Дождитесь завершения сохранения или обновления.');
  return library.setImageOptions(options);
});
ipcMain.handle('history:restore', async (_, id) => {
  const record = library.snapshot().history.find(item => item.id === id);
  if (!record) throw Error('Запись истории не найдена.');
  return addBooks(record.sources.map(source => source.filePath));
});
ipcMain.handle('history:open', async (_, id) => {
  const record = library.snapshot().history.find(item => item.id === id);
  if (!record) throw Error('Запись истории не найдена.');
  try { const stat = await fs.stat(record.destination); if (stat.isDirectory()) await shell.openPath(record.destination); else shell.showItemInFolder(record.destination); }
  catch { throw Error('Результат перемещён или удалён. Путь сохранён в истории.'); }
});
ipcMain.handle('library:relink', async (_, id) => {
  if (updateRuntime?.isInstalling()) throw Error('Дождитесь завершения обновления.');
  const previous = books.get(id);
  if (!previous) throw Error('Книга не найдена.');
  const choice = await dialog.showOpenDialog(window, { title: 'Найти исходный EPUB', properties: ['openFile'], filters: [{ name: 'EPUB', extensions: ['epub'] }] });
  if (choice.canceled || !choice.filePaths[0]) return { added: [], errors: [] };
  const filePath = choice.filePaths[0];
  if ([...books.values()].some(book => book.id !== id && book.filePath.toLowerCase() === filePath.toLowerCase())) throw Error('Этот EPUB уже есть в библиотеке.');
  if (updateRuntime?.isInstalling()) throw Error('Дождитесь завершения обновления.');
  importing++;
  try {
    const book = await readBook(filePath, id); books.set(id, book);
    const remembered = await rememberImportedBook(book, previous);
    return { added: [publicBook(book)], errors: remembered.warning ? [remembered.warning] : [], replaced: true, selectionByBook: { [id]: remembered.chosen } };
  } finally { importing--; }
});
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
ipcMain.handle('remove-book', async (_, id) => {
  books.delete(id);
  try { await library.removeBook(id); return {}; } catch (error) { return { warning: error.message }; }
});
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
ipcMain.handle('export', async (_, mode, selectedKeys, layout, imageOptions) => {
  if (exporting || updateRuntime?.isInstalling()) throw Error('Дождитесь завершения текущего сохранения или обновления.');
  exporting = true;
  try { return await exportSelection(mode, selectedKeys, layout, imageOptions); } finally { exporting = false; }
});
async function exportSelection(mode, selectedKeys, layout = library.snapshot().layout, settings = library.snapshot().imageOptions) {
  if (!['folder', 'zip'].includes(mode) || !Array.isArray(selectedKeys)) throw Error('неверные параметры экспорта');
  if (!selectedKeys.length) throw Error('выберите хотя бы одну иллюстрацию');
  if (!LAYOUTS.has(layout)) throw Error('Неизвестная структура экспорта.');
  const imageOptions = normalizeImageOptions(settings);
  const exportBooks = [...books.values()].map(book => ({ ...book }));
  const selected = new Set(selectedKeys);
  const sources = exportBooks.filter(book => book.items.some(item => selected.has(`${book.id}:${item.id}`))).map(book => ({ id: book.id, title: book.title, filePath: book.filePath }));
  let destination = outputDirectory;
  if (mode === 'zip') {
    const choice = await dialog.showSaveDialog(window, { title: 'Сохранить ZIP', defaultPath: path.join(outputDirectory, 'Иллюстрации EPUB.zip'), filters: [{ name: 'ZIP архив', extensions: ['zip'] }] });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    destination = choice.filePath;
  }
  const converter = imageOptions.format !== 'original' ? createImageConverter(BrowserWindow) : null;
  let result;
  try { result = await buildExport(exportBooks, selectedKeys, downloadRemote, layout, imageOptions, converter?.convert); }
  finally { converter?.close(); }
  const { files, errors, imageCount, originalBytes, outputBytes, bookFolders } = result;
  for (const source of sources) source.folderName = bookFolders.get(source.id);
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
  let historyWarning = '';
  try { await library.addExport({ format: mode, layout, destination, sources, imageCount, fileCount: files.size, errors, imageOptions, originalBytes, outputBytes }); }
  catch (error) { historyWarning = `История не сохранена: ${error.message}`; }
  return { count: imageCount, fileCount: files.size, errors, destination, history: library.snapshot().history, historyWarning, originalBytes, outputBytes };
}
ipcMain.handle('open-folder', async (_, folder) => {
  const { shell } = require('electron');
  if (folder && typeof folder === 'string') {
    const stat = await fs.stat(folder);
    if (stat.isDirectory()) await shell.openPath(folder);
    else shell.showItemInFolder(folder);
  }
});
