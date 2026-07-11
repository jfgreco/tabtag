# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-11

### Added

- Initial release. Terminal tab titles that lead with a short per-project name
  plus live status: `● <prompt>` while working, `✓` when done, `⚠` when input
  is needed.
- `/tabtag` command to set, show, or clear the per-project name (stored in
  `~/.claude/tabtags.json`; falls back to the directory basename).
- Lifecycle hooks (`SessionStart`, `UserPromptSubmit`, `Notification`,
  `PostToolUse`, `Stop`, `SessionEnd`) that emit an OSC 0 title via the
  `terminalSequence` hook output, re-asserting on every event.
- Dependency-free implementation with a fully unit-tested title engine.

[0.1.0]: https://github.com/jfgreco/tabtag/releases/tag/v0.1.0
