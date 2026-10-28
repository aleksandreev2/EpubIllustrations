const exportLayoutLabels = { chapters: 'По папкам-главам', flat: 'Все в одной папке', both: 'Оба варианта' };
function renderHistory() {
  const list = $('history-list'); list.replaceChildren();
  $('history-total').textContent = state.history.length;
  $('history-total').nextElementSibling.textContent = formatCount(state.history.length, 'сохранение', 'сохранения', 'сохранений').replace(/^\d+\s/, '');
  if (!state.history.length) {
    const empty = element('div', 'history-empty');
    empty.append(element('strong', '', 'Здесь появятся ваши результаты'), element('p', '', 'Сохраните иллюстрации в папку или ZIP — книга, дата, структура и путь останутся в истории.'));
    list.append(empty); return;
  }
  for (const record of state.history) {
    const card = element('article', 'history-card');
    const heading = element('div', 'history-card-heading');
    const title = record.sources.map(source => source.title).join(', ') || 'Иллюстрации';
    const caption = element('div');
    const date = new Date(record.createdAt);
    const dateLabel = Number.isNaN(date.getTime()) ? 'Дата не указана' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    caption.append(element('h2', 'history-card-title', title), element('p', 'history-card-meta', dateLabel));
    heading.append(element('span', 'history-format', record.format === 'zip' ? 'ZIP' : 'Папка'), caption);
    const detail = element('div', 'history-detail');
    detail.append(element('span', '', formatCount(record.imageCount || 0, 'изображение', 'изображения', 'изображений')), element('span', '', exportLayoutLabels[record.layout]));
    if (record.imageOptions) {
      let label;
      try { label = ImageOptions.describeImageOptions(record.imageOptions); } catch { label = 'Оригинал'; }
      detail.append(element('span', '', label));
    }
    if (record.originalBytes > record.outputBytes && record.outputBytes > 0) detail.append(element('span', '', `Вес меньше на ${Math.round((1 - record.outputBytes / record.originalBytes) * 100)}%`));
    if (record.fileCount !== record.imageCount) detail.append(element('span', '', formatCount(record.fileCount || 0, 'файл', 'файла', 'файлов')));
    const destination = element('div', 'history-path', record.destination); destination.title = record.destination;
    const actions = element('div', 'history-actions');
    const open = element('button', 'button button-outline', 'Показать результат'); open.type = 'button';
    open.addEventListener('click', () => api.openHistory(record.id).catch(error => showToast(error.message)));
    const restore = element('button', 'text-button', 'Открыть EPUB'); restore.type = 'button';
    restore.addEventListener('click', () => addBooks(api.restoreHistory(record.id)));
    actions.append(open, restore); card.append(heading, detail, destination, actions);
    if (Array.isArray(record.errors) && record.errors.length) {
      const errors = element('details', 'history-errors');
      errors.append(element('summary', '', `Не сохранено: ${record.errors.length}`), element('pre', '', record.errors.join('\n'))); card.append(errors);
    }
    list.append(card);
  }
}
