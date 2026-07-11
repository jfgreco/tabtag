# Contributing to tabtag

Thanks for your interest in improving tabtag! It's a small, dependency-free
Claude Code plugin, so getting started is quick.

## Setup

You only need [Node.js](https://nodejs.org/) (18 or newer) on your PATH. There
are no dependencies to install.

```
git clone https://github.com/jfgreco/tabtag.git
cd tabtag
npm test        # or: node --test
```

## Project layout

| Path | What it is |
|---|---|
| `scripts/title-core.js` | Pure title engine (no I/O) — the state machine that maps hook events to titles. Fully unit-tested. |
| `scripts/set-title.js` | Hook entry point: reads the event JSON on stdin, manages per-session state, emits the `terminalSequence`. |
| `scripts/set-alias.js` | Backing CLI for the `/tabtag` command. |
| `hooks/hooks.json` | Wires the lifecycle hooks to `set-title.js`. |
| `commands/tabtag.md` | The `/tabtag` slash command definition. |
| `test/` | `node:test` suites for each script. |

## Guidelines

- **Keep it dependency-free.** The plugin runs on every hook event, including
  after every tool call — no runtime dependencies, ever.
- **Keep `title-core.js` pure.** All filesystem, environment, and process
  access lives in the entry-point scripts so the core stays trivially testable.
- **A broken hook must never disrupt a session.** Entry points swallow their
  own errors and exit 0.
- **Add tests** for any behavior change; run `npm test` and make sure the suite
  is green before opening a PR.

## Pull requests

1. Fork and branch off `main`.
2. Make your change with accompanying tests.
3. Ensure `npm test` passes locally — CI runs the same suite on Node 20, 22,
   and 24, and must be green to merge.
4. Use clear commit messages (this repo follows
   [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
   `fix:`, `docs:`, `chore:`, …).

## Reporting issues

Open an issue at https://github.com/jfgreco/tabtag/issues with your terminal,
OS, and Claude Code version, plus what you expected versus what you saw.
