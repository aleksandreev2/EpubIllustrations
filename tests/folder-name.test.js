const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExportName, safePart } = require('../src/folder-name');
test('folder names reject paths and Windows reserved names with a deliberate empty reset', () => {
  assert.equal(validateExportName('  Моя коллекция  '), 'Моя коллекция');
  assert.equal(validateExportName(''), ''); assert.equal(validateExportName('   '), '');
  for (const value of ['../escape', '..', '.', 'A\\B', 'A/B', 'C:\\output', 'CON', 'nul.png', 'COM1', 'COM¹', 'COM².jpg', 'LPT³', 'CONOUT$', 'A.', 'A?B', 'x'.repeat(73), null, 15]) assert.throws(() => validateExportName(value), /названи|символ|72/i);
  assert.equal(safePart('NUL.png'), 'NUL_.png');
  assert.equal(safePart('COM¹'), 'COM¹_');
});
