const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const { createPortableScript, downloadUpdate } = require('../src/update-install');
const { fetchLatestRelease, normalizeRelease } = require('../src/updates');
const execute = promisify(execFile);
async function main() {
  const root = path.resolve(__dirname, '..');
  const dir = await fs.mkdtemp(path.join(root, 'qa-updates-'));
  try {
    const source = path.join(dir, "Новая ' & версия.exe"), target = path.join(dir, 'Тестовое приложение.exe');
    const data = Buffer.from('inert replacement fixture, never execute');
    const digest = 'sha256:' + createHash('sha256').update(data).digest('hex');
    await fs.writeFile(source, data); await fs.writeFile(target, 'original');
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const run = hash => execute(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(createPortableScript({ source, destination: target, parentPid: 0, digest: hash, launch: false, timeoutSeconds: 5 }), 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 });
    await run(digest);
    assert.deepEqual(await fs.readFile(target), data);
    await fs.writeFile(target, 'original');
    await assert.rejects(run('sha256:' + '0'.repeat(64)));
    assert.equal(await fs.readFile(target, 'utf8'), 'original');
    const failedLaunch = createPortableScript({ source, destination: target, parentPid: 0, digest, launch: true, timeoutSeconds: 5 })
      .replace('$info = [Diagnostics.ProcessStartInfo]::new()', "throw 'Simulated launch failure'\n  $info = [Diagnostics.ProcessStartInfo]::new()")
      .replace("$null = [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')", '')
      .replace(/^\s*\$null = \[System.Windows.Forms.MessageBox\]::Show.*$/m, "  [Console]::Error.WriteLine('RECOVERY_MESSAGE')");
    let launchError;
    try { await execute(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(failedLaunch, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 }); } catch (error) { launchError = error; }
    assert.ok(launchError, 'Simulated launch must fail without starting an executable');
    assert.equal(await fs.readFile(target, 'utf8'), 'original', 'Launch failure must restore the previous file');
    assert.ok(launchError.stderr.includes('RECOVERY_MESSAGE'), 'A recovery launch failure must not prevent the error message');
    console.log('Portable replacement, hash rejection and rollback after launch failure verified; no executable launched.');
    if (process.argv.includes('--download')) {
      const raw = await fetchLatestRelease('0.0.0');
      const release = normalizeRelease(raw, '0.0.0', 'portable');
      assert.ok(release?.asset, 'GitHub release must provide a verified portable asset');
      const file = await downloadUpdate(release.asset, dir);
      assert.equal((await fs.stat(file)).size, release.asset.size);
      console.log(`GitHub ${release.version}: ${release.asset.size} bytes downloaded and SHA-256 verified; file was not executed.`);
    }
  } finally {
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('qa-updates-')) throw Error('Unsafe smoke-test cleanup path');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stderr?.slice(-1500) || error.message.slice(0, 1000)); process.exitCode = 1; });
