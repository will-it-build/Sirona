// Sirona — Worker backend
// Serves static assets and a sync API backed by D1.
// Auth: HttpOnly session cookie after username/password login.
// Optional Bearer SIRONA_KEY still accepted for ops; the app does not use it.

const COOKIE = 'sirona';
const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const PBKDF2_ITERS = 100000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};

function json(data, status = 200, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...extra,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

function setSessionCookie(request, token, maxAge = SESSION_DAYS * 86400) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const value = maxAge === 0 ? '' : token;
  return `${COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

function bearerKey(request, env) {
  const h = request.headers.get('Authorization') || '';
  return !!(env.SIRONA_KEY && h === 'Bearer ' + env.SIRONA_KEY);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hashPassword(password, saltHex) {
  const salt = hexToBytes(saltHex);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERS },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function randomHex(n = 32) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

function validUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9._-]{2,32}$/.test(u.trim());
}

function validPassword(p) {
  return typeof p === 'string' && p.length >= 8 && p.length <= 200;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function validEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) && e.length <= 160;
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )`),
  ]);
}

async function userCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return row ? Number(row.n) : 0;
}

async function userFromCookie(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.email
     FROM auth_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?1 AND t.expires_at > ?2`
  ).bind(tokenHash, now).first();
  return row || null;
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400 * 1000);
  await env.DB.prepare(
    `INSERT INTO auth_tokens (token_hash, user_id, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4)`
  ).bind(tokenHash, userId, now.toISOString(), expires.toISOString()).run();
  return token;
}

async function findUser(env, usernameOrEmail) {
  const q = (usernameOrEmail || '').trim().toLowerCase();
  if (!q) return null;
  return env.DB.prepare(
    'SELECT * FROM users WHERE lower(username) = ?1 OR lower(email) = ?1'
  ).bind(q).first();
}

async function sendResetEmail(env, request, to, rawToken) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return false;
  const origin = new URL(request.url).origin;
  const link = origin + '/?reset=' + rawToken;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: 'Reset your Sirona password',
      text:
        'Reset your Sirona password with this link (valid one hour):\n\n' +
        link +
        '\n\nIf you did not ask for this, ignore the mail.',
    }),
  });
  return res.ok;
}

async function requireUser(request, env) {
  if (bearerKey(request, env)) return { id: 'ops', username: 'ops', ops: true };
  return userFromCookie(request, env);
}

async function handleApi(request, env, url) {
  await ensureSchema(env);

  if (url.pathname === '/api/me' && request.method === 'GET') {
    const user = await userFromCookie(request, env);
    if (user) return json({ ok: true, username: user.username, email: user.email || '' });
    const setup = (await userCount(env)) === 0;
    return json({ error: 'unauthorised', setup }, 401);
  }

  if (url.pathname === '/api/setup' && request.method === 'POST') {
    if ((await userCount(env)) > 0) return json({ error: 'already set up' }, 409);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    const username = (body.username || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    if (!validUsername(username)) return json({ error: 'username must be 2–32 letters, numbers, . _ -' }, 400);
    if (!validEmail(email)) return json({ error: 'valid email required' }, 400);
    if (!validPassword(password)) return json({ error: 'password must be at least 8 characters' }, 400);
    const id = randomHex(16);
    const salt = randomHex(16);
    const password_hash = await hashPassword(password, salt);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO users (id, username, email, password_salt, password_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(id, username, email, salt, password_hash, now).run();
    const token = await createSession(env, id);
    return json({ ok: true, username }, 200, { 'Set-Cookie': setSessionCookie(request, token) });
  }

  if (url.pathname === '/api/login' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    const user = await findUser(env, body.username);
    const password = body.password || '';
    if (!user || !validPassword(password)) return json({ error: 'invalid username or password' }, 401);
    const check = await hashPassword(password, user.password_salt);
    if (!timingSafeEqual(check, user.password_hash)) return json({ error: 'invalid username or password' }, 401);
    const token = await createSession(env, user.id);
    return json({ ok: true, username: user.username }, 200, {
      'Set-Cookie': setSessionCookie(request, token),
    });
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    const raw = readCookie(request, COOKIE);
    if (raw) {
      const tokenHash = await sha256Hex(raw);
      await env.DB.prepare('DELETE FROM auth_tokens WHERE token_hash = ?1').bind(tokenHash).run();
    }
    return json({ ok: true }, 200, { 'Set-Cookie': setSessionCookie(request, '', 0) });
  }

  if (url.pathname === '/api/forgot-password' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    const user = await findUser(env, body.username);
    let emailed = false;
    if (user) {
      const raw = randomHex(32);
      const tokenHash = await sha256Hex(raw);
      const now = new Date();
      const expires = new Date(now.getTime() + RESET_MINUTES * 60 * 1000);
      await env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?1 AND used_at IS NULL')
        .bind(user.id).run();
      await env.DB.prepare(
        `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(tokenHash, user.id, now.toISOString(), expires.toISOString()).run();
      if (user.email) emailed = await sendResetEmail(env, request, user.email, raw);
    }
    return json({
      ok: true,
      emailed,
      mailConfigured: !!(env.RESEND_API_KEY && env.MAIL_FROM),
    });
  }

  if (url.pathname === '/api/reset-check' && request.method === 'GET') {
    const raw = url.searchParams.get('token') || '';
    if (!raw) return json({ ok: false }, 400);
    const tokenHash = await sha256Hex(raw);
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `SELECT token_hash FROM password_resets
       WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2`
    ).bind(tokenHash, now).first();
    if (!row) return json({ ok: false }, 400);
    return json({ ok: true });
  }

  if (url.pathname === '/api/reset-password' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    const raw = body.token || '';
    const password = body.password || '';
    if (!raw || !validPassword(password)) return json({ error: 'invalid reset or password' }, 400);
    const tokenHash = await sha256Hex(raw);
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `SELECT user_id FROM password_resets
       WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2`
    ).bind(tokenHash, now).first();
    if (!row) return json({ error: 'reset link expired or already used' }, 400);
    const salt = randomHex(16);
    const password_hash = await hashPassword(password, salt);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_salt = ?1, password_hash = ?2 WHERE id = ?3')
        .bind(salt, password_hash, row.user_id),
      env.DB.prepare('UPDATE password_resets SET used_at = ?1 WHERE token_hash = ?2')
        .bind(now, tokenHash),
      env.DB.prepare('DELETE FROM auth_tokens WHERE user_id = ?1').bind(row.user_id),
    ]);
    const token = await createSession(env, row.user_id);
    const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?1').bind(row.user_id).first();
    return json({ ok: true, username: user ? user.username : '' }, 200, {
      'Set-Cookie': setSessionCookie(request, token),
    });
  }

  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorised' }, 401);

  if (url.pathname === '/api/sessions' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT data FROM sessions ORDER BY date DESC'
    ).all();
    return json({ sessions: results.map(r => JSON.parse(r.data)) });
  }

  if (url.pathname === '/api/sessions' && request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (!Array.isArray(body.sessions)) return json({ error: 'sessions array required' }, 400);

    const now = new Date().toISOString();
    const stmt = env.DB.prepare(
      `INSERT INTO sessions (id, date, day, data, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET date=?2, day=?3, data=?4, updated_at=?5`
    );
    const batch = body.sessions
      .filter(s => s && s.id && s.date && s.day)
      .map(s => stmt.bind(s.id, s.date, s.day, JSON.stringify(s), now));
    if (batch.length) await env.DB.batch(batch);

    // Upsert only. full:true no longer deletes — a stale or empty client
    // list must not wipe completed history from D1.
    return json({ ok: true, count: batch.length });
  }

  if (url.pathname.startsWith('/api/sessions/') && request.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.slice('/api/sessions/'.length));
    if (!id || id.includes('/')) return json({ error: 'bad id' }, 400);
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}
