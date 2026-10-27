const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { isNewer, normalizeRelease, createUpdateChecker } = require('../src/updates');
const { downloadUpdate, installRelease, createPortableScript } = require('../src/update-install');
const bytes = Buffer.from('verified update executable');
const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function release(version = '1.2.0') {
  return { tag_name: `v${version}`, html_url: `https://github.com/aleksandreev2/EpubIllustrations/releases/tag/v${version}`, assets: ['Setup', 'Portable'].map(kind => ({
    name: `EpubIllustrations-${version}-${kind}.exe`, size: bytes.length, digest,
    browser_download_url: `https://github.com/aleksandreev2/EpubIllustrations/releases/download/v${version}/EpubIllustrations-${version}-${kind}.exe`
  })) };
}
async function directory(t) {
  const base = path.resolve(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, 'epub-updates-'));
  t.after(async () => {
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(base + path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return dir;
}
test('compares numeric stable versions and excludes prereleases', () => {
  assert.equal(isNewer('v1.10.0', '1.9.9'), true);
  assert.equal(isNewer('1.1.0', '1.1.0'), false);
  assert.equal(isNewer('1.2.0-beta.1', '1.1.0'), false);
});
test('selects official installers or portable assets with verified metadata', () => {
  assert.match(normalizeRelease(release(), '1.1.0', 'installed').asset.name, /Setup/);
  assert.match(normalizeRelease(release(), '1.1.0', 'portable').asset.name, /Portable/);
  for (const changed of [{ ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), html_url: 'https://example.org/release' }]) assert.equal(normalizeRelease(changed, '1.1.0', 'installed'), null);
  const invalid = release(); invalid.assets[0].digest = null;
  assert.equal(normalizeRelease(invalid, '1.1.0', 'installed').asset, null);
  invalid.assets[0].digest = digest; invalid.assets[0].browser_download_url = invalid.assets[0].browser_download_url.replace('/v1.2.0/', '/v9.0.0/');
  assert.equal(normalizeRelease(invalid, '1.1.0', 'installed').asset, null);
});
test('persists dismissal and automatic-check preference while manual checks still work', async t => {
  const dir = await directory(t); let calls = 0; let clock = 100000;
  const options = { file: path.join(dir, 'updates.json'), currentVersion: '1.1.0', variant: 'installed', now: () => clock, fetchRelease: async () => { calls++; return release(); } };
  const checker = createUpdateChecker(options);
  assert.equal((await checker.check()).notify, true);
  await checker.check(); assert.equal(calls, 1);
  await checker.dismiss(); assert.equal((await createUpdateChecker(options).status()).notify, false);
  await checker.setEnabled(false); clock += 7 * 3600000;
  assert.equal((await checker.check()).notify, false); assert.equal(calls, 1);
  assert.equal((await checker.check({ manual: true })).notify, true); assert.equal(calls, 2);
});
test('coalesces concurrent checks and respects GitHub rate limits even for manual retries', async t => {
  const dir = await directory(t); let calls = 0;
  const checker = createUpdateChecker({ file: path.join(dir, 'state.json'), currentVersion: '1.1.0', variant: 'portable', now: () => 100000,
    fetchRelease: async () => { calls++; const error = Error('rate limit'); error.retryAfterMs = 60000; throw error; } });
  await Promise.all([checker.check(), checker.check()]);
  assert.equal(calls, 1);
  assert.equal((await checker.check({ manual: true })).status, 'unavailable');
  assert.equal(calls, 1);
});
test('switching installed and portable variants refreshes cached asset metadata', async t => {
  const dir = await directory(t); let calls = 0;
  const options = { file: path.join(dir, 'state.json'), currentVersion: '1.1.0', now: () => 100000, fetchRelease: async () => { calls++; return release(); } };
  await createUpdateChecker({ ...options, variant: 'installed' }).check();
  const state = await createUpdateChecker({ ...options, variant: 'portable' }).check();
  assert.equal(calls, 2);
  assert.match(state.release.asset.name, /Portable/);
});
test('downloads only verified bytes and reports completion after SHA-256 verification', async t => {
  const dir = await directory(t); const progress = [];
  const asset = normalizeRelease(release(), '1.1.0', 'installed').asset;
  const file = await downloadUpdate(asset, dir, p => progress.push(p.percent), async () => new Response(bytes));
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal(progress.at(-1), 100);
});
test('rejects wrong hash, truncated downloads and redirects outside GitHub', async t => {
  const dir = await directory(t); const asset = normalizeRelease(release(), '1.1.0', 'portable').asset;
  await assert.rejects(downloadUpdate(asset, dir, () => {}, async () => new Response(Buffer.alloc(bytes.length))), /целостности/);
  await assert.rejects(downloadUpdate(asset, dir, () => {}, async () => new Response(bytes.subarray(1))), /Размер/);
  let calls = 0;
  await assert.rejects(downloadUpdate(asset, dir, () => {}, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://example.org/update.exe' } }); }), /ссылка/);
  assert.equal(calls, 1);
  const files = await fs.readdir(dir, { recursive: true });
  assert.equal(files.some(file => file.endsWith('.part') || file.endsWith('.exe')), false);
});
test('cancellation or failed verification never launches or quits the app', async t => {
  const dir = await directory(t); let started = 0; let quit = 0; let fetched = 0;
  const options = { release: normalizeRelease(release(), '1.1.0', 'installed'), cacheDir: dir, start: async () => { started++; }, quit: () => { quit++; }, fetchImpl: async () => { fetched++; return new Response(bytes); } };
  assert.deepEqual(await installRelease({ ...options, confirm: async () => false }), { cancelled: true });
  assert.deepEqual([started, quit, fetched], [0, 0, 0]);
  await assert.rejects(installRelease({ ...options, confirm: async () => true, fetchImpl: async () => new Response(Buffer.alloc(bytes.length)) }));
  assert.deepEqual([started, quit], [0, 0]);
  assert.deepEqual(await installRelease({ ...options, confirm: async () => true }), { started: true });
  assert.deepEqual([started, quit], [1, 1]);
});
test('portable helper validates absolute paths and safely embeds quoted Windows filenames', () => {
  assert.throws(() => createPortableScript({ source: 'relative.exe', destination: 'other.exe', parentPid: 1, digest }), /путь/);
  const source = path.resolve("qa-updates/a' & b.exe");
  const destination = path.resolve('qa-updates/original.exe');
  const script = createPortableScript({ source, destination, parentPid: 123, digest, launch: false });
  assert.ok(script.includes(Buffer.from(source, 'utf8').toString('base64')));
  assert.ok(script.includes('[IO.File]::Replace'));
  assert.ok(!script.includes(source));
});
