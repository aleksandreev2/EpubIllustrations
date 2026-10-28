const { app, BrowserWindow, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const { createImageConverter } = require('../src/image-converter');
const { imageFormat } = require('../src/export');
const { buildExport, makeZip } = require('../src/export');
const { unzipSync } = require('fflate');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const converter = createImageConverter(BrowserWindow);
  try {
    const width = 512, height = 768, bitmap = Buffer.alloc(width * height * 4);
    let random = 19;
    for (let i = 0; i < bitmap.length; i += 4) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      bitmap[i] = random & 255; bitmap[i + 1] = random >>> 8 & 255; bitmap[i + 2] = random >>> 16 & 255; bitmap[i + 3] = 255;
    }
    const png = nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
    const source = { mime: 'image/png' };
    const convert = (data, format, quality = 85, maxDimension = 0, mime = source.mime) => converter.convert(data, { mime }, { format, quality, maxDimension });
    const webp = await convert(png, 'webp');
    const low = await convert(png, 'webp', 30);
    const high = await convert(png, 'webp', 95);
    assert.equal(imageFormat(webp).ext, 'webp'); assert.ok(low.length < high.length); assert.ok(webp.length < png.length);
    const decoded = nativeImage.createFromBuffer(await convert(webp, 'png', 85, 0, 'image/webp'));
    assert.deepEqual(decoded.getSize(), { width, height });
    const smaller = await convert(png, 'jpeg', 80, 256);
    assert.equal(imageFormat(smaller).ext, 'jpg'); assert.deepEqual(nativeImage.createFromBuffer(smaller).getSize(), { width: 171, height: 256 });
    const transparent = nativeImage.createFromBitmap(Buffer.alloc(4 * 4 * 4), { width: 4, height: 4 }).toPNG();
    const alphaWebp = await convert(transparent, 'webp');
    const alphaPng = await convert(alphaWebp, 'png', 85, 0, 'image/webp');
    assert.equal(nativeImage.createFromBuffer(alphaPng).toBitmap()[3], 0);
    const whiteJpg = nativeImage.createFromBuffer(await convert(transparent, 'jpeg'));
    assert.ok([...whiteJpg.toBitmap().subarray(0, 3)].every(value => value >= 250));
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><rect width="832" height="1216" fill="#6854d8"/></svg>');
    assert.equal(imageFormat(await convert(svg, 'webp', 85, 0, 'image/svg+xml')).ext, 'webp');
    const book = { id: 'b', title: 'Книга', entries: { '1.png': png }, items: [{ id: '1', chapter: 'Глава', chapterIndex: 1, sourceType: 'embedded', archivePath: '1.png', originalName: '1.png' }] };
    const zipped = unzipSync(makeZip((await buildExport([book], ['b:1'], null, 'both', { format: 'webp', quality: 85 }, converter.convert)).files));
    assert.equal(Object.keys(zipped).length, 2);
    for (const [name, bytes] of Object.entries(zipped)) { assert.ok(name.endsWith('.webp')); assert.equal(imageFormat(bytes).ext, 'webp'); }
    const jpeg = await convert(png, 'jpeg');
    const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex');
    const app1 = Buffer.alloc(exif.length + 4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(exif.length + 2, 2); exif.copy(app1, 4);
    const oriented = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
    assert.deepEqual(nativeImage.createFromBuffer(await convert(oriented, 'png', 85, 0, 'image/jpeg')).getSize(), { width: height, height: width });
    const gif = Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f90400010000002c000000000100010000020244010021f90400010000002c00000000010001000002024c01003b', 'hex');
    const firstFrame = nativeImage.createFromBuffer(await convert(gif, 'png', 85, 0, 'image/gif')).toBitmap();
    assert.ok(firstFrame[2] > 250 && firstFrame[0] < 5, 'Animation must use the first (red) frame');
    const tall = nativeImage.createFromBitmap(Buffer.alloc(4 * 17000, 255), { width: 1, height: 17000 }).toPNG();
    await assert.rejects(convert(tall, 'webp'), /16383|уменьш|ограничение/i);
    assert.equal(imageFormat(await convert(tall, 'webp', 85, 1280)).ext, 'webp');
    await assert.rejects(convert(Buffer.from('broken image'), 'webp'));
    assert.equal(imageFormat(await convert(png, 'webp')).ext, 'webp', 'A failed input must not break subsequent conversions');
    console.log(JSON.stringify({ originalPNG: png.length, webp85: webp.length, webp30: low.length, webp95: high.length, jpegResized: smaller.length, dimensions: decoded.getSize(), transparency: 'preserved', jpegBackground: 'white', svg: 'converted', recovery: 'passed' }, null, 2));
  } finally { converter.close(); }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
