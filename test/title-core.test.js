'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../scripts/title-core');

test('sanitize strips control chars (ESC, BEL, newlines) and collapses whitespace', () => {
  assert.equal(core.sanitize('fix\x1b]0;evil\x07 the\n\tbug'), 'fix ]0;evil the bug');
  assert.equal(core.sanitize('  padded  '), 'padded');
  assert.equal(core.sanitize(undefined), '');
  assert.equal(core.sanitize(42), '');
});

test('truncate cuts at 30 chars and appends ellipsis', () => {
  assert.equal(core.truncate('a'.repeat(35)), 'a'.repeat(30) + '…');
  assert.equal(core.truncate('a'.repeat(30)), 'a'.repeat(30));
  assert.equal(core.truncate('short'), 'short');
});

test('truncate does not split a surrogate pair at the cut point', () => {
  assert.equal(core.truncate('a'.repeat(29) + '😀tail'), 'a'.repeat(29) + '…');
});

test('normalizePath: backslashes to slashes, trailing slash stripped, win32 lowercased', () => {
  assert.equal(core.normalizePath('C:\\Users\\Greco\\Repos\\Myapp\\', 'win32'), 'c:/users/greco/repos/myapp');
  assert.equal(core.normalizePath('/home/user/Myapp/', 'linux'), '/home/user/Myapp');
  assert.equal(core.normalizePath('', 'win32'), '');
});

test('basename returns last segment with original casing', () => {
  assert.equal(core.basename('C:\\repos\\CustomsBSM'), 'CustomsBSM');
  assert.equal(core.basename('/home/user/Myapp/'), 'Myapp');
});

test('resolveAlias: map hit is case-insensitive on win32', () => {
  const map = { 'C:/Users/Greco/Repos/Myapp': 'myapp' };
  assert.equal(core.resolveAlias('c:\\users\\greco\\repos\\myapp', map, 'win32'), 'myapp');
});

test('resolveAlias: no hit falls back to basename', () => {
  assert.equal(core.resolveAlias('C:\\repos\\CustomsBSM', {}, 'win32'), 'CustomsBSM');
});

test('resolveAlias: alias value is sanitized; empty alias falls through to basename', () => {
  assert.equal(core.resolveAlias('C:\\repos\\Myapp', { 'C:/repos/Myapp': 'sh\x1bea' }, 'win32'), 'sh ea');
  assert.equal(core.resolveAlias('C:\\repos\\Myapp', { 'C:/repos/Myapp': '  ' }, 'win32'), 'Myapp');
});

test('resolveAlias: null/missing map tolerated', () => {
  assert.equal(core.resolveAlias('C:\\repos\\Myapp', null, 'win32'), 'Myapp');
});

test('resolveAlias: basename fallback is sanitized (no control chars reach the title)', () => {
  assert.equal(core.resolveAlias('/tmp/pwn\x07\x1b]0;evil', {}, 'linux'), 'pwn ]0;evil');
});

test('resolveAlias: empty/control-only basename falls back to "claude"', () => {
  assert.equal(core.resolveAlias('/', {}, 'linux'), 'claude');
});

test('oscTitle wraps title in OSC 0 with BEL terminator', () => {
  assert.equal(core.oscTitle('Myapp ✓'), '\x1b]0;Myapp ✓\x07');
});

const EVT = (over) => ({ session_id: 's1', cwd: 'C:\\repos\\Myapp', ...over });

test('buildTitle SessionStart → "alias ✓", fresh state', () => {
  const r = core.buildTitle(EVT({ hook_event_name: 'SessionStart', source: 'startup' }), {}, null, 'win32');
  assert.equal(r.title, 'Myapp ✓');
  assert.deepEqual(r.nextState, { status: 'done', lastPrompt: '' });
});

test('buildTitle UserPromptSubmit → "alias ● <truncated user_input>"', () => {
  const r = core.buildTitle(
    EVT({ hook_event_name: 'UserPromptSubmit', user_input: 'fix the failing xUnit tests in the billing module' }),
    {}, null, 'win32');
  assert.equal(r.title, 'Myapp ● fix the failing xUnit tests in…');
  assert.deepEqual(r.nextState, { status: 'working', lastPrompt: 'fix the failing xUnit tests in…' });
});

test('buildTitle UserPromptSubmit with empty/missing user_input → bare working glyph', () => {
  const r = core.buildTitle(EVT({ hook_event_name: 'UserPromptSubmit' }), {}, null, 'win32');
  assert.equal(r.title, 'Myapp ●');
  assert.deepEqual(r.nextState, { status: 'working', lastPrompt: '' });
});

test('buildTitle Notification permission_prompt → "alias ⚠", preserves lastPrompt', () => {
  const prior = { status: 'working', lastPrompt: 'fix tests' };
  const r = core.buildTitle(EVT({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }), {}, prior, 'win32');
  assert.equal(r.title, 'Myapp ⚠');
  assert.deepEqual(r.nextState, { status: 'waiting', lastPrompt: 'fix tests' });
});

test('buildTitle Notification idle_prompt → "alias ⚠"', () => {
  const r = core.buildTitle(EVT({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }), {}, null, 'win32');
  assert.equal(r.title, 'Myapp ⚠');
});

test('buildTitle Notification other types → no-op', () => {
  const r = core.buildTitle(EVT({ hook_event_name: 'Notification', notification_type: 'auth_success' }), {}, null, 'win32');
  assert.equal(r.title, null);
  assert.equal(r.nextState, null);
});

test('buildTitle PostToolUse re-asserts working title from prior state (⚠ restore)', () => {
  const prior = { status: 'waiting', lastPrompt: 'fix tests' };
  const r = core.buildTitle(EVT({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }), {}, prior, 'win32');
  assert.equal(r.title, 'Myapp ● fix tests');
  assert.deepEqual(r.nextState, { status: 'working', lastPrompt: 'fix tests' });
});

test('buildTitle PostToolUse with no prior state → bare working glyph', () => {
  const r = core.buildTitle(EVT({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }), {}, null, 'win32');
  assert.equal(r.title, 'Myapp ●');
});

test('buildTitle Stop → "alias ✓", keeps lastPrompt for later PostToolUse', () => {
  const prior = { status: 'working', lastPrompt: 'fix tests' };
  const r = core.buildTitle(EVT({ hook_event_name: 'Stop' }), {}, prior, 'win32');
  assert.equal(r.title, 'Myapp ✓');
  assert.deepEqual(r.nextState, { status: 'done', lastPrompt: 'fix tests' });
});

test('buildTitle SessionEnd → bare alias, null state', () => {
  const r = core.buildTitle(EVT({ hook_event_name: 'SessionEnd', reason: 'other' }), {}, null, 'win32');
  assert.equal(r.title, 'Myapp');
  assert.equal(r.nextState, null);
});

test('buildTitle unknown event → no-op', () => {
  const r = core.buildTitle(EVT({ hook_event_name: 'PreCompact' }), {}, null, 'win32');
  assert.equal(r.title, null);
  assert.equal(r.nextState, null);
});

test('buildTitle uses alias from map', () => {
  const map = { 'C:/repos/Myapp': 'myapp' };
  const r = core.buildTitle(EVT({ hook_event_name: 'Stop' }), map, null, 'win32');
  assert.equal(r.title, 'myapp ✓');
});
