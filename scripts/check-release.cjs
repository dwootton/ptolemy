const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// Inspect tracked content, including ignored files accidentally added with git add -f.
// Report filenames only; never print a matched credential or study record.
const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbiddenPath = /(^|\/)(?:\.env(?:\..*)?|\.meridian|\.ptolemy|\.user[_-]study|logs|node_modules|\.yarn|__pycache__|\.DS_Store)(?:\/|$)|\.(?:vsix|zip|pyc|tsbuildinfo)$|^(?:out|webview-ui\/dist)\//;
const credential = /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}|\bgh[pousr]_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const errors = [];
for (const file of paths) {
  if (!fs.existsSync(file)) continue;
  if (forbiddenPath.test(file) && file !== '.env.example') errors.push(`Private or generated file: ${file}`);
  if (credential.test(fs.readFileSync(file, 'utf8'))) errors.push(`Possible credential: ${file}`);
}
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const settings = manifest.contributes.configuration.properties;
for (const name of ['meridian.instrumentation.enabled', 'meridian.firebase.enabled']) {
  if (settings[name].default !== false) errors.push(`Recording must be opt-in: ${name}`);
}
if (Object.values(manifest.scripts).some(command => /--allow-package-(?:all-secrets|secrets|env-file)/.test(command))) {
  errors.push('Packaging must not bypass credential checks');
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Release checks passed (${paths.length} tracked files).`);
}
