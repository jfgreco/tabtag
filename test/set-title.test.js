'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'set-title.js');

function run(input, env) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function tmpSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabtag-test-'));
  return {
    dir,
    env: {
      CLAUDE_TABTAG_FILE: path.join(dir, 'tabtags.json'),
      CLAUDE_TABTAG_STATE_DIR: path.join(dir, 'state'),
    },
  };
}

test('UserPromptSubmit with alias configured emits full terminalSequence', () => {
  const { dir, env } = tmpSetup();
  fs.writeFileSync(env.CLAUDE_TABTAG_FILE, JSON.stringify({ [dir]: 'proj' }));
  const r = run({ session_id: 's1', cwd: dir, hook_event_name: 'UserPromptSubmit', user_input: 'do things' }, env);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { terminalSequence: '\x1b]0;proj ● do things\x07' });
});

test('corrupt alias file → basename fallback, still exit 0', () => {
  const { dir, env } = tmpSetup();
  fs.writeFileSync(env.CLAUDE_TABTAG_FILE, '{not json');
  const r = run({ session_id: 's1', cwd: dir, hook_event_name: 'Stop' }, env);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).terminalSequence, `\x1b]0;${path.basename(dir)} ✓\x07`);
});

test('garbage stdin → exit 0, no output', () => {
  const { env } = tmpSetup();
  const r = run('not json at all', env);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('no-op event (unmatched Notification) → exit 0, no output', () => {
  const { dir, env } = tmpSetup();
  const r = run({ session_id: 's1', cwd: dir, hook_event_name: 'Notification', notification_type: 'auth_success' }, env);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('state round-trip: UserPromptSubmit then PostToolUse restores the prompt', () => {
  const { dir, env } = tmpSetup();
  run({ session_id: 's9', cwd: dir, hook_event_name: 'UserPromptSubmit', user_input: 'fix tests' }, env);
  const r = run({ session_id: 's9', cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, env);
  assert.equal(JSON.parse(r.stdout).terminalSequence, `\x1b]0;${path.basename(dir)} ● fix tests\x07`);
});

test('sessions are isolated by session_id', () => {
  const { dir, env } = tmpSetup();
  run({ session_id: 'a', cwd: dir, hook_event_name: 'UserPromptSubmit', user_input: 'task A' }, env);
  const r = run({ session_id: 'b', cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, env);
  assert.equal(JSON.parse(r.stdout).terminalSequence, `\x1b]0;${path.basename(dir)} ●\x07`);
});

test('SessionEnd deletes state file and emits bare alias', () => {
  const { dir, env } = tmpSetup();
  run({ session_id: 's2', cwd: dir, hook_event_name: 'UserPromptSubmit', user_input: 'x' }, env);
  const stateFile = path.join(env.CLAUDE_TABTAG_STATE_DIR, 's2.json');
  assert.ok(fs.existsSync(stateFile), 'state file should exist after prompt');
  const r = run({ session_id: 's2', cwd: dir, hook_event_name: 'SessionEnd', reason: 'other' }, env);
  assert.ok(!fs.existsSync(stateFile), 'state file should be deleted');
  assert.equal(JSON.parse(r.stdout).terminalSequence, `\x1b]0;${path.basename(dir)}\x07`);
});

test('session_id with path characters cannot escape the state dir', () => {
  const { dir, env } = tmpSetup();
  const r = run({ session_id: '..\\..\\evil/../id', cwd: dir, hook_event_name: 'UserPromptSubmit', user_input: 'x' }, env);
  assert.equal(r.status, 0);
  const files = fs.readdirSync(env.CLAUDE_TABTAG_STATE_DIR);
  assert.equal(files.length, 1);
  assert.ok(!files[0].includes('..'));
});
