#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'apps-script');
const allowedDiffs = new Set(['Config']);
const gsFiles = fs.readdirSync(root).filter(name => name.endsWith('.gs')).sort();
const mismatches = [];
const missing = [];

for (const gsName of gsFiles) {
  const base = gsName.slice(0, -3);
  const jsName = `${base}.js`;
  const gsPath = path.join(root, gsName);
  const jsPath = path.join(root, jsName);
  if (!fs.existsSync(jsPath)) {
    missing.push(jsName);
    continue;
  }
  if (allowedDiffs.has(base)) continue;
  const gs = fs.readFileSync(gsPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  if (gs !== js) mismatches.push(`${gsName} != ${jsName}`);
}

if (missing.length || mismatches.length) {
  if (missing.length) console.error('Missing production .js files:\n' + missing.map(s => `- ${s}`).join('\n'));
  if (mismatches.length) console.error('Unsynced Apps Script files:\n' + mismatches.map(s => `- ${s}`).join('\n'));
  console.error('\nSync the changed .gs files to their .js production copies before clasp push.');
  process.exit(1);
}

console.log('Apps Script .gs/.js files are synced (Config excluded).');
