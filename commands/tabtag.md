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
