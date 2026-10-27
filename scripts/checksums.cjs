const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const output = path.join(__dirname, '..', 'dist');
const files = fs.readdirSync(output).filter(name => /\.(?:exe|zip)$/.test(name)).sort();
if (!files.length) throw Error('No release artifacts in dist/');
const lines = files.map(name => `${createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')}  ${name}`);
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
