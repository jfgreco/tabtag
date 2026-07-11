# tabtag — project-first terminal tab titles for Claude Code

[![CI](https://github.com/jfgreco/tabtag/actions/workflows/ci.yml/badge.svg)](https://github.com/jfgreco/tabtag/actions/workflows/ci.yml)

> [!WARNING]
> **Known limitation — the title does not currently hold at idle.** Claude Code
> re-writes its own auto-generated tab title whenever a session *settles* (goes
> idle after a turn), and there is no hook that fires after that write and no
> setting to disable it. So this plugin's title paints correctly but gets
> overwritten a moment later — it "blips, then reverts." See
> [Known limitation](#known-limitation) for the mechanism, the reliable
> `claude --name` workaround, and the upstream issues being tracked.

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
already requires this). If tab titles never change after installing, update
Claude Code (run `claude update`) — older releases ignore the
`terminalSequence` hook output field.

## Usage

- `/tabtag myapp` — set the tab name for the current project
- `/tabtag` — show the current name and where it comes from
- `/tabtag --clear` — revert to the directory-name fallback

Names are stored in `~/.claude/tabtags.json` (plain JSON, hand-editable).

## Development

Run the test suite from the repo root (the plugin has no dependencies, so
there is nothing to install):

```
node --test      # or: npm test
```

## How it works

Lifecycle hooks (`SessionStart`, `UserPromptSubmit`, `Notification`,
`PostToolUse`, `Stop`, `SessionEnd`) run a small dependency-free Node script
that emits an OSC 0 title sequence via the hook `terminalSequence` output.
Claude Code has no setting to disable its own AI-generated titles, so the
plugin simply re-asserts its title on every event — including after every
tool call — to stay the last writer.

## Known limitation

**The plugin cannot hold the tab title once a session goes idle.** This is a
platform constraint, not a bug in the plugin:

- Claude Code writes its own auto-generated summary to the terminal title and
  re-asserts it whenever the session *settles* after a turn.
- The `terminalSequence` hook output (which this plugin uses, and which is real
  and supported in Claude Code 2.1.141+) only occupies the title in the brief
  window *before* Claude Code's own write. There is no hook that fires *after*
  it, so the plugin can never get the last word at idle.
- There is no `settings.json` key or environment variable to disable Claude
  Code's own title. Verified against the terminal-config, settings, and
  env-var docs on 2.1.195.

**Reliable workaround:** launch a session with an explicit name —

```
claude --name "myapp"
```

`--name` changes *what* Claude Code writes (a fixed name instead of an
AI summary) rather than fighting it, so it holds. The trade-offs: it is set
once at launch (no mid-session updates) and shows no live status glyphs.

**Tracking upstream** (a statusLine-style title template, an override setting,
or a hook that sets the session name would each fix this):

- [anthropics/claude-code#17951](https://github.com/anthropics/claude-code/issues/17951) — script-based terminal title configuration (like `statusLine`)
- [anthropics/claude-code#76092](https://github.com/anthropics/claude-code/issues/76092) — a setting to disable/customize the terminal title
- [anthropics/claude-code#67386](https://github.com/anthropics/claude-code/issues/67386) — let hooks set the session name

## Terminal notes

- **Windows Terminal**: works out of the box. Do NOT enable
  `suppressApplicationTitle` in your profile — it blocks this plugin's titles
  too.
- **macOS Terminal.app**: works; some zsh setups append their own title text.
- **tmux**: needs `set -g set-titles on`.
- **VS Code integrated terminal**: include `${sequence}` in the
  `terminal.integrated.tabs.title` setting.

## License

[MIT](LICENSE) © John Greco
