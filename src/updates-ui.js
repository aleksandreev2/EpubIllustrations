let updateSnapshot = null;
let updateChecking = false;
let updateInstalling = false;
function renderUpdateState(result, manual = false) {
  updateSnapshot = result;
  const release = result.release;
  const visible = Boolean(release && result.notify && (manual || result.enabled));
  $('update-notice').hidden = !visible;
  $('automatic-updates').checked = result.enabled;
  $('update-notice-install').hidden = !release?.asset;
  $('about-update-install').hidden = !release?.asset;
  $('about-update-open').hidden = !release;
  if (release) {
    $('update-notice-title').textContent = `Доступна версия ${release.version}`;
    $('update-notice-text').textContent = `У вас установлена ${result.currentVersion}. Настройки сохранятся.`;
  }
  if (!updateInstalling) $('update-status').textContent = result.status === 'unavailable' ? result.message || 'Не удалось проверить обновления. Попробуйте позже.' :
    release ? `Доступна версия ${release.version}.${release.asset ? '' : ' Файл обновления ещё не готов — откройте страницу релиза.'}` :
      result.status === 'current' ? `Установлена актуальная версия ${result.currentVersion}.` :
        !result.enabled && !manual ? 'Автоматическая проверка отключена.' : 'Проверка при запуске и каждые шесть часов.';
}
async function checkAppUpdates(manual = false) {
  if (updateChecking || updateInstalling) return;
  updateChecking = true; $('check-updates').disabled = true;
  if (manual) $('update-status').textContent = 'Проверяем новые версии на GitHub…';
  try { renderUpdateState(await api.checkUpdates(manual), manual); }
  catch { $('update-status').textContent = 'Не удалось проверить обновления. Проверьте соединение и попробуйте позже.'; }
  finally { updateChecking = false; $('check-updates').disabled = false; }
}
async function installAppUpdate() {
  if (updateInstalling || updateChecking) return;
  if (state.busy) { $('update-status').textContent = 'Дождитесь завершения сохранения иллюстраций.'; return; }
  updateInstalling = true; state.busy = true; updateExportBar();
  const controls = ['check-updates', 'automatic-updates', 'update-notice-install', 'about-update-install', 'update-notice-open', 'about-update-open', 'update-notice-dismiss', 'add-button', 'empty-add', 'export-layout', 'change-folder'];
  controls.forEach(id => { $(id).disabled = true; });
  let started = false;
  try {
    const result = await api.installUpdate();
    started = result.started === true;
    $('update-status').textContent = started ? 'Файл проверен. Приложение закрывается для обновления…' : 'Обновление отложено.';
  } catch (error) {
    $('update-status').textContent = `Не удалось обновить приложение. ${error.message}`;
    showToast(`Не удалось обновить приложение. ${error.message}`);
  } finally {
    if (!started) {
      updateInstalling = false; state.busy = false; updateExportBar();
      controls.forEach(id => { $(id).disabled = false; });
      $('update-notice-install').textContent = 'Обновить'; $('about-update-install').textContent = 'Обновить';
      $('update-progress').hidden = true;
    }
  }
}
$('check-updates').addEventListener('click', () => checkAppUpdates(true));
for (const id of ['update-notice-install', 'about-update-install']) $(id).addEventListener('click', installAppUpdate);
for (const id of ['update-notice-open', 'about-update-open']) $(id).addEventListener('click', () => api.openUpdate().catch(error => showToast(error.message)));
$('update-notice-dismiss').addEventListener('click', () => api.dismissUpdate().then(result => renderUpdateState(result)).catch(error => showToast(error.message)));
$('automatic-updates').addEventListener('change', async () => {
  const enabled = $('automatic-updates').checked;
  try { renderUpdateState(await api.setUpdateChecks(enabled)); if (enabled) await checkAppUpdates(); }
  catch { $('automatic-updates').checked = !enabled; $('update-status').textContent = 'Не удалось сохранить настройку обновлений.'; }
});
const unsubscribeUpdateState = api.onUpdateState(result => renderUpdateState(result, updateChecking));
function renderUpdateProgress(progress) {
  $('update-progress').hidden = false; $('update-progress').value = progress.percent;
  const text = progress.percent === 100 ? 'Файл проверен' : `Загрузка ${progress.percent}%`;
  $('update-status').textContent = text;
  $('update-notice-install').textContent = text; $('about-update-install').textContent = text;
}
const unsubscribeUpdateProgress = api.onUpdateProgress(renderUpdateProgress);
api.updateStatus().then(result => renderUpdateState(result)).catch(() => { $('update-status').textContent = 'Настройки обновлений недоступны. Попробуйте ручную проверку.'; });
window.addEventListener('beforeunload', () => { unsubscribeUpdateState(); unsubscribeUpdateProgress(); }, { once: true });
