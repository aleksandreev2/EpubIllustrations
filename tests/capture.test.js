const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { matchesTarget } = require('../scripts/capture-target.cjs');
const root = path.resolve(__dirname, '..');

test('screenshots select the expected local application, excluding unrelated pages', () => {
  const page = { type: 'page', title: 'Иллюстрации EPUB', url: pathToFileURL(path.join(root, 'src', 'index.html')).href };
  assert.equal(matchesTarget(page, root, false), true);
  assert.equal(matchesTarget({ ...page, url: 'https://example.com/inbox' }, root, false), false);
  assert.equal(matchesTarget({ ...page, url: pathToFileURL(path.join(root, 'other', 'index.html')).href }, root, false), false);
  assert.equal(matchesTarget({ ...page, title: 'Inbox' }, root, false), false);
});

test('packaged screenshot targets must be the app page inside app.asar', () => {
  const page = { type: 'page', title: 'Иллюстрации EPUB', url: 'file:///C:/demo/resources/app.asar/src/index.html' };
  assert.equal(matchesTarget(page, root, true), true);
  assert.equal(matchesTarget({ ...page, url: 'https://example.com/resources/app.asar/src/index.html' }, root, true), false);
});
