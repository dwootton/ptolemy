#!/usr/bin/env node
// Toggle study mode flags for both extension and webview via JSON files
// Usage: node scripts/toggle-study-mode.js true|false

const fs = require('fs');
const path = require('path');

const arg = String(process.argv[2] || '').toLowerCase();
const enabled = arg === 'true' || arg === '1' || arg === 'yes' || arg === 'on';

const files = [
  path.join(process.cwd(), 'src', 'config', 'study-mode.json'),
  path.join(process.cwd(), 'webview-ui', 'src', 'config', 'study-mode.json'),
];

for (const file of files) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ studyMode: enabled }, null, 2) + '\n', 'utf8');
    console.log(`[toggle-study-mode] ${enabled ? 'ENABLED' : 'DISABLED'} -> ${path.relative(process.cwd(), file)}`);
  } catch (e) {
    console.error(`[toggle-study-mode] Failed to write ${file}:`, e);
    process.exitCode = 1;
  }
}

