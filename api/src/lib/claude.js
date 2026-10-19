// Claude with tools, the one AI MyButler talks to. The key comes only from the environment (a Key Vault reference).
const RETRY = [404, 429, 500, 503, 529];
// A key counts only if it is set and resolved; an unresolved Key Vault reference stays as "@Microsoft.KeyVault(...)".
export const hasKey = () => { const v = process.env.ANTHROPIC_API_KEY; return !!v && !v.startsWith('@Microsoft.KeyVault('); };

async function post(body, timeout) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    return { res, data: await res.json().catch(() => ({})) };
  } finally { clearTimeout(t); }
}

// Messages and tool definitions in, the raw reply out ({ content, stop_reason, model }). The model is the app setting
// BUTLER_MODEL; if that model is unknown or overloaded, the fallback FALLBACK_MODEL is tried.
export async function claudeTools({ system, messages, tools, maxTokens = 2000, models = [], timeout = 120000 }) {
  if (!hasKey()) { const e = new Error('Claude has no API key'); e.code = 'not_configured'; throw e; }
  const list = [...new Set([...models, process.env.FALLBACK_MODEL].filter(Boolean))];
  if (!list.length) throw new Error('No Claude model set (BUTLER_MODEL)');
  let last = 'request failed';
  for (const model of list) {
    const { res, data } = await post({ model, max_tokens: maxTokens, system, messages, tools }, timeout);
    if (res.ok) return { ...data, model };
    last = `${res.status}: ${data?.error?.message || 'request failed'}`;
    if (!RETRY.includes(res.status) && !/model/i.test(last)) break;
  }
  throw new Error(`Claude ${last}`);
}
