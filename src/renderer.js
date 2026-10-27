const api = window.illustrations;
const $ = id => document.getElementById(id);
const state = { books: [], history: [], selected: new Set(), unavailableSelected: new Set(), activeBook: 'all', view: 'gallery', filter: 'all', search: '', outputDirectory: '', exportLayout: 'chapters', busy: false, ready: false };
let savedSelection = '';
let selectionWarningShown = false;
let clearSelectionRevision = 0;
const previews = new Map();
let observer;
let modalItem = null;
let modalSequence = 0;
const viewer = { scale: 1, fit: 1, rotation: 0, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };
let toastTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function key(book, item) { return `${book.id}:${item.id}`; }
function formatCount(n, one, few, many) {
  const mod100 = n % 100;
  const mod10 = n % 10;
  return `${n} ${mod100 >= 11 && mod100 <= 14 ? many : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many}`;
}

function showToast(message, action) {
  clearTimeout(toastTimer);
  const toast = $('toast');
  toast.replaceChildren(element('div', '', message));
  if (action) {
    const button = element('button', '', action.label);
    button.addEventListener('click', () => { action.run(); toast.classList.add('hidden'); });
    toast.append(button);
  }
  toast.classList.remove('hidden');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), action ? 10000 : 6000);
}

function visibleItems() {
  const found = [];
  const query = state.search.trim().toLocaleLowerCase();
  for (const book of state.books) {
    if (state.activeBook !== 'all' && state.activeBook !== book.id) continue;
    for (const item of book.items) {
      const selected = state.selected.has(key(book, item));
      if (state.filter === 'selected' && !selected) continue;
      if (state.filter === 'embedded' && (item.sourceType !== 'embedded' || item.isCover)) continue;
      if (state.filter === 'remote' && item.sourceType !== 'remote') continue;
      if (state.filter === 'cover' && !item.isCover) continue;
      if (query && !`${book.title} ${item.chapter} ${item.originalName}`.toLocaleLowerCase().includes(query)) continue;
      found.push({ book, item });
    }
  }
  return found;
}

function renderBooks() {
  const list = $('book-list');
  list.replaceChildren();
  $('book-count').textContent = state.books.length;
  $('history-button').classList.toggle('active', state.view === 'history');
  $('history-navigation-count').textContent = formatCount(state.history.length, 'сохранение', 'сохранения', 'сохранений');
  if (!state.books.length) return;
  const all = element('button', `book-entry${state.view !== 'history' && state.activeBook === 'all' ? ' active' : ''}`);
  all.type = 'button';
  all.append(element('span', 'book-icon', '▦'));
  const allText = element('span', 'book-label');
  allText.append(element('strong', '', 'Все книги'), element('small', '', formatCount(state.books.reduce((n, b) => n + b.items.length, 0), 'изображение', 'изображения', 'изображений')));
  all.append(allText);
  all.addEventListener('click', () => { state.view = 'gallery'; state.activeBook = 'all'; render(); });
  list.append(all);
  for (const book of state.books) {
    const entry = element('div', `book-entry${state.view !== 'history' && state.activeBook === book.id ? ' active' : ''}`);
    entry.setAttribute('role', 'button');
    entry.setAttribute('tabindex', '0');
    entry.title = book.title;
    entry.append(element('span', 'book-icon', '▤'));
    const label = element('span', 'book-label');
    label.append(element('strong', '', book.title), element('small', '', book.missing ? 'Файл недоступен' : formatCount(book.count ?? book.items.length, 'изображение', 'изображения', 'изображений')));
    entry.append(label);
    const remove = element('button', 'remove-book', '×');
    remove.type = 'button';
    remove.title = 'Убрать книгу из библиотеки';
    remove.setAttribute('aria-label', `Убрать ${book.title}`);
    const removeBook = async event => {
      event.stopPropagation();
      const result = await api.removeBook(book.id);
      state.books = state.books.filter(b => b.id !== book.id);
      for (const item of book.items) state.selected.delete(key(book, item));
      for (const selected of state.unavailableSelected) if (selected.startsWith(book.id + ':')) state.unavailableSelected.delete(selected);
      if (state.activeBook === book.id) state.activeBook = 'all';
      render();
      if (result?.warning) showToast(result.warning);
    };
    remove.addEventListener('click', removeBook);
    remove.addEventListener('keydown', event => event.stopPropagation());
    entry.append(remove);
    entry.addEventListener('click', () => { state.view = 'gallery'; state.activeBook = book.id; render(); });
    entry.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.view = 'gallery'; state.activeBook = book.id; render(); } });
    list.append(entry);
  }
}

