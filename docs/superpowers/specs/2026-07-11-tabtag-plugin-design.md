# Design: tabtag — Terminal Tab Naming Plugin for Claude Code

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan

## Problem

Claude Code dynamically sets the terminal tab title to an AI-generated summary of the
current task. With several sessions open across different repos, tabs become
indistinguishable — nothing tells you *which project* a tab belongs to. Anthropic has
closed the feature requests for a directory-name prefix as "not planned"
(anthropics/claude-code #26063, #62384, #52258, #21409), and no existing community
plugin supports a per-project short name (alias).

## Goals

- Tab title always leads with a short project identifier: a user-set alias, falling
  back to the directory basename.
- After the identifier, show live status: a glyph plus a truncated copy of the latest
  user prompt while Claude is working.
- Alias is set once per project with `/tabtag <alias>` and persisted globally.
- Zero token cost, zero added latency, no background processes, no dependencies.
- Publishable as a Claude Code plugin installable via
  `/plugin marketplace add <user>/<repo>`; works on Windows, macOS, Linux.

## Non-Goals

- Preserving Claude Code's *native* AI-generated title text (it overwrites any prefix;
  the plugin replaces the native summary with its own activity text and out-competes
  native writes by re-asserting on every hook event).
- AI-generated summaries of activity (rejected: cost/latency; truncated prompt chosen).
- Per-repo config files committed into projects (rejected: global map chosen).

## Decisions Made During Brainstorming

| Question | Decision |
|---|---|
| Title contents | Alias + own activity text (out-compete native titles by re-assertion; no suppress setting exists) |
| Alias storage | `/tabtag` command writing a global map in `~/.claude/tabtags.json`; fallback = directory basename |
| Activity text | First ~30 chars of the latest user prompt + status glyphs; no LLM calls |
| Scope | Publishable cross-platform plugin; hooks implemented in Node (already a Claude Code prerequisite) |
| Architecture | Pure hook plugin (Approach A) — lifecycle hooks → one Node script → `terminalSequence` output |
| Naming (renamed 2026-07-11) | Plugin `tabtag`; command `/tabtag`; map file `~/.claude/tabtags.json`; repo https://github.com/jfgreco/tabtag |

## Architecture

A Claude Code plugin whose hooks all route to a single Node script. Each hook
invocation reads the event JSON from stdin, computes the desired title, and prints
`{"terminalSequence": "\x1b]0;<title>\x07"}` (OSC 0 title sequence). Claude Code
emits the sequence through its own terminal write path — the official, race-free
mechanism for hooks to affect the terminal (requires a Claude Code version with
`terminalSequence` hook-output support; exact minimum version verified during
implementation).

