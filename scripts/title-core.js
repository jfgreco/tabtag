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
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut + ELLIPSIS;
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
  return sanitize(basename(cwd)) || 'claude';
}

function oscTitle(title) {
  return `\x1b]0;${title}\x07`;
}

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

module.exports = {
  sanitize, truncate, normalizePath, basename, resolveAlias, oscTitle, buildTitle,
  GLYPHS, MAX_PROMPT_LEN,
};
