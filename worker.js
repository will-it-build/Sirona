import { validateRecord, text } from './public/validation.js';
import { sha256Hex, hashPassword, randomHex, validUsername, validPassword, validEmail, timingSafeEqual } from './auth.js';

const COOKIE = 'sirona';
const MAX_BODY = 128 * 1024;
const DAY = 86400000;
const unsafe = method => !['GET', 'HEAD', 'OPTIONS'].includes(method);

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
  } });
}
function cookie(request, token, maxAge = 30 * 86400) {
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function cookieToken(request) {
  return (request.headers.get('Cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Send JSON.');
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) fail(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'JSON body required.');
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); fail(413, 'Request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'JSON object required.');
    return data;
  } catch { fail(400, 'Invalid JSON.'); }
}
async function userFromCookie(request, env) {
  const raw = cookieToken(request);
  if (!/^[a-f0-9]{64}$/.test(raw)) return null;
  return env.DB.prepare(`SELECT u.id, u.username, u.email FROM auth_tokens t
    JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?`)
    .bind(await sha256Hex(raw), new Date().toISOString()).first();
}
async function publicUser(env, user) {
  const legacy = await env.DB.prepare("SELECT value FROM app_settings WHERE key='legacy_owner_id'").first();
  return { id: user.id, username: user.username, email: user.email, legacyOwner: legacy?.value === user.id };
}
async function signedIn(request, env, user) {
  const raw = randomHex(32), now = new Date();
  await env.DB.prepare('INSERT INTO auth_tokens VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(raw), user.id, now.toISOString(), new Date(+now + 30 * DAY).toISOString()).run();
  return json({ user: await publicUser(env, user) }, 200, { 'Set-Cookie': cookie(request, raw) });
}
async function throttle(request, env, action, identity = '') {
  // Persisted counters work across Worker instances. Never store raw IP addresses.
  const now = Math.floor(Date.now() / 1000), window = 900;
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const keys = [`${action}:ip:${ip}`, ...(identity ? [`${action}:account:${identity.toLowerCase()}`] : [])];
  for (const [index, raw] of keys.entries()) {
    const key = await sha256Hex(raw);
    const row = await env.DB.prepare(`INSERT INTO auth_limits VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
        expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING attempts`)
      .bind(key, now + window, now, now, now + window).first();
    const limit = action === 'signup' ? 10 : (index === 0 ? 60 : 10);
    if (row.attempts > limit) fail(429, 'Too many attempts. Please try again in 15 minutes.');
  }
  await env.DB.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(now).run();
}
function record(row) {
  return row ? { key: row.key, data: row.deleted ? null : JSON.parse(row.data), revision: row.revision,
    deleted: !!row.deleted, mutationId: row.mutation_id, updatedAt: row.updated_at } : null;
}
async function handle(request, env, url) {
  if (unsafe(request.method)) {
    if (request.headers.get('Origin') !== url.origin) fail(403, 'Request origin not allowed.');
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'Request origin not allowed.');
  }
  const path = url.pathname;
  if (path === '/api/me' && request.method === 'GET') {
    const user = await userFromCookie(request, env);
    return user ? json({ user: await publicUser(env, user) }) : json({ error: 'Please log in.', signup: env.PUBLIC_SIGNUP === 'true' }, 401);
  }
  if (path === '/api/signup' && request.method === 'POST') {
    if (env.PUBLIC_SIGNUP !== 'true') fail(503, 'Sign-up is not open yet.');
    await throttle(request, env, 'signup');
    const b = await body(request);
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!validUsername(username) || !validEmail(email) || !validPassword(b.password) || b.password.length < 12)
      fail(400, 'Use a valid username and email, and a password of 12–200 characters.');
    const user = { id: randomHex(16), username, email }, salt = randomHex(16);
    const hash = await hashPassword(b.password, salt);
    try {
      await env.DB.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)')
        .bind(user.id, username, email, salt, hash, new Date().toISOString()).run();
    } catch (e) {
      if (/UNIQUE constraint failed/i.test(e.message)) fail(409, 'That username or email is unavailable. Try logging in or resetting your password.');
      throw e;
    }
    return signedIn(request, env, user);
  }
  if (path === '/api/login' && request.method === 'POST') {
    const b = await body(request), identity = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (!identity || identity.length > 160) fail(400, 'Username or email required.');
    await throttle(request, env, 'login', identity);
    const user = await env.DB.prepare('SELECT * FROM users WHERE lower(username)=? OR lower(email)=?').bind(identity, identity).first();
    const valid = validPassword(b.password);
    const check = await hashPassword(valid ? b.password : 'invalid-password', user?.password_salt || '00'.repeat(16));
    if (!user || !valid || !timingSafeEqual(check, user.password_hash)) fail(401, 'Invalid username or password.');
    return signedIn(request, env, user);
  }
  if (path === '/api/logout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM auth_tokens WHERE token_hash=?').bind(await sha256Hex(cookieToken(request))).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (path === '/api/forgot-password' && request.method === 'POST') {
    const b = await body(request), identity = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (!identity || identity.length > 160) fail(400, 'Username or email required.');
    await throttle(request, env, 'reset', identity);
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) fail(503, 'Password recovery is temporarily unavailable. Please try again later.');
    const user = await env.DB.prepare('SELECT id, email FROM users WHERE lower(username)=? OR lower(email)=?').bind(identity, identity).first();
    if (user?.email) {
      const raw = randomHex(32), now = new Date(), hash = await sha256Hex(raw);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM password_resets WHERE user_id=?').bind(user.id),
        env.DB.prepare('INSERT INTO password_resets VALUES (?, ?, ?, ?, NULL)').bind(hash, user.id, now.toISOString(), new Date(+now + 3600000).toISOString()),
      ]);
      let delivered = false;
      try {
        const sent = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env.MAIL_FROM, to: [user.email], subject: 'Reset your Sirona password',
            text: `Reset your password using this link within one hour:\n${url.origin}/?reset=${raw}\n\nIf you did not request this, ignore this email.` }),
        });
        delivered = sent.ok;
      } catch { /* Delivery failures must not reveal whether the account exists. */ }
      if (!delivered) {
        await env.DB.prepare('DELETE FROM password_resets WHERE token_hash=?').bind(hash).run();
        // Do not reveal whether the requested account exists through the public response.
        console.error('password_reset_delivery_failed');
      }
    }
    return json({ ok: true });
  }
  if (path === '/api/reset-check' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT user_id FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?')
      .bind(await sha256Hex(url.searchParams.get('token') || ''), new Date().toISOString()).first();
    return json({ ok: !!row }, row ? 200 : 400);
  }
  if (path === '/api/reset-password' && request.method === 'POST') {
    await throttle(request, env, 'reset-submit');
    const b = await body(request);
    if (!text(b.token, 64) || !validPassword(b.password) || b.password.length < 12) fail(400, 'Invalid reset link or password. Use at least 12 characters.');
    const hash = await sha256Hex(b.token), now = new Date().toISOString(), salt = randomHex(16);
    const passwordHash = await hashPassword(b.password, salt);
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE users SET password_salt=?, password_hash=? WHERE id IN
        (SELECT user_id FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?) RETURNING id, username, email`)
        .bind(salt, passwordHash, hash, now),
      env.DB.prepare('UPDATE password_resets SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(now, hash),
      env.DB.prepare('DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE password_salt=?)').bind(salt),
    ]);
    const user = results[0].results[0];
    if (!user) fail(400, 'Reset link expired or already used.');
    return signedIn(request, env, user);
  }
  const user = await userFromCookie(request, env);
  if (!user) fail(401, 'Please log in.');
  if (path.startsWith('/api/v2/')) {
    if (request.headers.get('X-Sirona-User') !== user.id) fail(409, 'Account changed. Please reload and log in again.');
    if (path === '/api/v2/records' && request.method === 'GET') {
      const after = url.searchParams.get('after') || '';
      const { results } = await env.DB.prepare('SELECT * FROM records WHERE user_id=? AND key>? ORDER BY key LIMIT 201').bind(user.id, after).all();
      return json({ records: results.slice(0, 200).map(record), next: results.length > 200 ? results[199].key : null });
    }
    if (path.startsWith('/api/v2/records/') && request.method === 'PUT') {
      const key = decodeURIComponent(path.slice('/api/v2/records/'.length));
      if (!/^(session:[a-zA-Z0-9_-]{1,100}|draft:active)$/.test(key)) fail(400, 'Invalid record key.');
      const b = await body(request);
      if (!Number.isSafeInteger(b.revision) || b.revision < 0 || !/^[a-f0-9-]{36}$/.test(b.mutationId)) fail(400, 'Invalid save revision.');
      if (b.deleted !== undefined && typeof b.deleted !== 'boolean') fail(400, 'Invalid deletion flag.');
      if (key === 'draft:active' && b.deleted) fail(400, 'Save an empty draft to clear it.');
      if (!b.deleted && !validateRecord(key, b.data)) fail(400, 'Invalid workout. Check exercise names, dates and sets.');
      const previous = await env.DB.prepare('SELECT * FROM records WHERE user_id=? AND key=?').bind(user.id, key).first();
      if (previous?.mutation_id === b.mutationId) return json({ record: record(previous) });
      if ((previous?.revision || 0) !== b.revision || previous?.deleted) return json({ error: 'This record changed on another device.', conflict: true, record: record(previous) }, 409);
      const changed = await env.DB.prepare(`INSERT INTO records (user_id, key, data, revision, deleted, mutation_id, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET
        data=excluded.data, revision=records.revision+1, deleted=excluded.deleted,
        mutation_id=excluded.mutation_id, updated_at=excluded.updated_at
        WHERE records.revision=? AND records.deleted=0 RETURNING *`)
        .bind(user.id, key, b.deleted ? null : JSON.stringify(b.data), b.deleted ? 1 : 0, b.mutationId, new Date().toISOString(), b.revision).first();
      if (!changed) {
        const current = await env.DB.prepare('SELECT * FROM records WHERE user_id=? AND key=?').bind(user.id, key).first();
        if (current?.mutation_id === b.mutationId) return json({ record: record(current) });
        return json({ error: 'This record changed on another device.', conflict: true, record: record(current) }, 409);
      }
      return json({ record: record(changed) });
    }
  }
  if (path.startsWith('/api/sessions') || path === '/api/setup') fail(426, 'Sirona has been updated. Reload the app before saving.');
  fail(404, 'Not found.');
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    // Checked before any database access so this build can freeze legacy writes
    // before the additive migration is applied.
    if (env.MAINTENANCE_MODE === 'true') return json({ error: 'Sirona is being updated. Your changes remain on this device. Please retry shortly.' }, 503, { 'Retry-After': '300' });
    try { return await handle(request, env, url); }
    catch (e) {
      if (!e.status) console.error('api_request_failed', { path: url.pathname, method: request.method });
      return json({ error: e.status ? e.message : 'Could not complete the request. Please try again.' }, e.status || 500,
        e.status === 429 ? { 'Retry-After': '900' } : {});
    }
  },
};
