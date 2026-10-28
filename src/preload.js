const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('illustrations', {
  state: () => ipcRenderer.invoke('state'),
  chooseBooks: () => ipcRenderer.invoke('choose-books'),
  addBooks: paths => ipcRenderer.invoke('add-books', paths),
  removeBook: id => ipcRenderer.invoke('remove-book', id),
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  preview: (bookId, itemId) => ipcRenderer.invoke('preview', bookId, itemId),
  export: (mode, selectedKeys, layout, imageOptions) => ipcRenderer.invoke('export', mode, selectedKeys, layout, imageOptions),
  setImageOptions: options => ipcRenderer.invoke('library:image-options', options),
  saveSelection: (keys, clearUnavailable = false) => ipcRenderer.invoke('library:selection', keys, clearUnavailable),
  setExportLayout: layout => ipcRenderer.invoke('library:layout', layout),
  setExportName: (id, name) => ipcRenderer.invoke('library:export-name', id, name),
  restoreHistory: id => ipcRenderer.invoke('history:restore', id),
  openHistory: id => ipcRenderer.invoke('history:open', id),
  relinkBook: id => ipcRenderer.invoke('library:relink', id),
  openFolder: folder => ipcRenderer.invoke('open-folder', folder),
  openLink: name => ipcRenderer.invoke('open-link', name),
  updateStatus: () => ipcRenderer.invoke('updates:status'),
  checkUpdates: manual => ipcRenderer.invoke('updates:check', manual),
  setUpdateChecks: enabled => ipcRenderer.invoke('updates:enabled', enabled),
  dismissUpdate: () => ipcRenderer.invoke('updates:dismiss'),
  openUpdate: () => ipcRenderer.invoke('updates:open'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: callback => { const listener = (_, state) => callback(state); ipcRenderer.on('updates:state', listener); return () => ipcRenderer.removeListener('updates:state', listener); },
  onUpdateProgress: callback => { const listener = (_, progress) => callback(progress); ipcRenderer.on('updates:progress', listener); return () => ipcRenderer.removeListener('updates:progress', listener); }
});

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => {
    event.preventDefault();
    const paths = [...event.dataTransfer.files].map(file => webUtils.getPathForFile(file)).filter(Boolean);
    window.dispatchEvent(new CustomEvent('epub-drop', { detail: paths }));
  });
});
