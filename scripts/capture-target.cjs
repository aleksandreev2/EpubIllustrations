const path = require('node:path');
const { pathToFileURL } = require('node:url');
function matchesTarget(page, root, packaged = false) {
  if (page.type !== 'page' || page.title !== 'Иллюстрации EPUB') return false;
  try {
    const url = new URL(page.url);
    if (url.protocol !== 'file:') return false;
    if (packaged) return decodeURIComponent(url.pathname).replace(/\\/g, '/').endsWith('/resources/app.asar/src/index.html');
    return url.href === pathToFileURL(path.join(root, 'src', 'index.html')).href;
  } catch { return false; }
}
module.exports = { matchesTarget };
