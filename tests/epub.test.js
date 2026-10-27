const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, strToU8 } = require('fflate');
const { scanEpub, archivePath } = require('../src/epub');

function sample(entries) {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])));
}

test('maps embedded illustrations to chapters in spine order and separates cover', () => {
  const epub = sample({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
    'OEBPS/book.opf': '<package><metadata><dc:title>Тестовая книга</dc:title></metadata><manifest><item id="b" href="Text/b.xhtml"/><item id="a" href="Text/a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    'OEBPS/Text/a.xhtml': '<title>Первая глава</title><img src="../Images/first.webp"/>',
    'OEBPS/Text/b.xhtml': '<title>Вторая глава</title><img src="../Images/second.jpg"/>',
    'OEBPS/Images/first.webp': 'first',
    'OEBPS/Images/second.jpg': 'second',
    'OEBPS/Images/cover.jpg': 'cover',
    'OEBPS/Images/unused.png': 'unused'
  });
  const result = scanEpub(epub, 'fallback.epub');
  assert.equal(result.title, 'Тестовая книга');
  assert.deepEqual(result.items.map(x => [x.chapter, x.sourceType, x.isCover]), [
    ['Первая глава', 'embedded', false],
    ['Вторая глава', 'embedded', false],
    ['Обложка', 'embedded', true],
    ['Вне глав', 'embedded', false]
  ]);
});

test('finds remote NovelPia .file images and avoids duplicate references in one chapter', () => {
  const url = 'https://images.novelpia.com/imagebox/a/123_ori.file';
  const epub = sample({
    'chapter.xhtml': `<h1>Глава 7</h1><img src="${url}"/><a href="${url}">рисунок</a>`
  });
  const result = scanEpub(epub, 'Книга.epub');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].url, url);
  assert.equal(result.items[0].chapter, 'Глава 7');
  assert.equal(result.items[0].sourceType, 'remote');
});

test('ignores archive traversal and non-image links', () => {
  const epub = sample({
    'Text/chapter.xhtml': '<title>Глава</title><img src="../../secret.jpg"/><a href="https://example.com/article">текст</a>',
    'secret.jpg': 'bad'
  });
  const result = scanEpub(epub, 'Книга.epub');
  assert.equal(archivePath('Text/chapter.xhtml', '../../secret.jpg'), null);
  assert.deepEqual(result.items.map(item => item.chapter), ['Вне глав']);
});
