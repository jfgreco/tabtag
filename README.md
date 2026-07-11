# tabtag — project-first terminal tab titles for Claude Code

[![CI](https://github.com/jfgreco/tabtag/actions/workflows/ci.yml/badge.svg)](https://github.com/jfgreco/tabtag/actions/workflows/ci.yml)

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
