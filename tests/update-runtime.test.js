const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(status, busy = () => false) {
  const handlers = new Map(); let starts = 0;
  const module = { exports: {} };
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'update-runtime.js'), 'utf8');
  const checker = { status };
  vm.runInNewContext(code, { module, exports: module.exports, __dirname: path.join(__dirname, '..', 'src'), Buffer, process: { env: {}, pid: process.pid },
    require(name) {
      if (name === './updates') return { createUpdateChecker: () => checker, CHECK_INTERVAL: 600000 };
      if (name === './update-install') return { installRelease: async () => { starts++; return { started: true }; } };
      return require(name);
    },
    setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} }), clearTimeout() {}, clearInterval() {}
  });
  const runtime = module.exports.initializeUpdates({ app: { getPath: () => __dirname, getVersion: () => '1.1.0', isPackaged: true, once() {} }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, dialog: {}, shell: {}, Notification: { isSupported: () => false }, getWindow: () => null, isBusy: busy });
  return { runtime, install: () => handlers.get('updates:install')(), starts: () => starts };
}
test('concurrent update requests acquire the guard before asynchronous status lookup', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture(() => pending);
  const first = f.install(); const second = f.install();
  resolve({ release: { asset: {} } });
  const results = await Promise.allSettled([first, second]);
  assert.equal(f.starts(), 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});
test('installation is refused if an operation became busy while status was loading', async () => {
  let resolve, busy = false;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture(() => pending, () => busy);
  const installing = f.install(); busy = true; resolve({ release: { asset: {} } });
  await assert.rejects(installing, /Дождитесь/);
  assert.equal(f.starts(), 0);
  assert.equal(f.runtime.isInstalling(), false);
});