**Clobber strategy (corrected during planning):** Claude Code has no setting or env
var that disables its native title writes — settings.md, env-vars.md, and the
changelog were all checked. (`suppressApplicationTitle` turned out to be a *Windows
Terminal profile* option, and it suppresses ALL app title changes including this
plugin's, so it must NOT be enabled.) The plugin instead **out-competes** native
writes by re-asserting the title on every hook event — including `PostToolUse` after
every tool call — making it the last writer throughout a turn. Whether native writes
visibly flash between hook events is an empirical question answered in the end-to-end
test task.

### Repository Layout

```
Claude.TabNamePlugin/
├── .claude-plugin/
│   ├── plugin.json          # plugin manifest (name, version, description, author)
│   └── marketplace.json     # marketplace manifest for /plugin marketplace add
├── hooks/
│   └── hooks.json           # wires lifecycle events → scripts/set-title.js
├── scripts/
│   └── set-title.js         # single Node script, zero npm dependencies
├── commands/
│   └── tabtag.md           # /tabtag slash command definition
├── docs/superpowers/specs/  # this document
└── README.md                # install, min version, per-terminal caveats
```

## Components

### 1. `scripts/set-title.js` — title engine

Responsibilities:

- Parse hook event JSON from stdin (`hook_event_name`, `cwd`, `session_id`, `prompt`
  where applicable).
- Resolve the project identifier: look up normalized `cwd` in
  `~/.claude/tabtags.json`; fall back to `basename(cwd)`.
- Map event → title (state machine below).
- Persist minimal per-session state (`{ lastPrompt, status }`) in a temp-dir file
  keyed by `session_id`, so a `⚠` (waiting) state can be restored to `●` (working)
  after the user approves a permission.
- Emit `{"terminalSequence": "<OSC 0 sequence>"}` on stdout, exit 0.

Path normalization for map keys: forward slashes; case-insensitive comparison on
Windows.

### 2. Title state machine

| Hook event | Condition | Title |
|---|---|---|
| `SessionStart` | — | `{alias} ✓` |
| `UserPromptSubmit` | — | `{alias} ● {prompt ≤30 chars}…` |
| `Notification` | permission request / idle-waiting | `{alias} ⚠` |
| `PostToolUse` | always | `{alias} ● {lastPrompt}` (re-assert working; also restores after `⚠`) |
| `Stop` | — | `{alias} ✓` |
| `SessionEnd` | — | `{alias}` (clean reset) |

`PostToolUse` serves two purposes: it fixes the "approved a permission but tab still
shows ⚠" lie (no dedicated resume event exists), and it continuously re-asserts the
plugin's title against Claude Code's native writes during long multi-tool turns.

### 3. `commands/tabtag.md` — alias management

- `/tabtag <alias>`: normalize current `cwd`, upsert into `~/.claude/tabtags.json`.
  The tab updates as soon as the command's turn ends: the `Stop` hook fires and
  rebuilds the title with the new alias (commands cannot emit `terminalSequence`
  themselves — only hooks can).
- `/tabtag` (no argument): show the alias currently in effect and its source
  (map entry vs. directory-name fallback).
- `/tabtag --clear`: remove the alias for the current directory (reverts to the
  directory-name fallback).

### 4. Data format — `~/.claude/tabtags.json`

```json
{
  "C:/Users/greco/source/repos/MyappBond": "myapp",
  "C:/Users/greco/source/repos/CustomsBSM": "customs"
}
```

## Platform Support

Cross-platform by construction: the hook returns the escape sequence to Claude Code
(`terminalSequence`), which writes it through its own output path on every OS — the
script never touches the terminal directly. Node is a Claude Code prerequisite on all
platforms, and the script uses only portable APIs (`os.homedir()`, `os.tmpdir()`)
plus the path normalization described above.

| Environment | Status |
|---|---|
| Windows Terminal (primary target) | Full support, OSC 0/2 native |
| macOS Terminal.app | Works; some zsh setups append their own title decorations (document in README) |
| iTerm2, GNOME Terminal, Konsole, Alacritty, Kitty, WezTerm, Ghostty | Full support |
| tmux / GNU screen | Works via Claude Code's write path; reflecting titles requires `set-titles on` (README note) |
| VS Code integrated terminal | Requires `${sequence}` in the `terminal.integrated.tabs.title` setting (README note) |

Glyph rendering (`● ✓ ⚠`) is cosmetic-only risk: a font lacking a glyph shows a
fallback box; the alias and prompt text are unaffected.

## Error Handling

Governing rule: **a broken hook must never disrupt a session.**

- Alias file missing, unreadable, or corrupt JSON → fall back to directory basename.
- Any unexpected error → exit 0 with no stdout (title simply doesn't change). Never
  exit non-zero; never write parse-breaking output.
- Prompt sanitization: strip control characters — in particular ESC (0x1B) and BEL
  (0x07) — **before** embedding prompt text in the escape sequence, then truncate to
  ~30 characters with an ellipsis. Prompt text is untrusted input inside a terminal
  escape sequence; injection must be impossible.
- State file unreadable/absent → `PostToolUse` still re-asserts the bare working title (alias + working glyph, no prompt text), preserving the re-assertion strategy.
- Older Claude Code without `terminalSequence` support → document minimum version in
  README and plugin description.

## Testing

- **Unit tests** (`node:test`, zero dependencies): title building is a pure function
  (event JSON + alias map + prior state → title string + next state). Cover: alias
  hit, basename fallback, corrupt map, truncation boundary, control-character
  sanitization, every state-machine transition, `PostToolUse` no-op path,
  Windows/POSIX path normalization.
- **End-to-end (manual)**: install locally, run a real session in Windows Terminal,
  walk every transition: session start → prompt → permission request → approve →
  finish → session end. Verify glyphs render and titles never flicker back to native.

## Verification Items — RESOLVED (against live docs, 2026-07-11)

1. **Stdin fields:** prompt text arrives as `user_input` on `UserPromptSubmit` (not
   `prompt`). Notifications carry `notification_type` (`permission_prompt`,
   `idle_prompt`, ...). All events include `hook_event_name`, `cwd`, `session_id`.
   `SessionStart` hooks require a matcher (`startup|resume|clear|compact`);
   `UserPromptSubmit` and `Stop` take no matcher.
2. **Minimum version for `terminalSequence`:** not stated in current docs; README
   will instruct "recent Claude Code (2026)" and describe how to verify.
3. **Plugin-shipped settings:** plugins' `settings.json` supports only `agent` and
   `subagentStatusLine` — and no title-suppression setting exists anyway. Superseded
   by the re-assertion strategy above.
4. **`marketplace.json` schema:** confirmed — `name`, `owner`, `plugins[{name,
   source: "."}]` for a repo-root plugin.

**Remaining empirical item (answered in the E2E task):** how often Claude Code
natively rewrites the title between hook events, and whether that produces visible
flicker against the re-assertion strategy.

## References

- Hooks reference (terminalSequence, event schemas): https://code.claude.com/docs/en/hooks.md
- Plugins reference (structure, hooks.json, commands): https://code.claude.com/docs/en/plugins-reference.md
- Closed feature requests: anthropics/claude-code #26063, #62384, #52258, #21409
- Prior art (no alias support, macOS-centric): bluzername/claude-code-terminal-title,
  STRML/cc-tab-titles, franzvill/claude-code-tab-title
