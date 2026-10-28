const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeImageOptions, fitImageDimensions, describeImageOptions } = require('../src/image-options');
test('validates image formats and encoding settings without silently changing bad values', () => {
  assert.deepEqual(normalizeImageOptions(), { format: 'original', quality: 85, maxDimension: 0 });
  for (const format of ['original', 'webp', 'jpeg', 'png']) assert.equal(normalizeImageOptions({ format, quality: 1, maxDimension: 1280 }).format, format);
  for (const value of [{ format: 'exe' }, { quality: 0 }, { quality: 101 }, { quality: NaN }, { quality: '85' }, { maxDimension: -1 }, { maxDimension: 20000 }, null]) assert.throws(() => normalizeImageOptions(value), /параметр|формат|качеств|размер/i);
  assert.match(describeImageOptions({ format: 'webp', quality: 85, maxDimension: 1920 }), /WebP.*85.*1920/);
});
test('resizing preserves aspect ratio and never enlarges an image', () => {
  assert.deepEqual(fitImageDimensions(2400, 3600, 1200), { width: 800, height: 1200 });
  assert.deepEqual(fitImageDimensions(832, 1216, 1920), { width: 832, height: 1216 });
  assert.deepEqual(fitImageDimensions(5000, 1, 1280), { width: 1280, height: 1 });
  assert.deepEqual(fitImageDimensions(2400, 3600, 0), { width: 2400, height: 3600 });
  assert.throws(() => fitImageDimensions(0, 100, 0), /размер/i);
});
