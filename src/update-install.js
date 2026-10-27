const fs = require('node:fs/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function validAsset(asset) {
  if (!asset || !/^EpubIllustrations-\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?-(Setup|Portable)\.exe$/.test(asset.name) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 512 * 1024 * 1024 || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return false;
  try {
    const url = new URL(asset.url), match = /^\/aleksandreev2\/EpubIllustrations\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !match) return false;
    const tag = decodeURIComponent(match[1]), name = decodeURIComponent(match[2]);
    return name === asset.name && /^v?\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/i.test(tag) && name.startsWith(`EpubIllustrations-${tag.replace(/^v/i, '')}-`);
  } catch { return false; }
}
function selectAsset(assets, version, variant) {
  const name = `EpubIllustrations-${version}-${variant === 'portable' ? 'Portable' : 'Setup'}.exe`;
  for (const item of Array.isArray(assets) ? assets : []) {
    const asset = { name: item.name, size: item.size, digest: item.digest, url: item.browser_download_url };
    if (asset.name === name && validAsset(asset)) return asset;
  }
  return null;
}
async function downloadUpdate(asset, cacheDir, onProgress = () => {}, fetchImpl = globalThis.fetch) {
  if (!validAsset(asset) || !path.isAbsolute(cacheDir)) throw Error('В релизе нет проверенного файла обновления.');
  await fs.mkdir(cacheDir, { recursive: true });
  const root = await fs.realpath(cacheDir), dir = await fs.mkdtemp(path.join(root, 'update-'));
  const output = path.join(dir, asset.name), temporary = output + '.part';
  if (!output.startsWith(root + path.sep)) throw Error('Недопустимая папка обновления.');
  try {
    let url = asset.url, response;
    const signal = AbortSignal.timeout(10 * 60 * 1000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetchImpl(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'EpubIllustrations-updater', Accept: 'application/octet-stream' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) throw Error('Пустая ссылка загрузки обновления.');
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || next.username || next.password || next.port || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(next.hostname)) throw Error('Недопустимая ссылка загрузки обновления.');
      await response.body?.cancel(); url = next.href;
      if (redirects === 5) throw Error('Слишком много перенаправлений загрузки.');
    }
    if (!response.ok || !response.body) throw Error('Не удалось скачать обновление. Попробуйте позже.');
    let received = 0, lastPercent = -1;
    const hash = createHash('sha256');
    const meter = new Transform({ transform(chunk, encoding, done) {
      received += chunk.length;
      if (received > asset.size) { done(Error('Размер файла не соответствует релизу.')); return; }
      hash.update(chunk);
      const percent = Math.min(99, Math.floor(received / asset.size * 100));
      if (percent !== lastPercent) { lastPercent = percent; onProgress({ received, total: asset.size, percent }); }
      done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary, { flags: 'wx' }));
    if (received !== asset.size) throw Error('Размер файла не соответствует релизу.');
    if (hash.digest('hex') !== asset.digest.slice(7).toLowerCase()) throw Error('Проверка целостности обновления не пройдена. Повторите загрузку.');
    await fs.rename(temporary, output);
    onProgress({ received, total: asset.size, percent: 100 });
    return output;
  } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
async function verifyFile(file, asset) {
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(file)) { size += chunk.length; hash.update(chunk); }
  if (size !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest.toLowerCase()) throw Error('Файл обновления изменился после загрузки.');
}
async function installRelease({ release, cacheDir, confirm, start, quit, onProgress, fetchImpl }) {
  if (!validAsset(release?.asset)) throw Error('В релизе нет проверенного обновления. Откройте страницу релиза.');
  if (!await confirm(release)) return { cancelled: true };
  const file = await downloadUpdate(release.asset, cacheDir, onProgress, fetchImpl);
  await verifyFile(file, release.asset);
  await start(file, release.asset);
  quit();
  return { started: true };
}
function createPortableScript({ source, destination, parentPid, digest, launch = true, timeoutSeconds = 90 }) {
  if (!path.isAbsolute(source) || !path.isAbsolute(destination) || path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) throw Error('Недопустимый путь переносимого обновления.');
  if (!Number.isSafeInteger(parentPid) || parentPid < 0 || !/^sha256:[a-f0-9]{64}$/i.test(digest) || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120) throw Error('Недопустимые параметры переносимого обновления.');
  const encoded = value => Buffer.from(value, 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(source)}'))
$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(destination)}'))
$expected = '${digest.slice(7).toLowerCase()}'
$parentId = ${parentPid}
$candidate = $null
$backup = $null
$replaced = $false
$hadOriginal = $false
function Hash-UpdateFile([string] $file) {
  $stream = [IO.File]::OpenRead($file)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
}
function Start-UpdateApp {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $target
  $info.WorkingDirectory = [IO.Path]::GetDirectoryName($target)
  $info.UseShellExecute = $true
  $started = [Diagnostics.Process]::Start($info)
  if ($started) { $started.Dispose() }
}
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(${timeoutSeconds})
  while ($parentId -gt 0) {
    $running = $false
    try { $process = [Diagnostics.Process]::GetProcessById($parentId); $running = -not $process.HasExited; $process.Dispose() } catch {}
    if (-not $running) { break }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Application did not close' }
    [Threading.Thread]::Sleep(300)
  }
  if ((Hash-UpdateFile $source) -ne $expected) { throw 'Invalid SHA-256' }
  $dir = [IO.Path]::GetDirectoryName($target)
  $candidate = [IO.Path]::Combine($dir, '.epub-update-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $backup = [IO.Path]::Combine($dir, '.epub-previous-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $done = $false
  do {
    try {
      [IO.File]::Copy($source, $candidate, $true)
      if ((Hash-UpdateFile $candidate) -ne $expected) { throw 'Invalid copied SHA-256' }
      if ([IO.File]::Exists($target)) { [IO.File]::Replace($candidate, $target, $backup); $hadOriginal = $true } else { [IO.File]::Move($candidate, $target) }
      $replaced = $true
      $done = $true
    } catch {
      if ([DateTime]::UtcNow -gt $deadline) { throw }
      [Threading.Thread]::Sleep(500)
    }
  } until ($done)
  ${launch ? 'Start-UpdateApp' : ''}
  try { if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) } } catch {}
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  $restored = -not $replaced
  if ($replaced -and $backup -and [IO.File]::Exists($backup)) {
    try {
      if ([IO.File]::Exists($target)) { [IO.File]::Replace($backup, $target, $candidate) } else { [IO.File]::Move($backup, $target) }
      $restored = $true
    } catch { [Console]::Error.WriteLine($_.Exception.Message) }
  } elseif ($replaced -and -not $hadOriginal) {
    try { if ([IO.File]::Exists($target)) { [IO.File]::Delete($target) } } catch {}
  }
  try { if ($candidate -and [IO.File]::Exists($candidate)) { [IO.File]::Delete($candidate) } } catch {}
  ${launch ? `try { if ($restored -and [IO.File]::Exists($target)) { Start-UpdateApp } } catch { [Console]::Error.WriteLine($_.Exception.Message) }
  try {
    $null = [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
    $message = 'Не удалось завершить обновление. '
    if ($restored) { $message += 'Предыдущая версия сохранена. Повторите обновление позже.' }
    elseif ($backup -and [IO.File]::Exists($backup)) { $message += 'Предыдущая версия сохранена в файле: ' + $backup }
    else { $message += 'Загрузите переносимую версию со страницы релизов.' }
    $null = [System.Windows.Forms.MessageBox]::Show($message, 'Иллюстрации EPUB')
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }` : ''}
  exit 1
}`;
}
module.exports = { validAsset, selectAsset, downloadUpdate, installRelease, createPortableScript };
