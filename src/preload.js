const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('illustrations', {
  state: () => ipcRenderer.invoke('state'),
  chooseBooks: () => ipcRenderer.invoke('choose-books'),
  addBooks: paths => ipcRenderer.invoke('add-books', paths),
  removeBook: id => ipcRenderer.invoke('remove-book', id),
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  preview: (bookId, itemId) => ipcRenderer.invoke('preview', bookId, itemId),
  export: (mode, selectedKeys) => ipcRenderer.invoke('export', mode, selectedKeys),
  openFolder: folder => ipcRenderer.invoke('open-folder', folder),
  openLink: name => ipcRenderer.invoke('open-link', name)
});

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => {
    event.preventDefault();
    const paths = [...event.dataTransfer.files].map(file => webUtils.getPathForFile(file)).filter(Boolean);
    window.dispatchEvent(new CustomEvent('epub-drop', { detail: paths }));
  });
});
