'use strict';
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match=>match[1]);
let checked = 0;
for (const asset of assets) {
  if (/^(?:https?:|data:|#)/.test(asset)) continue;
  const file = path.resolve(root, asset);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new Error('Missing local asset: ' + asset);
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file], {stdio:'pipe'});
  checked++;
}
console.log(`Checked ${checked} loaded local assets and JavaScript syntax. Nothing was published.`);