async function previewFor(book, item) {
  const id = key(book, item);
  if (!previews.has(id)) {
    const task = api.preview(book.id, item.id).catch(error => { previews.delete(id); throw error; });
    previews.set(id, task);
  }
  return previews.get(id);
}

function makeCard(book, item) {
  const card = element('article', `image-card${state.selected.has(key(book, item)) ? ' is-selected' : ''}`);
  const visual = element('div', 'card-visual');
  const placeholder = element('div', 'placeholder');
  placeholder.append(element('span', 'placeholder-icon', '▧'), element('span', '', item.sourceType === 'remote' ? 'Загрузка по ссылке' : 'Загрузка'));
  visual.append(placeholder);
  const image = element('img', 'hidden');
  image.alt = item.chapter;
  image.loading = 'lazy';
  visual.append(image);
  const open = element('button', 'card-open');
  open.type = 'button';
  open.setAttribute('aria-label', `Открыть иллюстрацию: ${item.chapter}`);
  open.addEventListener('click', () => openModal(book, item));
  visual.append(open);
  const checkbox = element('input', 'card-check');
  checkbox.type = 'checkbox';
  checkbox.checked = state.selected.has(key(book, item));
  checkbox.setAttribute('aria-label', `Выбрать иллюстрацию: ${item.chapter}`);
  checkbox.addEventListener('change', () => {
    checkbox.checked ? state.selected.add(key(book, item)) : state.selected.delete(key(book, item));
    card.classList.toggle('is-selected', checkbox.checked);
    updateExportBar();
    if (state.filter === 'selected') renderGallery();
  });
  visual.append(checkbox);
  visual.append(element('span', `card-badge${item.sourceType === 'remote' ? ' remote' : ''}`, item.isCover ? 'Обложка' : item.sourceType === 'remote' ? 'По ссылке' : 'В EPUB'));
  const body = element('div', 'card-body');
  body.append(element('div', 'card-chapter', item.chapter), element('div', 'card-book', book.title), element('div', 'card-filename', item.originalName));
  card.append(visual, body);
  card.loadPreview = async () => {
    try {
      image.src = await previewFor(book, item);
      image.classList.remove('hidden');
      placeholder.classList.add('hidden');
    } catch (error) {
      placeholder.replaceChildren(element('span', 'placeholder-icon', '◇'), element('span', '', `Не загрузилось: ${error.message}`));
    }
  };
  return card;
}

function renderGallery() {
  if (observer) observer.disconnect();
  const gallery = $('gallery');
  gallery.replaceChildren();
  const visible = visibleItems();
  $('visible-count').textContent = visible.length;
  $('visible-count').nextElementSibling.textContent = formatCount(visible.length, 'изображение', 'изображения', 'изображений').replace(/^\d+\s/, '');
  $('result-label').textContent = formatCount(visible.length, 'найдено', 'найдено', 'найдено');
  if (!visible.length) {
    const current = state.books.find(book => book.id === state.activeBook);
    if (current?.missing) {
      const missing = element('div', 'missing-book-message');
      const locate = element('button', 'button button-primary', 'Найти EPUB'); locate.type = 'button';
      locate.addEventListener('click', () => addBooks(api.relinkBook(current.id)));
      missing.append(element('strong', '', 'Исходный файл недоступен'), element('p', '', current.missingReason + ' Найдите его, чтобы продолжить. История сохранений остаётся в библиотеке.'), locate);
      gallery.append(missing); return;
    }
    gallery.append(element('div', 'no-results', state.search ? 'По вашему запросу ничего не найдено' : 'Здесь пока нет изображений'));
    return;
  }
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) { observer.unobserve(entry.target); entry.target.loadPreview(); }
    }
  }, { root: $('workspace'), rootMargin: '220px' });
  const fragment = document.createDocumentFragment();
  for (const { book, item } of visible) {
    const card = makeCard(book, item);
    fragment.append(card);
    observer.observe(card);
  }
  gallery.append(fragment);
}

