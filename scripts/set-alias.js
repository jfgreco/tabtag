#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./title-core');

const MAX_ALIAS_LEN = 40;

function aliasFilePath() {
  return process.env.CLAUDE_TABTAG_FILE || path.join(os.homedir(), '.claude', 'tabtags.json');
}

function readMap(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through to empty map */ }
  return {};
}

function writeMap(file, map) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
}

function deleteEntry(map, key) {
  let removed = false;
  for (const p of Object.keys(map)) {
    if (core.normalizePath(p, process.platform) === key) { delete map[p]; removed = true; }
  }
  return removed;
}

function main() {
  const file = aliasFilePath();
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const key = core.normalizePath(cwd, process.platform);
  const map = readMap(file);
  const arg = process.argv.slice(2).join(' ').trim();

  if (arg === '') {
    const name = core.resolveAlias(cwd, map, process.platform);
    const entry = Object.keys(map).find((p) => core.normalizePath(p, process.platform) === key);
    const hasAlias = entry !== undefined && core.sanitize(String(map[entry])) !== '';
    console.log(`Tabtag for ${cwd}: "${name}" (${hasAlias ? 'alias' : 'directory-name fallback'})`);
    return;
  }

  if (arg === '--clear') {
    const removed = deleteEntry(map, key);
    if (removed) writeMap(file, map);
    console.log(removed ? `Cleared tabtag for ${cwd}` : `No tabtag was set for ${cwd}`);
    return;
  }

  const alias = core.sanitize(arg);
  if (alias === '' || alias.length > MAX_ALIAS_LEN) {
    console.error(`Alias must be 1-${MAX_ALIAS_LEN} printable characters.`);
    process.exitCode = 1;
    return;
  }
  deleteEntry(map, key);
  map[key] = alias;
  writeMap(file, map);
  console.log(`Tabtag for ${cwd} set to "${alias}" — the tab updates at the end of this turn.`);
}

try {
  main();
} catch (err) {
  console.error(`tabtag: ${err.message}`);
  process.exitCode = 1;
}
