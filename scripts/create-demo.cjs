const fs = require('node:fs');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');

const destination = path.join(__dirname, '..', 'examples', 'generated');
fs.mkdirSync(destination, { recursive: true });

function illustration(index) {
  const palettes = [
    ['#142749', '#587da5', '#d3a1aa', '#f1d9b6', '#182e4b', '#345a76', '#6a8896'],
    ['#566e80', '#b3c6bf', '#e6cfa6', '#fff1d4', '#254e56', '#3e7876', '#8cae94'],
    ['#192146', '#624f88', '#df9ca4', '#ffe3b5', '#24294d', '#494166', '#82709d'],
    ['#0d2e46', '#377183', '#98b8b3', '#f5db9f', '#173e53', '#2f6471', '#669298'],
    ['#2e3d54', '#8f96a4', '#ddbda2', '#f5e5c6', '#254348', '#44675f', '#8a9d83'],
    ['#253d67', '#6f92b6', '#e1bcc0', '#f7e9c8', '#1b3c5c', '#426686', '#99a9b8']
  ];
  const p = palettes[index % palettes.length];
  const stars = Array.from({ length: 28 }, (_, n) => `<circle cx="${55 + ((n * 173 + index * 31) % 800)}" cy="${40 + ((n * 67) % 370)}" r="${n % 3 === 0 ? 2 : 1}" fill="#ffffff" opacity=".5"/>`).join('');
  const trees = Array.from({ length: 9 }, (_, n) => {
    const x = n * 128 - 65;
    const y = 910 + (n % 3) * 30;
    return `<path d="M${x} ${y}l42-130 42 130h-24l30 87H${x - 6}l30-87z" fill="${p[4]}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${p[0]}"/><stop offset=".7" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient><linearGradient id="water" x2="0" y2="1"><stop stop-color="${p[6]}"/><stop offset="1" stop-color="${p[0]}"/></linearGradient></defs>
  <rect width="900" height="1200" fill="url(#sky)"/>${stars}<circle cx="${610 - index % 3 * 100}" cy="${235 + index % 2 * 65}" r="82" fill="${p[3]}"/>
  <path d="M0 665L140 460l117 120 163-210 165 240 115-135 200 205v400H0z" fill="${p[6]}"/>
  <path d="M0 750l180-195 110 135 175-175 160 230 120-150 155 140v465H0z" fill="${p[5]}"/>
  <path d="M0 825q230-90 450 5t450-20v390H0z" fill="url(#water)"/>
  <path d="M${500 - index * 12} 846h130m-175 36h210m-155 37h100m-175 39h235m-180 40h140" stroke="${p[3]}" stroke-width="3" opacity=".42"/>
  ${index % 2 === 0 ? trees : `<path d="M0 1020q160-80 310-30t235 150l-20 60H0z" fill="${p[4]}"/><path d="M900 1060q-90-140-235-80l-60 220h295z" fill="${p[4]}"/>`}
  <path d="M0 1150q250-90 450-5t450-10v65H0z" fill="${p[4]}"/>
  </svg>`;
}

function book(filename, title, chapters, start) {
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  };
  const manifest = [];
  const spine = [];
  ['Обложка', ...chapters].forEach((chapter, i) => {
    const imageName = i === 0 ? 'cover.svg' : `${i}.svg`;
    files[`OEBPS/Images/${imageName}`] = strToU8(illustration(start + i));
    files[`OEBPS/Text/chapter${i}.xhtml`] = strToU8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter}</title></head><body><h1>${chapter}</h1><p>Демонстрационная книга проекта «Иллюстрации EPUB». Все изображения созданы для примеров интерфейса.</p><img src="../Images/${imageName}" alt="Демонстрационная иллюстрация"/></body></html>`);
    manifest.push(`<item id="c${i}" href="Text/chapter${i}.xhtml" media-type="application/xhtml+xml"/><item id="i${i}" href="Images/${imageName}" media-type="image/svg+xml"${i === 0 ? ' properties="cover-image"' : ''}/>`);
    spine.push(`<itemref idref="c${i}"/>`);
  });
  files['OEBPS/book.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:epubillustrations:demo:${filename}</dc:identifier><dc:title>${title}</dc:title><dc:language>ru</dc:language><dc:creator>dollar · Дом Некроманта</dc:creator></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`);
  const target = path.join(destination, filename);
  fs.writeFileSync(target, zipSync(files));
  return target;
}

const demos = [
  book('atlas-demo.epub', 'Атлас тихих миров', ['Глава 1. Лунный берег', 'Глава 2. Сады за облаками', 'Глава 3. Обсерватория', 'Глава 4. Дорога к морю', 'Глава 5. Дальние острова', 'Глава 6. Озеро на рассвете', 'Глава 7. Тихая долина'], 0),
  book('travel-demo.epub', 'Путевой дневник', ['Глава 1. Северный перевал', 'Глава 2. Между двумя берегами', 'Глава 3. Последний свет'], 4)
];
if (require.main === module) demos.forEach(file => console.log(path.relative(process.cwd(), file)));
module.exports = demos;
