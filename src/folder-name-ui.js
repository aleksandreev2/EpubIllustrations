let editingFolderBook = null;
let savingFolderName = false;
function renderBookFolderControl() {
  const book = state.books.find(book => book.id === state.activeBook);
  $('book-folder-row').hidden = !book || state.view === 'history';
  if (book) { $('book-folder-name').textContent = book.folderName || FolderName.safePart(book.exportName || book.title); $('book-folder-name').title = $('book-folder-name').textContent; }
  $('edit-book-folder').disabled = state.busy;
  document.querySelectorAll('.rename-book').forEach(button => { button.disabled = state.busy; });
}
function updateFolderNamePreview() {
  const book = state.books.find(book => book.id === editingFolderBook);
  if (!book) return;
  try {
    const name = FolderName.validateExportName($('folder-name-input').value);
    $('folder-name-preview').textContent = `${name || FolderName.safePart(book.title)}/…`;
    $('folder-name-error').hidden = true; $('save-folder-name').disabled = savingFolderName;
  } catch (error) {
    $('folder-name-preview').textContent = 'Проверьте название'; $('folder-name-error').textContent = error.message;
    $('folder-name-error').hidden = false; $('save-folder-name').disabled = true;
  }
}
function openFolderNameDialog(id) {
  if (state.busy || savingFolderName) return;
  const book = state.books.find(book => book.id === id); if (!book) return;
  editingFolderBook = id; $('folder-name-book').textContent = book.title;
  $('folder-name-input').value = book.exportName || ''; $('folder-name-input').placeholder = FolderName.safePart(book.title);
  updateFolderNamePreview(); $('folder-name-modal').showModal(); $('folder-name-input').focus(); $('folder-name-input').select();
}
$('edit-book-folder').addEventListener('click', () => openFolderNameDialog(state.activeBook));
for (const id of ['close-folder-name', 'cancel-folder-name']) $(id).addEventListener('click', () => $('folder-name-modal').close());
$('folder-name-input').addEventListener('input', updateFolderNamePreview);
$('folder-name-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !$('save-folder-name').disabled) { event.preventDefault(); $('save-folder-name').click(); } });
$('reset-folder-name').addEventListener('click', () => { $('folder-name-input').value = ''; updateFolderNamePreview(); $('folder-name-input').focus(); });
$('save-folder-name').addEventListener('click', async () => {
  if (state.busy || savingFolderName || $('save-folder-name').disabled) return;
  savingFolderName = true; $('save-folder-name').disabled = true;
  try {
    const id = editingFolderBook;
    const updated = await api.setExportName(id, FolderName.validateExportName($('folder-name-input').value));
    const current = state.books.find(book => book.id === id);
    if (current) { current.exportName = updated.exportName; current.folderName = updated.folderName; }
    $('folder-name-modal').close(); render(); showToast('Имя папки сохранено');
  } catch (error) { $('folder-name-error').textContent = error.message; $('folder-name-error').hidden = false; }
  finally { savingFolderName = false; $('save-folder-name').disabled = false; }
});
