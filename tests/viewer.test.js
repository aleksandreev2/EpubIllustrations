const test = require('node:test');
const assert = require('node:assert/strict');
const { fitScale, zoomAround } = require('../src/viewer-math');

test('fits a portrait image within the viewport at its original aspect ratio', () => {
  assert.equal(fitScale(800, 1200, 900, 600, 0), 568 / 1200);
  assert.equal(fitScale(800, 1200, 900, 600, 90), 568 / 800);
});

test('does not enlarge a small source beyond its native pixels', () => {
  assert.equal(fitScale(100, 100, 900, 600, 0), 1);
});

test('zooming around the pointer keeps the same image point under it', () => {
  const moved = zoomAround(12, -8, 100, 50, 0.5, 1);
  assert.deepEqual(moved, { x: -76, y: -66 });
});
