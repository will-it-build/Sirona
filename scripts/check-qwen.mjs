import { qwenJson } from '../qwen.js';

// Intentionally one small, synthetic request. No database or user records read.
try {
  const response = await qwenJson(process.env, [
    { role: 'system', content: 'Return a JSON object only.' },
    { role: 'user', content: 'Connection test: return exactly {"ok":true}.' },
  ], { maxTokens: 32 });
  if (response.result.ok !== true) throw new Error('The API responded but did not pass the connection test.');
  console.log(JSON.stringify({ connected: true, model: response.model, usage: response.usage }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
