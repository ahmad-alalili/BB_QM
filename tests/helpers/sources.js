'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const readFile = file => fs.readFileSync(path.join(root, file), 'utf8');

// Structural safety tests inspect the actual loaded UI sources, regardless of
// which controller owns a behavior. Runtime tests import controllers directly.
function read(file) {
  if (file !== 'app.js') return readFile(file);
  const scripts = [...readFile('index.html').matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
  return scripts.filter(src => src === 'app.js' || src.startsWith('src/ui/')).map(readFile).join('\n');
}
module.exports = {read};
