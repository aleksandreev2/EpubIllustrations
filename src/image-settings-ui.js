function renderImageSettingsSummary() {
  $('image-settings-summary').textContent = ImageOptions.describeImageOptions(state.imageOptions);
  $('image-settings-button').disabled = state.busy;
}
function updateImageSettingsForm() {
  const format = $('image-format').value;
  const original = format === 'original', lossy = format === 'webp' || format === 'jpeg';
  $('image-quality').disabled = !lossy;
  $('image-quality-value').textContent = lossy ? `${$('image-quality').value}%` : 'Без потерь';
  $('image-quality-help').textContent = lossy ? 'Меньше — легче файл. Больше — точнее детали.' : 'Качество для этого режима не настраивается.';
  $('image-max-dimension').disabled = original;
  $('image-format-description').textContent = {
    original: 'Сохранить исходные байты: формат, качество, размеры и анимация останутся прежними.',
    webp: 'Рекомендуем начать с 85%. WebP поддерживает прозрачность. Итоговый вес зависит от исходной картинки.',
    jpeg: 'Сжатие с потерями. Прозрачные участки станут белыми.',
    png: 'Сохраняет пиксели без сжатия с потерями. Обычно тяжелее WebP и JPEG.'
  }[format];
  $('image-resize-help').textContent = original ? 'Для уменьшения размеров выберите WebP, JPEG или PNG.' : 'Пропорции сохраняются. Маленькие изображения не увеличиваются.';
  $('image-conversion-note').hidden = original;
}
$('image-settings-button').addEventListener('click', () => {
  if (state.busy) return;
  const options = state.imageOptions;
  $('image-format').value = options.format; $('image-quality').value = options.quality; $('image-max-dimension').value = options.maxDimension;
  $('image-settings-error').hidden = true; updateImageSettingsForm(); $('image-settings-modal').showModal();
});
for (const id of ['close-image-settings', 'cancel-image-settings']) $(id).addEventListener('click', () => $('image-settings-modal').close());
$('image-format').addEventListener('change', updateImageSettingsForm);
$('image-quality').addEventListener('input', updateImageSettingsForm);
$('save-image-settings').addEventListener('click', async () => {
  if (state.busy || $('save-image-settings').disabled) return;
  const options = { format: $('image-format').value, quality: Number($('image-quality').value), maxDimension: Number($('image-max-dimension').value) };
  $('save-image-settings').disabled = true;
  try {
    const saved = await api.setImageOptions(options);
    state.imageOptions = saved; renderImageSettingsSummary(); $('image-settings-modal').close();
  } catch (error) { $('image-settings-error').textContent = error.message; $('image-settings-error').hidden = false; }
  finally { $('save-image-settings').disabled = false; }
});
