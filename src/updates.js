const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { selectAsset } = require('./update-install');
const REPOSITORY = 'aleksandreev2/EpubIllustrations';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/i.exec(String(value));
  return match ? match.slice(1, 4).map(BigInt) : null;
}
function isNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function normalizeRelease(value, current, variant = 'installed') {
  if (!value || value.draft || value.prerelease || !isNewer(value.tag_name, current)) return null;
  try {
    const url = new URL(value.html_url), prefix = `/${REPOSITORY}/releases/tag/`;
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix) || decodeURIComponent(url.pathname.slice(prefix.length)) !== value.tag_name) return null;
    const version = value.tag_name.replace(/^v/i, '');
    return { version, tag: value.tag_name, url: url.href, asset: selectAsset(value.assets, version, variant) };
  } catch { return null; }
}
async function fetchLatestRelease(currentVersion, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `EpubIllustrations/${currentVersion}` }, redirect: 'error', signal: AbortSignal.timeout(10000)
  });
  if (response.status === 403 || response.status === 429) {
    const error = Error('GitHub временно ограничил проверки. Попробуйте позже.');
    const retry = Number(response.headers.get('retry-after')) * 1000;
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    error.retryAfterMs = Math.min(86400000, Math.max(60000, retry > 0 ? retry : reset > 0 ? reset : 600000));
    throw error;
  }
  if (!response.ok) throw Error('Не удалось получить последний релиз GitHub.');
  const text = await response.text();
  if (text.length > 1024 * 1024) throw Error('Ответ GitHub слишком большой.');
  return JSON.parse(text);
}
function createUpdateChecker({ file, currentVersion, variant = 'installed', enabledDefault = true, fetchRelease = () => fetchLatestRelease(currentVersion), now = Date.now }) {
  let loaded, pending, writes = Promise.resolve();
  async function state() {
    if (!loaded) loaded = (async () => {
      let raw = {};
      try { raw = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
      const asset = raw.release?.asset;
      const release = normalizeRelease({ tag_name: raw.release?.tag, html_url: raw.release?.url, assets: asset ? [{ ...asset, browser_download_url: asset.url }] : [] }, currentVersion, variant);
      const time = value => Number.isFinite(value) && value >= 0 ? value : 0;
      return { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : enabledDefault, checkedAt: time(raw.checkedAt), nextCheckAt: raw.release && (!release || asset && !release.asset) ? 0 : Math.min(time(raw.nextCheckAt), now() + CHECK_INTERVAL), blockedUntil: Math.min(time(raw.blockedUntil), now() + 86400000),
        release, dismissed: typeof raw.dismissed === 'string' ? raw.dismissed : null, status: release ? 'available' : raw.release ? 'unknown' : ['current', 'unavailable'].includes(raw.status) ? raw.status : 'unknown', message: '' };
    })();
    return loaded;
  }
  function snapshot(s, manual = false) {
    return { currentVersion, variant, enabled: s.enabled, status: s.status, checkedAt: s.checkedAt, release: s.release, notify: Boolean(s.release && (manual || s.enabled && s.dismissed !== s.release.version)), message: s.message };
  }
  async function save(s) {
    const serialized = JSON.stringify(s);
    writes = writes.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temp, serialized, 'utf8'); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
    });
    return writes;
  }
  return {
    async status() { return snapshot(await state()); },
    async setEnabled(enabled) { const s = await state(); s.enabled = Boolean(enabled); await save(s); return snapshot(s); },
    async dismiss() { const s = await state(); if (s.release) s.dismissed = s.release.version; await save(s); return snapshot(s); },
    async check({ manual = false } = {}) {
      const s = await state();
      if (!manual && !s.enabled) return { ...snapshot(s), status: 'disabled', notify: false };
      if (s.blockedUntil > now() || !manual && s.nextCheckAt > now()) return snapshot(s, manual);
      if (!pending) pending = (async () => {
        try {
          const raw = await fetchRelease();
          if (!raw || !versionParts(raw.tag_name) || raw.draft || raw.prerelease) throw Error('Некорректная стабильная версия.');
          const release = normalizeRelease(raw, currentVersion, variant);
          if (isNewer(raw.tag_name, currentVersion) && !release) throw Error('Недопустимая ссылка релиза.');
          s.release = release; s.status = release ? 'available' : 'current'; s.message = ''; s.checkedAt = now(); s.nextCheckAt = now() + CHECK_INTERVAL; s.blockedUntil = 0;
        } catch (error) {
          s.status = 'unavailable'; s.message = error.retryAfterMs ? 'GitHub временно ограничил проверки. Попробуйте позже.' : 'Не удалось проверить обновления. Проверьте соединение и попробуйте позже.';
          s.nextCheckAt = now() + 600000;
          if (error.retryAfterMs) { s.blockedUntil = now() + Math.min(86400000, Math.max(60000, error.retryAfterMs)); s.nextCheckAt = s.blockedUntil; }
        }
        await save(s);
      })().finally(() => { pending = null; });
      await pending;
      return snapshot(s, manual);
    }
  };
}
module.exports = { REPOSITORY, CHECK_INTERVAL, isNewer, normalizeRelease, fetchLatestRelease, createUpdateChecker };