function updateExportBar() {
  const count = state.selected.size;
  $('selected-count').textContent = formatCount(count, 'выбрано', 'выбрано', 'выбрано');
  $('selected-hint').textContent = state.unavailableSelected.size ? `Отметки без исходного EPUB: ${state.unavailableSelected.size}` : count ? 'Готово к сохранению' : 'Отметьте картинки для сохранения';
  $('save-folder').disabled = !count || state.busy;
  $('save-zip').disabled = !count || state.busy;
  $('destination-path').textContent = state.outputDirectory;
  $('destination-path').title = state.outputDirectory;
  if (state.ready) {
    const keys = [...state.selected, ...state.unavailableSelected];
    const selection = JSON.stringify(keys.sort());
    if (selection !== savedSelection) {
      savedSelection = selection;
      api.saveSelection(keys).catch(error => { if (!selectionWarningShown) { selectionWarningShown = true; showToast(`Не удалось сохранить выбор: ${error.message}`); } });
    }
  }
}

function render() {
  const hasBooks = state.books.length > 0;
  const history = state.view === 'history';
  $('empty-state').classList.toggle('hidden', hasBooks || history);
  $('workspace').classList.toggle('hidden', !hasBooks || history);
  $('history-workspace').classList.toggle('hidden', !history);
  $('export-bar').classList.toggle('hidden', !hasBooks || history);
  renderBooks();
  if (history) { $('location-name').textContent = 'История'; renderHistory(); }
  else if (hasBooks) {
    const current = state.books.find(b => b.id === state.activeBook);
    $('view-title').textContent = current?.title || 'Все иллюстрации';
    $('location-name').textContent = current?.title || 'Все иллюстрации';
    $('view-subtitle').textContent = current ? current.filename : `${formatCount(state.books.length, 'книга', 'книги', 'книг')} в библиотеке`;
    document.querySelectorAll('.filter').forEach(button => button.classList.toggle('active', button.dataset.filter === state.filter));
    renderGallery();
  }
  updateExportBar();
}

async function addBooks(resultPromise) {
  const clearRevision = clearSelectionRevision;
  try {
    const result = await resultPromise;
    for (const book of result.added) {
      const index = state.books.findIndex(existing => existing.id === book.id);
      const reset = index < 0 || result.replaced || state.books[index].missing && !book.missing;
      if (index < 0) state.books.push(book); else state.books[index] = book;
      if (reset) {
        for (const selected of state.selected) if (selected.startsWith(book.id + ':')) state.selected.delete(selected);
        for (const selected of state.unavailableSelected) if (selected.startsWith(book.id + ':')) state.unavailableSelected.delete(selected);
        const chosen = clearRevision !== clearSelectionRevision ? [] : result.selectionByBook?.[book.id] || book.items.filter(item => !item.isCover).map(item => key(book, item));
        for (const selected of chosen) state.selected.add(selected);
      }
    }
    if (result.added.length) { state.view = 'gallery'; state.activeBook = result.added.length === 1 ? result.added[0].id : 'all'; }
    if (clearRevision !== clearSelectionRevision) savedSelection = '';
    render();
    if (result.errors.length) showToast(result.errors.slice(0, 2).join('\n'));
    else if (result.added.length) showToast(formatCount(result.added.length, 'книга добавлена', 'книги добавлены', 'книг добавлено'));
  } catch (error) { showToast(`Не удалось добавить EPUB: ${error.message}`); }
}

