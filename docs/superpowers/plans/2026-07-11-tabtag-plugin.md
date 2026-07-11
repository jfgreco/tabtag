# tabtag Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A publishable Claude Code plugin that sets the terminal tab title to a per-project short name plus live status (`myapp ● fixing tests` / `myapp ✓` / `myapp ⚠`), managed with a `/tabtag` command.

**Architecture:** Six lifecycle hooks all invoke one Node script that reads the hook event JSON from stdin, resolves an alias from a global map (fallback: directory basename), applies a small state machine, and returns `{"terminalSequence": "<OSC 0 title>"}` for Claude Code to emit. There is no setting to disable Claude Code's own title writes, so the plugin out-competes them by re-asserting on every event, including `PostToolUse` after every tool call. A second small script backs the `/tabtag` command.

**Tech Stack:** Node.js (CommonJS, zero npm dependencies), `node:test` for tests, Claude Code plugin format (hooks + commands + marketplace manifest).

**Spec:** `docs/superpowers/specs/2026-07-11-tabtag-plugin-design.md` (approved 2026-07-11).

## Global Constraints

- Zero npm dependencies; CommonJS modules; no `package.json` needed (`node --test` runs the suite).
- Node.js >= 18 assumed (ships with every Claude Code install).
- `set-title.js` must ALWAYS exit 0 and emit either valid JSON or nothing — a broken hook must never disrupt a session.
- Glyphs, exact: working `●` (U+25CF), done `✓` (U+2713), waiting `⚠` (U+26A0).
- Prompt text in titles: control characters stripped BEFORE embedding (ESC 0x1B and BEL 0x07 included), whitespace collapsed, truncated to 30 chars + `…` (U+2026).
- Title escape sequence format, exact: `\x1b]0;<title>\x07` (OSC 0, BEL-terminated — on the docs' allowlist for `terminalSequence`).
- Alias map file: `~/.claude/tabtags.json`; per-session state: `<os.tmpdir()>/claude-tabtag-<username>/<session_id>.json (fallback claude-tabtag if the username is unavailable)`. Both paths overridable via env vars `CLAUDE_TABTAG_FILE` and `CLAUDE_TABTAG_STATE_DIR` (for tests).
- Path keys compare with forward slashes, no trailing slash, case-insensitive on `win32` only.
- Hook stdin facts (verified against https://code.claude.com/docs/en/hooks.md, 2026-07-11): every event has `hook_event_name`, `cwd`, `session_id`; `UserPromptSubmit` carries the prompt in **`user_input`**; `Notification` carries **`notification_type`** (`permission_prompt`, `idle_prompt`, ...); `SessionStart` hook registrations REQUIRE a matcher (`startup|resume|clear|compact`); `UserPromptSubmit` and `Stop` registrations take no matcher.
- Working directory for all commands: repo root `C:\Users\greco\source\repos\Claude.TabNamePlugin`.
- Commit after every task; messages in conventional-commit style ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Title core — pure helpers

**Files:**
- Create: `scripts/title-core.js`
- Test: `test/title-core.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (later tasks rely on these exact exports from `scripts/title-core.js`):
  - `sanitize(text: string) -> string` — strips control chars, collapses whitespace, trims.
  - `truncate(text: string, max?: number) -> string` — default max 30, appends `…` when cut.
  - `normalizePath(p: string, platform: string) -> string` — forward slashes, no trailing slash, lowercased when `platform === 'win32'`.
  - `basename(p: string) -> string` — last path segment, original casing preserved.
  - `resolveAlias(cwd: string, aliasMap: object, platform: string) -> string` — map hit (normalized-key compare) or basename fallback.
  - `oscTitle(title: string) -> string` — `\x1b]0;<title>\x07`.
  - Constants: `GLYPHS = { working: '●', done: '✓', waiting: '⚠' }`, `MAX_PROMPT_LEN = 30`.

- [ ] **Step 1: Write the failing tests**

Create `test/title-core.test.js`:

```js
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

test('oscTitle wraps title in OSC 0 with BEL terminator', () => {
  assert.equal(core.oscTitle('Myapp ✓'), '\x1b]0;Myapp ✓\x07');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/title-core.test.js`
Expected: FAIL — `Cannot find module '../scripts/title-core'`

- [ ] **Step 3: Write the implementation**

Create `scripts/title-core.js`:

```js
'use strict';

const GLYPHS = { working: '●', done: '✓', waiting: '⚠' };
const MAX_PROMPT_LEN = 30;
const ELLIPSIS = '…';

// Prompt/alias text ends up inside a terminal escape sequence, so control
// characters (C0 incl. ESC/BEL, DEL, C1) must be impossible to smuggle through.
function sanitize(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max = MAX_PROMPT_LEN) {
  if (text.length <= max) return text;
  return text.slice(0, max) + ELLIPSIS;
}

function normalizePath(p, platform) {
  if (typeof p !== 'string' || p === '') return '';
  let n = p.replace(/\\/g, '/');
  if (n.length > 1 && n.endsWith('/')) n = n.slice(0, -1);
  if (platform === 'win32') n = n.toLowerCase();
  return n;
}

function basename(p) {
  const n = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const i = n.lastIndexOf('/');
  return i === -1 ? n : n.slice(i + 1);
}

function resolveAlias(cwd, aliasMap, platform) {
  const key = normalizePath(cwd, platform);
  for (const mapPath of Object.keys(aliasMap || {})) {
    if (normalizePath(mapPath, platform) === key) {
      const alias = sanitize(String(aliasMap[mapPath]));
      if (alias !== '') return alias;
    }
  }
  return basename(cwd) || 'claude';
}

function oscTitle(title) {
  return `\x1b]0;${title}\x07`;
}

module.exports = {
  sanitize, truncate, normalizePath, basename, resolveAlias, oscTitle,
  GLYPHS, MAX_PROMPT_LEN,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/title-core.test.js`
Expected: PASS — `# pass 9`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add scripts/title-core.js test/title-core.test.js
git commit -m "feat: title-core helpers (sanitize, truncate, path normalization, alias resolution)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Title core — state machine (`buildTitle`)

**Files:**
- Modify: `scripts/title-core.js` (add `buildTitle`, extend exports)
- Test: `test/title-core.test.js` (append tests)

**Interfaces:**
- Consumes: Task 1 helpers (`resolveAlias`, `sanitize`, `truncate`, `GLYPHS`).
- Produces: `buildTitle(event: object, aliasMap: object, priorState: object|null, platform: string) -> { title: string|null, nextState: {status, lastPrompt}|null }`.
  - `title === null` → caller emits nothing (no-op).
  - `nextState === null` → caller leaves/removes state (SessionEnd deletes it; no-ops leave it).
  - Task 3's wrapper depends on this exact signature and semantics.

- [ ] **Step 1: Write the failing tests**

Append to `test/title-core.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/title-core.test.js`
Expected: FAIL — `core.buildTitle is not a function` (the 9 Task 1 tests still pass)

- [ ] **Step 3: Write the implementation**

Add to `scripts/title-core.js` (above `module.exports`), and add `buildTitle` to the exports object:

```js
// event → { title, nextState }. title null = emit nothing; nextState null =
// don't write state (SessionEnd's caller deletes the state file instead).
function buildTitle(event, aliasMap, priorState, platform) {
  const alias = resolveAlias(event.cwd || '', aliasMap, platform);
  const prior = priorState && typeof priorState === 'object'
    ? { status: String(priorState.status || 'done'), lastPrompt: sanitize(priorState.lastPrompt) }
    : { status: 'done', lastPrompt: '' };
  const working = (prompt) =>
    prompt === '' ? `${alias} ${GLYPHS.working}` : `${alias} ${GLYPHS.working} ${prompt}`;

  switch (event.hook_event_name) {
    case 'SessionStart':
      return { title: `${alias} ${GLYPHS.done}`, nextState: { status: 'done', lastPrompt: '' } };
    case 'UserPromptSubmit': {
      const prompt = truncate(sanitize(event.user_input));
      return { title: working(prompt), nextState: { status: 'working', lastPrompt: prompt } };
    }
    case 'Notification':
      if (event.notification_type === 'permission_prompt' || event.notification_type === 'idle_prompt') {
        return { title: `${alias} ${GLYPHS.waiting}`, nextState: { status: 'waiting', lastPrompt: prior.lastPrompt } };
      }
      return { title: null, nextState: null };
    case 'PostToolUse':
      return { title: working(prior.lastPrompt), nextState: { status: 'working', lastPrompt: prior.lastPrompt } };
    case 'Stop':
      return { title: `${alias} ${GLYPHS.done}`, nextState: { status: 'done', lastPrompt: prior.lastPrompt } };
    case 'SessionEnd':
      return { title: alias, nextState: null };
    default:
      return { title: null, nextState: null };
  }
}
```

Note: `lastPrompt` is stored already-truncated (Task 2 test asserts `lastPrompt: 'fix the failing xUnit tests in…'`), so `working(prior.lastPrompt)` needs no re-truncation. The `…` (U+2026) is not a control char, so re-`sanitize` of prior state preserves it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/title-core.test.js`
Expected: PASS — `# pass 21`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add scripts/title-core.js test/title-core.test.js
git commit -m "feat: buildTitle state machine for all six hook events

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `set-title.js` — hook entry point (I/O wrapper)

**Files:**
- Create: `scripts/set-title.js`
- Test: `test/set-title.test.js`

**Interfaces:**
- Consumes: `buildTitle` and `oscTitle` from `scripts/title-core.js` (Task 1/2 signatures).
- Produces: an executable contract, not a JS API — `node scripts/set-title.js` reads one hook-event JSON object on stdin and writes `{"terminalSequence":"\x1b]0;<title>\x07"}` (or nothing) to stdout, always exit 0. Env overrides: `CLAUDE_TABTAG_FILE`, `CLAUDE_TABTAG_STATE_DIR`. Task 5's `hooks.json` invokes exactly this.

- [ ] **Step 1: Write the failing tests**

Create `test/set-title.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/set-title.test.js`
Expected: FAIL — spawn of missing `scripts/set-title.js` (`status` non-zero / `Cannot find module`)

- [ ] **Step 3: Write the implementation**

Create `scripts/set-title.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./title-core');

function aliasFilePath() {
  return process.env.CLAUDE_TABTAG_FILE || path.join(os.homedir(), '.claude', 'tabtags.json');
}

function stateDirPath() {
  return process.env.CLAUDE_TABTAG_STATE_DIR || path.join(os.tmpdir(), 'claude-tabtag');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function main() {
  let event;
  try { event = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  if (!event || typeof event !== 'object') return;

  const aliasMap = readJson(aliasFilePath()) || {};
  const sessionId = String(event.session_id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  const stateFile = path.join(stateDirPath(), `${sessionId}.json`);
  const priorState = readJson(stateFile);

  const { title, nextState } = core.buildTitle(event, aliasMap, priorState, process.platform);

  if (event.hook_event_name === 'SessionEnd') {
    try { fs.unlinkSync(stateFile); } catch { /* already gone */ }
  } else if (nextState) {
    try {
      fs.mkdirSync(stateDirPath(), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(nextState));
    } catch { /* state is best-effort */ }
  }

  if (title !== null) {
    process.stdout.write(JSON.stringify({ terminalSequence: core.oscTitle(title) }));
  }
}

try { main(); } catch { /* a broken hook must never disrupt a session */ }
```

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `node --test`
Expected: PASS — `# pass 29`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add scripts/set-title.js test/set-title.test.js
git commit -m "feat: set-title hook entry point with per-session state and fail-safe I/O

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `set-alias.js` — backing script for /tabtag

**Files:**
- Create: `scripts/set-alias.js`
- Test: `test/set-alias.test.js`

**Interfaces:**
- Consumes: `normalizePath`, `resolveAlias`, `sanitize` from `scripts/title-core.js`.
- Produces: executable contract — `node scripts/set-alias.js [alias... | --clear]` run with the project as cwd. No args: prints current name + source. Alias args: sanitizes, upserts `{normalizedCwd: alias}` into the alias file, prints confirmation. `--clear`: removes the entry. Honors `CLAUDE_TABTAG_FILE`. Exit 1 only for invalid alias input (this is a CLI, not a hook). Task 5's `commands/tabtag.md` invokes exactly this.

- [ ] **Step 1: Write the failing tests**

Create `test/set-alias.test.js`:

```js
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabtag-test-'));
  return { dir, env: { CLAUDE_TABTAG_FILE: path.join(dir, 'tabtags.json') } };
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/set-alias.test.js`
Expected: FAIL — missing `scripts/set-alias.js`

- [ ] **Step 3: Write the implementation**

Create `scripts/set-alias.js`:

```js
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
  const cwd = process.cwd();
  const key = core.normalizePath(cwd, process.platform);
  const map = readMap(file);
  const arg = process.argv.slice(2).join(' ').trim();

  if (arg === '') {
    const name = core.resolveAlias(cwd, map, process.platform);
    const hasEntry = Object.keys(map).some((p) => core.normalizePath(p, process.platform) === key);
    console.log(`Tabtag for ${cwd}: "${name}" (${hasEntry ? 'alias' : 'directory-name fallback'})`);
    return;
  }

  if (arg === '--clear') {
    const removed = deleteEntry(map, key);
    writeMap(file, map);
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

main();
```

- [ ] **Step 4: Run the full suite**

Run: `node --test`
Expected: PASS — `# pass 36`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add scripts/set-alias.js test/set-alias.test.js
git commit -m "feat: set-alias CLI for managing the global tabtag map

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Plugin packaging — manifests, hooks wiring, /tabtag command

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `hooks/hooks.json`
- Create: `commands/tabtag.md`
- Create: `.gitignore`

**Interfaces:**
- Consumes: the executable contracts of `scripts/set-title.js` (Task 3) and `scripts/set-alias.js` (Task 4).
- Produces: an installable plugin named `tabtag` in marketplace `jfgreco-plugins`; a user-facing `/tabtag` command. Task 6 installs exactly this.

- [ ] **Step 1: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "tabtag",
  "description": "Terminal tab titles that lead with a per-project short name plus live status — 'myapp ● fixing tests' while working, 'myapp ✓' when done, 'myapp ⚠' when input is needed. Set names with /tabtag.",
  "version": "0.1.0",
  "author": {
    "name": "John Greco"
  }
}
```

- [ ] **Step 2: Create `.claude-plugin/marketplace.json`**

```json
{
  "name": "jfgreco-plugins",
  "owner": {
    "name": "John Greco"
  },
  "plugins": [
    {
      "name": "tabtag",
      "source": "."
    }
  ]
}
```

- [ ] **Step 3: Create `hooks/hooks.json`**

Note: `SessionStart` requires a matcher; `UserPromptSubmit`, `PostToolUse` (deliberately unmatched = all tools), `Stop`, and `SessionEnd` are registered without one; `Notification` filters to the two "needs input" types.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/set-title.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/set-title.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt|idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/set-title.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/set-title.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/set-title.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/set-title.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Create `commands/tabtag.md`**

```markdown
---
description: Set, show, or clear the short tab name (alias) for the current project directory
argument-hint: "[alias | --clear]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Manage the per-project tab name used by the tabtag plugin.

Run exactly this command with the Bash tool:

node "${CLAUDE_PLUGIN_ROOT}/scripts/set-alias.js" $ARGUMENTS

Relay the script's output to the user verbatim. Do not edit
~/.claude/tabtags.json directly; the script owns that file. Do not run
anything else.
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
```

- [ ] **Step 6: Validate all JSON files parse**

Run:
```bash
node -e "['.claude-plugin/plugin.json','.claude-plugin/marketplace.json','hooks/hooks.json'].forEach(f => { JSON.parse(require('fs').readFileSync(f, 'utf8')); console.log(f + ' OK'); })"
```
Expected: three `... OK` lines, exit 0.

Also run `claude plugin validate .` if that subcommand exists in the installed CLI (`claude plugin --help` to check); if it exists, expected: validation passes. If it doesn't exist, the JSON parse check above suffices.

- [ ] **Step 7: Run the full test suite (regression check)**

Run: `node --test`
Expected: PASS — `# pass 36`, `# fail 0`

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin hooks commands .gitignore
git commit -m "feat: package as installable plugin (manifests, hook wiring, /tabtag command)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: README, local install, and manual end-to-end verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything (installs the packaged plugin from Tasks 1-5).
- Produces: the shippable repo plus recorded E2E findings (including the spec's one remaining empirical question: does Claude Code's native title visibly fight the re-assertion strategy?).

- [ ] **Step 1: Write `README.md`**

```markdown
# tabtag — project-first terminal tab titles for Claude Code

Tabs get confusing when several Claude Code sessions are open. This plugin
makes every tab lead with a short per-project name, followed by live status:

| Tab title | Meaning |
|---|---|
| `myapp ● fix the failing xUnit te…` | Working (shows your latest prompt, truncated) |
| `myapp ✓` | Done — waiting for your next prompt |
| `myapp ⚠` | Needs your input (permission prompt or idle) |

The name is the directory basename by default; set a custom short name once
per project with `/tabtag`.

## Install

```
/plugin marketplace add jfgreco/tabtag
/plugin install tabtag@jfgreco-plugins
```

Requires a recent Claude Code (2026+) — the plugin relies on the
`terminalSequence` hook output field. Requires Node.js on PATH (Claude Code
already requires this).

## Usage

- `/tabtag myapp` — set the tab name for the current project
- `/tabtag` — show the current name and where it comes from
- `/tabtag --clear` — revert to the directory-name fallback

Names are stored in `~/.claude/tabtags.json` (plain JSON, hand-editable).

## How it works

Lifecycle hooks (`SessionStart`, `UserPromptSubmit`, `Notification`,
`PostToolUse`, `Stop`, `SessionEnd`) run a small dependency-free Node script
that emits an OSC 0 title sequence via the hook `terminalSequence` output.
Claude Code has no setting to disable its own AI-generated titles, so the
plugin simply re-asserts its title on every event — including after every
tool call — to stay the last writer.

## Terminal notes

- **Windows Terminal**: works out of the box. Do NOT enable
  `suppressApplicationTitle` in your profile — it blocks this plugin's titles
  too.
- **macOS Terminal.app**: works; some zsh setups append their own title text.
- **tmux**: needs `set -g set-titles on`.
- **VS Code integrated terminal**: include `${sequence}` in the
  `terminal.integrated.tabs.title` setting.
```

- [ ] **Step 2: Commit the README**

```bash
git add README.md
git commit -m "docs: README with install, usage, and terminal caveats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Install the plugin locally**

In a Claude Code session (this one or a new one):

```
/plugin marketplace add C:\Users\greco\source\repos\Claude.TabNamePlugin
/plugin install tabtag@jfgreco-plugins
```

Then start a NEW Claude Code session in a different project directory (hooks register at session start).
Expected: install succeeds; `/tabtag` appears in the command list.

- [ ] **Step 4: Manual E2E walkthrough (Windows Terminal)**

Record each observation (pass/fail + notes):

1. New session starts → tab shows `<dirname> ✓`.
2. `/tabtag demo` → output confirms; when the turn ends, tab shows `demo ✓`.
3. Submit `list the files in this directory` → tab shows `demo ● list the files in this direc…` while working, `demo ✓` when finished.
4. Trigger a permission prompt (e.g., ask Claude to run a command that needs approval) → tab shows `demo ⚠`; approve it → tab returns to `demo ● …` after the next tool completes; `demo ✓` at the end.
5. **Empirical question from the spec:** watch for Claude Code's native AI titles flashing between hook events during a long multi-tool turn. Record how often (never / brief flicker / persistent).
6. `/tabtag --clear` → next turn end, tab shows the directory name again.
7. `/exit` (SessionEnd) → tab shows the bare name.

- [ ] **Step 5: Record findings and finish**

- If step 4.5 shows persistent native-title wins: add a `PreToolUse` hook entry to `hooks/hooks.json` (same command block as `PostToolUse`) to double the re-assertion density, and re-test.
- Append an "E2E findings" note to the README's How-it-works section if any caveat emerged.

```bash
git add -A
git commit -m "docs: record E2E findings from Windows Terminal walkthrough

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Plan Self-Review (completed)

- **Spec coverage:** title engine (T1-2), fail-safe wrapper + state (T3), alias CLI (T4), `/tabtag` + packaging + hook wiring incl. required SessionStart matcher (T5), README/platform caveats + empirical clobber test (T6). Error-handling rules and sanitization from the spec are enforced by tests in T1/T3/T4.
- **Placeholder scan:** every code step contains complete code; no TBDs.
- **Type consistency:** `buildTitle(event, aliasMap, priorState, platform)` and `{title, nextState:{status,lastPrompt}}` used identically in T2 (definition), T3 (consumption); env override names `CLAUDE_TABTAG_FILE`/`CLAUDE_TABTAG_STATE_DIR` identical in T3/T4/T5-command; glyphs and OSC format identical everywhere.
