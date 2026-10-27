const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createUpdateChecker, CHECK_INTERVAL } = require('./updates');
const { installRelease, createPortableScript } = require('./update-install');

function initializeUpdates({ app, ipcMain, dialog, shell, Notification, getWindow, isBusy }) {
  const originalPortable = process.env.PORTABLE_EXECUTABLE_FILE;
  const variant = originalPortable ? 'portable' : 'installed';
  const checker = createUpdateChecker({ file: path.join(app.getPath('userData'), 'updates.json'), currentVersion: app.getVersion(), variant, enabledDefault: app.isPackaged });
  let installing = false, notified = null;
  const send = (channel, value) => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send(channel, value); };
  async function check(manual = false) {
    const result = await checker.check({ manual });
    send('updates:state', result);
    const window = getWindow();
    if (!manual && result.enabled && result.notify && result.release && notified !== result.release.version) {
      notified = result.release.version;
      if (Notification.isSupported() && window && !window.isFocused()) {
        const notice = new Notification({ title: `Иллюстрации EPUB ${result.release.version}`, body: 'Доступна новая версия. Откройте приложение, чтобы обновиться.', icon: path.join(__dirname, 'assets', 'icon.png') });
        notice.on('click', () => { if (!window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); send('updates:state', result); } });
        notice.show();
      }
    }
    return result;
  }
  ipcMain.handle('updates:status', () => checker.status());
  ipcMain.handle('updates:check', (_, manual) => check(manual === true));
  ipcMain.handle('updates:enabled', async (_, enabled) => { const state = await checker.setEnabled(enabled === true); send('updates:state', state); return state; });
  ipcMain.handle('updates:dismiss', async () => { const state = await checker.dismiss(); send('updates:state', state); return state; });
  ipcMain.handle('updates:open', async () => { const state = await checker.status(); await shell.openExternal(state.release?.url || 'https://github.com/aleksandreev2/EpubIllustrations/releases/latest'); });
  ipcMain.handle('updates:install', async () => {
    if (installing || isBusy()) throw Error('Дождитесь завершения добавления книг или сохранения иллюстраций.');
    installing = true;
    let quitting = false;
    try {
      const state = await checker.status();
      if (isBusy()) throw Error('Дождитесь завершения добавления книг или сохранения иллюстраций.');
      if (!state.release?.asset) throw Error('Проверенного файла обновления пока нет. Откройте страницу релиза.');
      return await installRelease({
        release: state.release, cacheDir: path.join(app.getPath('userData'), 'updates'),
        confirm: async release => {
          if (variant === 'portable') {
            if (!path.isAbsolute(originalPortable) || path.extname(originalPortable).toLowerCase() !== '.exe') throw Error('Не удалось определить путь переносимой версии.');
            const probe = path.join(path.dirname(originalPortable), `.epub-write-${randomUUID()}.tmp`);
            try { await fs.writeFile(probe, '', { flag: 'wx' }); } catch { throw Error('Нет прав на обновление в этой папке. Переместите переносимый EXE в доступную папку.'); }
            finally { await fs.rm(probe, { force: true }); }
          }
          const answer = await dialog.showMessageBox(getWindow(), { type: 'question', title: 'Обновление Иллюстрации EPUB', message: `Обновить приложение до версии ${release.version}?`, detail: `После проверки загрузки приложение закроется. ${variant === 'portable' ? 'Переносимый EXE будет заменён, затем новая версия откроется автоматически.' : 'Откроется установщик новой версии.'}\n\nБиблиотека, история, выбор иллюстраций, папка вывода и настройки сохранятся. Исходные EPUB должны оставаться на своих местах.`, buttons: ['Скачать и обновить', 'Позже'], defaultId: 1, cancelId: 1, noLink: true });
          return answer.response === 0;
        },
        onProgress: progress => send('updates:progress', progress),
        start: async (file, asset) => {
          if (variant !== 'portable') {
            const error = await shell.openPath(file);
            if (error) throw Error(`Не удалось запустить установщик: ${error}`);
            return;
          }
          const script = createPortableScript({ source: file, destination: originalPortable, parentPid: process.pid, digest: asset.digest });
          const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
          const helper = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { detached: true, windowsHide: true, stdio: 'ignore' });
          await new Promise((resolve, reject) => { helper.once('spawn', resolve); helper.once('error', reject); });
          helper.unref();
        },
        quit: () => { quitting = true; setTimeout(() => app.quit(), 250); }
      });
    } finally { if (!quitting) installing = false; }
  });
  const initial = setTimeout(() => check().catch(() => {}), 5000);
  const interval = setInterval(() => { if (!installing) check().catch(() => {}); }, CHECK_INTERVAL);
  initial.unref(); interval.unref();
  app.once('before-quit', () => { clearTimeout(initial); clearInterval(interval); });
  return { isInstalling: () => installing };
}
module.exports = { initializeUpdates };
