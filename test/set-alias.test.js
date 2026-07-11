'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../scripts/title-core');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'set-alias.js');

function run(args, cwd, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env },
  });
}

function tmpSetup() {
  // realpathSync: on macOS os.tmpdir() is under /var, a symlink to /private/var.
  // set-alias.js resolves cwd via process.cwd() (which follows the symlink), so the
  // stored key is the real path — resolve here too or the map-key assertion drifts.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tabtag-test-')));
  return { dir, env: { CLAUDE_TABTAG_FILE: path.join(dir, 'tabtags.json'), CLAUDE_PROJECT_DIR: '' } };
}

test('set writes normalized cwd key with alias value', () => {
  const { dir, env } = tmpSetup();
  const r = run(['myapp'], dir, env);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /set to "myapp"/);
  const map = JSON.parse(fs.readFileSync(env.CLAUDE_TABTAG_FILE, 'utf8'));
  assert.deepEqual(map, { [core.normalizePath(dir, process.platform)]: 'myapp' });
});

test('show with no alias reports directory-name fallback', () => {
  const { dir, env } = tmpSetup();
  const r = run([], dir, env);
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`"${path.basename(dir)}"`));
  assert.match(r.stdout, /fallback/);
});

test('show after set reports the alias', () => {
  const { dir, env } = tmpSetup();
  run(['myapp'], dir, env);
  const r = run([], dir, env);
  assert.match(r.stdout, /"myapp"/);
  assert.match(r.stdout, /alias/);
});

test('multi-word alias is joined and stored', () => {
  const { dir, env } = tmpSetup();
  run(['myapp', 'bond'], dir, env);
  const map = JSON.parse(fs.readFileSync(env.CLAUDE_TABTAG_FILE, 'utf8'));
  assert.equal(Object.values(map)[0], 'myapp bond');
});

test('--clear removes the entry', () => {
  const { dir, env } = tmpSetup();
  run(['myapp'], dir, env);
  const r = run(['--clear'], dir, env);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Cleared/);
  const map = JSON.parse(fs.readFileSync(env.CLAUDE_TABTAG_FILE, 'utf8'));
  assert.deepEqual(map, {});
});

test('--clear with nothing set does not create the alias file', () => {
  const { dir, env } = tmpSetup();
  const r = run(['--clear'], dir, env);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No tabtag/);
  assert.ok(!fs.existsSync(env.CLAUDE_TABTAG_FILE));
});

test('alias that is only control chars is rejected with exit 1', () => {
  const { dir, env } = tmpSetup();
  const r = run(['\x1b\x07'], dir, env);
  assert.equal(r.status, 1);
});

test('corrupt existing file is replaced, not a crash', () => {
  const { dir, env } = tmpSetup();
  fs.writeFileSync(env.CLAUDE_TABTAG_FILE, '{broken');
  const r = run(['myapp'], dir, env);
  assert.equal(r.status, 0);
  const map = JSON.parse(fs.readFileSync(env.CLAUDE_TABTAG_FILE, 'utf8'));
  assert.equal(Object.values(map)[0], 'myapp');
});
