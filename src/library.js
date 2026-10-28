const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeImageOptions } = require('./image-options');
const { validateExportName } = require('./folder-name');
const LAYOUTS = new Set(['chapters', 'flat', 'both']);
const clone = value => JSON.parse(JSON.stringify(value));

function createLibraryStore(file, { now = Date.now } = {}) {
  let data = { version: 1, books: [], selected: null, layout: 'chapters', imageOptions: normalizeImageOptions(), history: [] };
  let loaded, writes = Promise.resolve(), warning = '', readOnly = false;
  const mutations = new Set();
  function snapshot() { return { ...clone(data), warning }; }
  async function load() {
    if (!loaded) loaded = (async () => {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!raw || raw.version !== 1) throw Error('Неподдерживаемая версия библиотеки.');
        const books = (Array.isArray(raw.books) ? raw.books : []).filter(book => book && typeof book.id === 'string' && typeof book.filePath === 'string' && path.isAbsolute(book.filePath) && typeof book.title === 'string').map(book => {
          let exportName = ''; try { exportName = validateExportName(book.exportName || ''); } catch {}
          return { ...book, exportName };
        });
        const known = new Set(books.map(book => book.id));
        let imageOptions;
        try { imageOptions = normalizeImageOptions(raw.imageOptions); } catch { imageOptions = normalizeImageOptions(); }
        data = { version: 1, books, selected: Array.isArray(raw.selected) ? raw.selected.filter(key => typeof key === 'string' && known.has(key.split(':')[0])) : null,
          imageOptions,
          layout: LAYOUTS.has(raw.layout) ? raw.layout : 'chapters',
          history: (Array.isArray(raw.history) ? raw.history : []).filter(record => record && typeof record.id === 'string' && typeof record.createdAt === 'string' && Array.isArray(record.sources) && record.sources.every(source => source && typeof source.id === 'string' && typeof source.title === 'string' && typeof source.filePath === 'string' && path.isAbsolute(source.filePath)) && ['zip', 'folder'].includes(record.format) && LAYOUTS.has(record.layout) && typeof record.destination === 'string' && path.isAbsolute(record.destination)) };
      } catch (error) {
        if (error.code === 'ENOENT') return;
        warning = 'Не удалось прочитать сохранённую библиотеку.';
        if (error instanceof SyntaxError) {
          try { await fs.rename(file, `${file}.corrupt-${now()}-${randomUUID()}`); warning += ' Повреждённый файл сохранён отдельно.'; }
          catch { readOnly = true; }
        } else readOnly = true;
      }
    })();
    await loaded; return snapshot();
  }
  async function save() {
    if (readOnly) throw Error('Сохранение библиотеки недоступно: исходный файл не был изменён.');
    const serialized = JSON.stringify(data);
    writes = writes.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, serialized, 'utf8'); await fs.rename(temporary, file); }
      finally { await fs.rm(temporary, { force: true }); }
    });
    return writes;
  }
  const api = {
    load, snapshot,
    async recordBook(book) {
      await load();
      if (!book.id || !path.isAbsolute(book.filePath)) throw Error('Некорректная запись библиотеки.');
      const existing = data.books.find(item => item.id === book.id);
      const record = { id: book.id, filePath: book.filePath, filename: book.filename || path.basename(book.filePath), title: String(book.title), exportName: existing?.exportName || '', count: Number.isSafeInteger(book.count) ? book.count : 0, fingerprint: book.fingerprint || null, createdAt: existing?.createdAt || new Date(now()).toISOString() };
      data.books = [record, ...data.books.filter(item => item.id !== record.id)];
      await save(); return clone(record);
    },
    async removeBook(id) {
      await load(); data.books = data.books.filter(book => book.id !== id);
      if (data.selected) data.selected = data.selected.filter(key => !key.startsWith(id + ':'));
      await save();
    },
    async setSelection(keys) {
      await load(); const known = new Set(data.books.map(book => book.id));
      data.selected = [...new Set(keys)].filter(key => typeof key === 'string' && known.has(key.split(':')[0]));
      await save();
    },
    async mergeSelection({ bookId, itemKeys, defaultKeys, preserve, fallback = [] }) {
      await load();
      const available = new Set(itemKeys);
      const chosen = preserve && data.selected !== null ? data.selected.filter(key => key.startsWith(bookId + ':') && available.has(key)) : defaultKeys.filter(key => available.has(key));
      const current = data.selected || fallback;
      data.selected = [...new Set([...current.filter(key => !key.startsWith(bookId + ':')), ...chosen])];
      await save(); return clone(chosen);
    },
    async setLayout(layout) {
      await load(); if (!LAYOUTS.has(layout)) throw Error('Неизвестная структура экспорта.');
      data.layout = layout; await save();
    },
    async setImageOptions(options) {
      const validated = normalizeImageOptions(options);
      await load(); data.imageOptions = validated; await save(); return clone(validated);
    },
    async setExportName(id, value) {
      const name = validateExportName(value);
      await load(); const book = data.books.find(book => book.id === id);
      if (!book) throw Error('Книга не найдена в библиотеке.');
      book.exportName = name; await save(); return name;
    },
    async addExport(operation) {
      await load();
      if (!['zip', 'folder'].includes(operation.format) || !LAYOUTS.has(operation.layout) || !path.isAbsolute(operation.destination) || !Array.isArray(operation.sources)) throw Error('Некорректная запись истории.');
      const record = { id: randomUUID(), createdAt: new Date(now()).toISOString(), format: operation.format, layout: operation.layout, destination: operation.destination,
        imageOptions: normalizeImageOptions(operation.imageOptions), originalBytes: operation.originalBytes || 0, outputBytes: operation.outputBytes || 0,
        imageCount: operation.imageCount, fileCount: operation.fileCount, sources: operation.sources.map(source => ({ id: source.id, title: String(source.title), filePath: source.filePath, ...(typeof source.folderName === 'string' ? { folderName: source.folderName } : {}) })), errors: (operation.errors || []).map(String) };
      data.history.unshift(record); await save(); return clone(record);
    },
    async flush() {
      await load();
      while (mutations.size) await Promise.allSettled([...mutations]);
      await writes;
    }
  };
  for (const name of ['recordBook', 'removeBook', 'setSelection', 'mergeSelection', 'setLayout', 'setImageOptions', 'setExportName', 'addExport']) {
    const mutate = api[name];
    api[name] = (...args) => {
      const task = Promise.resolve().then(() => mutate(...args));
      mutations.add(task);
      task.then(() => mutations.delete(task), () => mutations.delete(task));
      return task;
    };
  }
  return api;
}
module.exports = { createLibraryStore, LAYOUTS };