async function openModal(book, item) {
  const sequence = ++modalSequence;
  modalItem = { book, item };
  $('modal-book').textContent = book.title;
  $('modal-title').textContent = item.chapter;
  $('modal-source').textContent = item.url || item.archivePath;
  $('modal-img').classList.add('hidden');
  $('modal-error').classList.add('hidden');
  $('modal-facts').textContent = 'Загрузка оригинала…';
  $('preview-modal').classList.remove('hidden');
  updateModalSelect();
  updateModalNavigation();
  try {
    const dataUrl = await previewFor(book, item);
    if (sequence !== modalSequence) return;
    const image = $('modal-img');
    image.src = dataUrl;
    await image.decode();
    if (sequence !== modalSequence) return;
    if (!image.naturalWidth || !image.naturalHeight) throw Error('изображение не открылось');
    image.style.width = `${image.naturalWidth}px`;
    image.style.height = `${image.naturalHeight}px`;
    $('image-stage').style.width = image.style.width;
    $('image-stage').style.height = image.style.height;
    viewer.rotation = 0;
    fitViewer();
    const mime = dataUrl.match(/^data:image\/([^;]+)/)?.[1] || '';
    const format = mime === 'jpeg' ? 'JPG' : mime === 'svg+xml' ? 'SVG' : mime.toUpperCase();
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bytes = item.size || Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    $('modal-facts').textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${format} · ${Math.max(1, Math.round(bytes / 1024))} КБ · сохраняется без сжатия`;
    image.classList.remove('hidden');
  } catch (error) {
    if (sequence !== modalSequence) return;
    $('modal-error').textContent = `Не удалось загрузить изображение: ${error.message}`;
    $('modal-error').classList.remove('hidden');
    $('modal-facts').textContent = 'Изображение недоступно';
  }
}

function closeModal() {
  modalSequence++;
  viewer.dragging = false;
  $('preview-modal').classList.add('hidden');
}

function applyViewer() {
  $('modal-img').style.transform = `translate(${viewer.x}px, ${viewer.y}px) rotate(${viewer.rotation}deg) scale(${viewer.scale})`;
  $('zoom-level').textContent = `${Math.round(viewer.scale * 100)}%`;
  $('modal-image').classList.toggle('can-pan', viewer.scale > viewer.fit + 0.001);
}

function fitViewer() {
  const image = $('modal-img');
  if (!image.naturalWidth) return;
  const area = $('modal-image');
  viewer.fit = ViewerMath.fitScale(image.naturalWidth, image.naturalHeight, area.clientWidth, area.clientHeight, viewer.rotation);
  viewer.scale = viewer.fit;
  viewer.x = 0;
  viewer.y = 0;
  applyViewer();
}

function zoomViewer(factor, clientX, clientY) {
  if (!$('modal-img').naturalWidth) return;
  const oldScale = viewer.scale;
  const nextScale = Math.max(Math.min(viewer.fit, 0.05), Math.min(8, oldScale * factor));
  const rect = $('modal-image').getBoundingClientRect();
  const pointerX = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
  const pointerY = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
  const next = ViewerMath.zoomAround(viewer.x, viewer.y, pointerX, pointerY, oldScale, nextScale);
  viewer.x = next.x;
  viewer.y = next.y;
  viewer.scale = nextScale;
  applyViewer();
}

function actualSize() {
  if (!$('modal-img').naturalWidth) return;
  viewer.scale = 1;
  viewer.x = 0;
  viewer.y = 0;
  applyViewer();
}

function rotateViewer(delta) {
  if (!$('modal-img').naturalWidth) return;
  viewer.rotation = (viewer.rotation + delta + 360) % 360;
  fitViewer();
}

function updateModalNavigation() {
  if (!modalItem) return;
  const items = visibleItems();
  const index = items.findIndex(({ book, item }) => key(book, item) === key(modalItem.book, modalItem.item));
  $('modal-prev').disabled = index <= 0;
  $('modal-next').disabled = index < 0 || index === items.length - 1;
}

function navigateModal(direction) {
  if (!modalItem) return;
  const items = visibleItems();
  const index = items.findIndex(({ book, item }) => key(book, item) === key(modalItem.book, modalItem.item));
  const next = items[index + direction];
  if (next) openModal(next.book, next.item);
}

function updateModalSelect() {
  if (!modalItem) return;
  $('modal-select').textContent = state.selected.has(key(modalItem.book, modalItem.item)) ? 'Убрать из выбора' : 'Выбрать изображение';
}

async function exportSelected(mode) {
  if (state.busy || !state.selected.size) return;
  state.busy = true;
  updateExportBar();
  const button = mode === 'folder' ? $('save-folder') : $('save-zip');
  const normalText = button.textContent;
  button.textContent = 'Сохраняем…';
  try {
    const result = await api.export(mode, [...state.selected], state.exportLayout);
    if (result.canceled) return;
    if (!result.count) {
      showToast(`Не удалось сохранить изображения. ${result.errors[0] || 'Проверьте файлы и ссылки.'}`);
      return;
    }
    let message = `${formatCount(result.count, 'изображение сохранено', 'изображения сохранены', 'изображений сохранено')}`;
    if (result.fileCount && result.fileCount !== result.count) message += ` (${formatCount(result.fileCount, 'файл', 'файла', 'файлов')})`;
    if (result.errors.length) message += `. Ошибок: ${result.errors.length}. ${result.errors[0]}`;
    if (result.historyWarning) message += `. ${result.historyWarning}`;
    if (result.history) { state.history = result.history; renderBooks(); if (state.view === 'history') renderHistory(); }
    showToast(message, { label: 'Показать результат', run: () => api.openFolder(result.destination) });
  } catch (error) { showToast(`Не удалось сохранить: ${error.message}`); }
  finally { state.busy = false; button.textContent = normalText; updateExportBar(); }
}

function bindEvents() {
  $('history-button').addEventListener('click', () => { state.view = 'history'; render(); });
  $('export-layout').addEventListener('change', async event => {
    const previous = state.exportLayout; state.exportLayout = event.target.value;
    try { await api.setExportLayout(state.exportLayout); }
    catch (error) { state.exportLayout = previous; event.target.value = previous; showToast(error.message); }
  });
  $('about-button').addEventListener('click', () => $('about-modal').classList.remove('hidden'));
  $('close-about').addEventListener('click', () => $('about-modal').classList.add('hidden'));
  document.querySelector('[data-close-about]').addEventListener('click', () => $('about-modal').classList.add('hidden'));
  document.querySelectorAll('[data-open-link]').forEach(button => button.addEventListener('click', () => api.openLink(button.dataset.openLink).catch(error => showToast(error.message))));
  $('add-button').addEventListener('click', () => addBooks(api.chooseBooks()));
  $('empty-add').addEventListener('click', () => addBooks(api.chooseBooks()));
  $('search-input').addEventListener('input', event => { state.search = event.target.value; renderGallery(); });
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; render(); }));
  $('select-visible').addEventListener('click', () => { for (const { book, item } of visibleItems()) state.selected.add(key(book, item)); render(); });
  $('clear-selection').addEventListener('click', async () => {
    clearSelectionRevision++;
    state.selected.clear(); state.unavailableSelected.clear(); savedSelection = '[]'; render();
    try { await api.saveSelection([], true); } catch (error) { showToast(error.message); }
  });
  $('change-folder').addEventListener('click', async () => { try { state.outputDirectory = await api.chooseDirectory(); updateExportBar(); } catch (error) { showToast(error.message); } });
  $('save-folder').addEventListener('click', () => exportSelected('folder'));
  $('save-zip').addEventListener('click', () => exportSelected('zip'));
  $('close-modal').addEventListener('click', closeModal);
  document.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  $('zoom-in').addEventListener('click', () => zoomViewer(1.25));
  $('zoom-out').addEventListener('click', () => zoomViewer(1 / 1.25));
  $('fit-image').addEventListener('click', fitViewer);
  $('actual-size').addEventListener('click', actualSize);
  $('rotate-left').addEventListener('click', () => rotateViewer(-90));
  $('rotate-right').addEventListener('click', () => rotateViewer(90));
  $('modal-prev').addEventListener('click', () => navigateModal(-1));
  $('modal-next').addEventListener('click', () => navigateModal(1));
  $('modal-image').addEventListener('wheel', event => {
    event.preventDefault();
    zoomViewer(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }, { passive: false });
  $('modal-image').addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    viewer.scale > viewer.fit + 0.01 ? fitViewer() : actualSize();
  });
  $('modal-image').addEventListener('pointerdown', event => {
    if (event.target.closest('button') || !$('modal-img').naturalWidth) return;
    viewer.dragging = true;
    viewer.lastX = event.clientX;
    viewer.lastY = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  $('modal-image').addEventListener('pointermove', event => {
    if (!viewer.dragging) return;
    viewer.x += event.clientX - viewer.lastX;
    viewer.y += event.clientY - viewer.lastY;
    viewer.lastX = event.clientX;
    viewer.lastY = event.clientY;
    applyViewer();
  });
  for (const name of ['pointerup', 'pointercancel']) $('modal-image').addEventListener(name, () => { viewer.dragging = false; });
  $('modal-select').addEventListener('click', () => {
    if (!modalItem) return;
    const id = key(modalItem.book, modalItem.item);
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    updateModalSelect();
    renderGallery();
    updateExportBar();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('about-modal').classList.contains('hidden')) { $('about-modal').classList.add('hidden'); return; }
    if ($('preview-modal').classList.contains('hidden')) return;
    if (event.key === 'Escape') closeModal();
    else if (event.key === 'ArrowLeft') navigateModal(-1);
    else if (event.key === 'ArrowRight') navigateModal(1);
    else if (event.key === '+' || event.key === '=') zoomViewer(1.25);
    else if (event.key === '-') zoomViewer(1 / 1.25);
    else if (event.key === '0') fitViewer();
    else if (event.key.toLowerCase() === 'r') rotateViewer(90);
  });
  window.addEventListener('resize', () => {
    if (!$('preview-modal').classList.contains('hidden') && Math.abs(viewer.scale - viewer.fit) < 0.001) fitViewer();
  });
  window.addEventListener('epub-drop', event => { $('drop-overlay').classList.add('hidden'); addBooks(api.addBooks(event.detail)); });
  document.addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) $('drop-overlay').classList.remove('hidden'); });
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('drop-overlay').classList.add('hidden'); });
  document.addEventListener('dragend', () => $('drop-overlay').classList.add('hidden'));
}

bindEvents();
api.state().then(initial => {
  state.books = initial.books; state.history = initial.history || []; state.outputDirectory = initial.outputDirectory; state.exportLayout = initial.exportLayout || 'chapters';
  const available = new Set(state.books.flatMap(book => book.items.map(item => key(book, item))));
  const selected = initial.selected || state.books.flatMap(book => book.items.filter(item => !item.isCover).map(item => key(book, item)));
  state.selected = new Set(selected.filter(key => available.has(key))); state.unavailableSelected = new Set(selected.filter(key => !available.has(key)));
  savedSelection = JSON.stringify([...state.selected, ...state.unavailableSelected].sort()); state.ready = true;
  $('export-layout').value = state.exportLayout;
  $('about-version').textContent = `Версия ${initial.version}`; $('about-button').querySelector('span').textContent = initial.version; render();
  if (initial.libraryWarning) showToast(initial.libraryWarning);
}).catch(error => showToast(`Ошибка запуска: ${error.message}`));
