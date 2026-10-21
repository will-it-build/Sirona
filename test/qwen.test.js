import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qwenConfig, qwenJson } from '../qwen.js';

const env = { QWEN_API_KEY: 'sk-test-only', QWEN_BASE_URL: 'https://maas.qwencloudapi.com/compatible-mode/v1' };
const messages = [{ role: 'user', content: 'Return JSON {"ok":true}.' }];
const answer = (content = '{"ok":true}', finish = 'stop') => new Response(JSON.stringify({
  choices: [{ finish_reason: finish, message: { content } }],
  usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
}));

test('Qwen rejects subscription keys and foreign/redirect-style endpoints before sending credentials', () => {
  assert.throws(() => qwenConfig({ ...env, QWEN_API_KEY: 'sk-sp-subscription' }));
  for (const base of ['https://evil.example/compatible-mode/v1', 'http://maas.qwencloudapi.com/compatible-mode/v1',
    env.QWEN_BASE_URL + '?key=secret', 'https://maas.qwencloudapi.com.evil.example/compatible-mode/v1'])
    assert.throws(() => qwenConfig({ ...env, QWEN_BASE_URL: base }));
});
test('Qwen calls Qwen Cloud directly with capped output, thinking off and no redirects', async () => {
  const result = await qwenJson(env, messages, { fetcher: async (url, init) => {
    assert.equal(url, env.QWEN_BASE_URL + '/chat/completions');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, 'Bearer sk-test-only');
    const sent = JSON.parse(init.body);
    assert.equal(sent.model, 'qwen3.7-flash');
    assert.equal(sent.enable_thinking, false);
    assert.equal(sent.max_tokens, 2048);
    return answer();
  } });
  assert.equal(result.result.ok, true);
  assert.equal(result.usage.total_tokens, 25);
});
test('Qwen bounds input and output before any billable request', async () => {
  const fetcher = () => { assert.fail('must not call provider'); };
  await assert.rejects(qwenJson(env, [{ role: 'user', content: 'x'.repeat(9000) }], { fetcher }));
  await assert.rejects(qwenJson(env, messages, { fetcher, maxTokens: 5000 }));
});
test('Qwen rejects truncated, invalid and oversized results', async () => {
  for (const response of [answer('{"ok":true}', 'length'), answer('not JSON'), answer('[]'), answer('x'.repeat(140000))])
    await assert.rejects(qwenJson(env, messages, { fetcher: async () => response }));
});
test('Qwen provider failures never echo sensitive details or retry', async () => {
  let calls = 0;
  await assert.rejects(qwenJson(env, messages, { fetcher: async () => {
    calls++; return new Response('secret sk-do-not-echo private prompt', { status: 401 });
  } }), error => error.message.includes('401') && !error.message.includes('sk-do-not-echo'));
  assert.equal(calls, 1);
});

test('Qwen rejects redirect responses without making a second credential-bearing request', async () => {
  let calls=0;
  await assert.rejects(qwenJson(env,messages,{fetcher:async(_url,init)=>{
    calls++;assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://evil.example'}});
  }}),e=>e.message.includes('302'));
  assert.equal(calls,1);
});
