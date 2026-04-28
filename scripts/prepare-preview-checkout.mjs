#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const checkoutDir = process.argv[2];
if (!checkoutDir) {
  console.error('Usage: prepare-preview-checkout.mjs <checkout-dir>');
  process.exit(1);
}

const root = path.resolve(checkoutDir);

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function write(file, content) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Could not find ${label}`);
  }
  return source.replace(search, replacement);
}

const apiWrapper = `process.env.GP_HOOT_DB_PATH = process.env.GP_HOOT_DB_PATH || '/tmp/gamehub-preview/data/gp-hoot-db.json';
process.env.GP_HOOT_UPLOAD_ROOT = process.env.GP_HOOT_UPLOAD_ROOT || '/tmp/gamehub-preview/uploads';
process.env.GP_HOOT_SESSION_SECRET = process.env.GP_HOOT_SESSION_SECRET || 'gamehub-preview-session-secret';
process.env.SHARED_STATE_PATH = process.env.SHARED_STATE_PATH || '/tmp/gamehub-preview/shared-state.json';
module.exports = require('../server/server.js');
`;
write('api/index.js', apiWrapper);

const vercelConfig = `{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "version": 2,
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/api/index.js"
    }
  ]
}
`;
write('vercel.json', vercelConfig);

const pkg = JSON.parse(read('package.json'));
pkg.main = 'api/index.js';
pkg.scripts = pkg.scripts || {};
pkg.scripts.start = 'node api/index.js';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

let hubJs = read('assets/hub.js');
hubJs = replaceOnce(
  hubJs,
  "      path: 'https://gp-hoot.gplange.tech/gp-hoot',",
  "      path: (typeof window !== 'undefined' && window.location && window.location.hostname.endsWith('.vercel.app')) ? '/gp-hoot' : 'https://gp-hoot.gplange.tech/gp-hoot',",
  'GP-hoot path'
);

if (!hubJs.includes('function shouldUseRemoteSync()')) {
  hubJs = replaceOnce(
    hubJs,
    "  function getApiBase() {\n    return window.GAMEHUB_API_BASE || '';\n  }",
    "  function getApiBase() {\n    return window.GAMEHUB_API_BASE || '';\n  }\n\n  function shouldUseRemoteSync() {\n    const host = String(window.location?.hostname || '').toLowerCase();\n    return !!host && !host.endsWith('.vercel.app') && host !== 'localhost' && host !== '127.0.0.1';\n  }",
    'shouldUseRemoteSync insertion'
  );
}

hubJs = replaceOnce(
  hubJs,
  "      queueRemoteSync(state);",
  "      if (shouldUseRemoteSync()) queueRemoteSync(state);",
  'remote sync guard in save()'
);
hubJs = replaceOnce(
  hubJs,
  "    if (!window.fetch) return { ok: false, reason: 'no-fetch' };",
  "    if (!shouldUseRemoteSync()) return { ok: false, reason: 'disabled' };\n    if (!window.fetch) return { ok: false, reason: 'no-fetch' };",
  'remote sync guard in syncRemoteState()'
);
hubJs = replaceOnce(
  hubJs,
  "    if (!window.fetch) return null;",
  "    if (!shouldUseRemoteSync()) return null;\n    if (!window.fetch) return null;",
  'remote sync guard in loadRemoteState()'
);
hubJs = replaceOnce(
  hubJs,
  "  function startBackgroundRefresh() {\n    clearInterval(refreshTimer);\n    refreshTimer = setInterval(async () => {",
  "  function startBackgroundRefresh() {\n    clearInterval(refreshTimer);\n    if (!shouldUseRemoteSync()) return;\n    refreshTimer = setInterval(async () => {",
  'remote sync guard in startBackgroundRefresh()'
);
write('assets/hub.js', hubJs);

let serverJs = read('server/server.js');
serverJs = replaceOnce(
  serverJs,
  "  if (host && !host.startsWith('gp-hoot.gplange.tech')) {",
  "  if (host && !host.startsWith('gp-hoot.gplange.tech') && !host.endsWith('.vercel.app')) {",
  'preview GP-hoot redirect guard'
);
serverJs = replaceOnce(
  serverJs,
  "const SHARED_STATE_PATH = path.join(ROOT, '.data', 'shared-state.json');",
  "const SHARED_STATE_PATH = process.env.SHARED_STATE_PATH || '/tmp/gamehub-preview/shared-state.json';",
  'preview shared state path'
);
serverJs = replaceOnce(
  serverJs,
  "  return host === 'gplange.tech' || host === 'www.gplange.tech' || host.endsWith('.vercel.app');",
  "  return host === 'gplange.tech' || host === 'www.gplange.tech';",
  'preview shared state proxy guard'
);
write('server/server.js', serverJs);

console.log(`Prepared preview checkout at ${root}`);
