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
  if (process.env.CLAUDE_TABTAG_STATE_DIR) return process.env.CLAUDE_TABTAG_STATE_DIR;
  let user = '';
  try { user = os.userInfo().username.replace(/[^A-Za-z0-9_-]/g, '_'); } catch { /* fall back to shared dir */ }
  return path.join(os.tmpdir(), user ? `claude-tabtag-${user}` : 'claude-tabtag');
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
      fs.mkdirSync(stateDirPath(), { recursive: true, mode: 0o700 });
      fs.writeFileSync(stateFile, JSON.stringify(nextState));
    } catch { /* state is best-effort */ }
  }

  if (title !== null) {
    process.stdout.write(JSON.stringify({ terminalSequence: core.oscTitle(title) }));
  }
}

try { main(); } catch { /* a broken hook must never disrupt a session */ }
