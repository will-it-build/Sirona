// Server-side only. Never import this module into public/ or expose the API key.
export const QWEN_MODEL = 'qwen3.7-flash';
const MAX_RESPONSE_BYTES = 128 * 1024;

export function qwenConfig(env) {
  const key = env.QWEN_API_KEY?.trim();
  if (!key || key.startsWith('sk-sp-') || /\s/.test(key))
    throw new Error('A pay-as-you-go QWEN_API_KEY is required. Do not use a Token Plan key.');
  let url;
  try { url = new URL(env.QWEN_BASE_URL); } catch { throw new Error('Set QWEN_BASE_URL from the Qwen Cloud API console.'); }
  // Only the explicitly chosen Qwen Cloud pay-as-you-go service can receive the key.
  const hostAllowed = url.hostname === 'maas.qwencloudapi.com';
  if (!hostAllowed || url.protocol !== 'https:' || url.port || url.username || url.password ||
      url.search || url.hash || !/^\/compatible-mode\/v1\/?$/.test(url.pathname))
    throw new Error('QWEN_BASE_URL must be the Qwen Cloud pay-as-you-go endpoint.');
  return { key, endpoint: url.href.replace(/\/$/, '') + '/chat/completions' };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Qwen returned an empty response.');
  let bytes = 0, content = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Qwen response exceeded the size limit.');
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function qwenJson(env, messages, { maxTokens = 2048, fetcher = fetch } = {}) {
  const { key, endpoint } = qwenConfig(env);
  if (!Array.isArray(messages) || !messages.length || messages.length > 4 ||
      messages.some(m => !['system', 'user'].includes(m.role) || typeof m.content !== 'string') ||
      new TextEncoder().encode(JSON.stringify(messages)).length > 8000)
    throw new Error('Qwen input must be a small set of system/user text messages.');
  if (!Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > 2048)
    throw new Error('Qwen output must be capped at 16–2048 tokens.');
  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: QWEN_MODEL, messages, max_tokens: maxTokens,
        enable_thinking: false, stream: false, response_format: { type: 'json_object' } }),
    });
  } catch { throw new Error('Qwen connection failed or timed out. No automatic retry was made.'); }
  // Workers supports manual/follow, not error. Manual + rejection of every non-2xx
  // prevents credentials following redirects to another destination.
  if (!response.ok) {
    await response.body?.cancel();
    // Never relay provider error bodies: they may echo keys or personal prompts.
    throw new Error(`Qwen request failed (HTTP ${response.status}). Check model access, region and billing.`);
  }
  let payload;
  try { payload = await boundedJson(response); }
  catch { throw new Error('Qwen returned an invalid, oversized or interrupted response.'); }
  const choice = payload.choices?.[0];
  if (choice?.finish_reason !== 'stop') throw new Error('Qwen did not return a complete answer.');
  let result;
  try { result = JSON.parse(choice.message.content); } catch { throw new Error('Qwen did not return valid JSON.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Qwen must return a JSON object.');
  const usage = {};
  for (const name of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const value = payload.usage?.[name];
    if (Number.isSafeInteger(value) && value >= 0) usage[name] = value;
  }
  return { result, usage, model: QWEN_MODEL };
}
