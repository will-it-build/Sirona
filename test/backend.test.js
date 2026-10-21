import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';

const migration = readFileSync(new URL('../migrations/0001_private_accounts.sql', import.meta.url), 'utf8');
export function dbAdapter(sqlite) {
  function prepare(sql) {
    const query = (args = []) => ({
      bind: (...next) => query(next),
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; },
      _sql: sql, _args: args,
    });
    return query();
  }
  return { prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const result = statements.map(s => {
        const stmt = sqlite.prepare(s._sql);
        return /RETURNING|^SELECT/i.test(s._sql) ? { results: stmt.all(...s._args) } : { results: [], meta: { changes: stmt.run(...s._args).changes } };
      });
      sqlite.exec('COMMIT'); return result;
    } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(migration);
  const env = { DB: dbAdapter(sqlite), PUBLIC_SIGNUP: 'true' };
  const origin = 'https://sirona.example';
  async function request(path, { method = 'GET', body, cookie, user, headers = {} } = {}) {
    const result = await worker.fetch(new Request(origin + path, { method,
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(user ? { 'X-Sirona-User': user } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
    return { status: result.status, data: await result.json(), cookie: result.headers.get('Set-Cookie')?.split(';')[0], headers: result.headers };
  }
  async function signup(username) {
    const res = await request('/api/signup', { method: 'POST', body: { username, email: username + '@example.com', password: 'a-strong-test-password' } });
    assert.equal(res.status, 200);
    return { cookie: res.cookie, user: res.data.user.id };
  }
  return { sqlite, env, request, signup };
}
const workout = (id = 'one') => ({ id, date: '2026-10-20T12:00:00Z', day: 'Push', status: 'done', entries: [{ exercise: 'Bench', sets: [{ w: 50, r: 8 }] }] });
const mutation = (data, revision = 0, deleted = false) => ({ data, revision, deleted, mutationId: crypto.randomUUID() });

test('public HTTP redirects to HTTPS before data access and HTTPS sets protective headers', async () => {
  const redirect = await worker.fetch(new Request('http://gymspear.com/api/me'), {});
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('Location'), 'https://gymspear.com/api/me');
  const response = await worker.fetch(new Request('https://gymspear.com/'), {ASSETS:{fetch:async()=>new Response('app')}});
  assert.equal(await response.text(), 'app');
  assert.match(response.headers.get('Strict-Transport-Security'), /max-age=/);
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  const local = await worker.fetch(new Request('http://localhost/'), {ASSETS:{fetch:async()=>new Response('local')}});
  assert.equal(local.status, 200);
});

test('public accounts are case-insensitively unique and cookies are secure', async () => {
  const f = fixture(); const a = await f.signup('alice');
  const dup = await f.request('/api/signup', { method: 'POST', body: { username: 'ALICE', email: 'other@example.com', password: 'a-strong-test-password' } });
  assert.equal(dup.status, 409);
  const login = await f.request('/api/login', { method: 'POST', body: { username: 'ALICE', password: 'a-strong-test-password' } });
  assert.equal(login.data.user.id, a.user);
  assert.match(login.headers.get('Set-Cookie'), /HttpOnly/); assert.match(login.headers.get('Set-Cookie'), /Secure/);
  assert.match(login.headers.get('Set-Cookie'), /SameSite=Strict/);
});

test('anonymous, cross-origin and mismatched-account requests are blocked', async () => {
  const f = fixture(); const a = await f.signup('alice');
  assert.equal((await f.request('/api/v2/records')).status, 401);
  assert.equal((await f.request('/api/v2/records', { ...a, user: 'someone-else' })).status, 409);
  assert.equal((await f.request('/api/login', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: {} })).status, 403);
  assert.equal((await f.request('/api/sessions', a)).status, 426);
});

test('users cannot see, overwrite or delete another user’s record', async () => {
  const f = fixture(), a = await f.signup('alice'), b = await f.signup('bruno');
  await f.request('/api/v2/records/session:one', { ...a, method: 'PUT', body: mutation(workout()) });
  assert.deepEqual((await f.request('/api/v2/records', b)).data.records, []);
  assert.equal((await f.request('/api/v2/records/session:one', { ...b, method: 'PUT', body: mutation(null, 1, true) })).status, 409);
  await f.request('/api/v2/records/session:one', { ...b, method: 'PUT', body: mutation({ ...workout(), day: 'Pull' }) });
  assert.equal((await f.request('/api/v2/records', a)).data.records[0].data.day, 'Push');
});

test('save retries are idempotent; concurrent stale edits conflict; tombstones prevent resurrection', async () => {
  const f = fixture(), a = await f.signup('alice');
  const first = mutation(workout());
  const put = body => f.request('/api/v2/records/session:one', { ...a, method: 'PUT', body });
  assert.equal((await put(first)).data.record.revision, 1);
  assert.equal((await put(first)).data.record.revision, 1);
  const edits = await Promise.all([put(mutation({ ...workout(), notes: 'A' }, 1)), put(mutation({ ...workout(), notes: 'B' }, 1))]);
  assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
  const deleted = await put(mutation(null, 2, true)); assert.equal(deleted.data.record.deleted, true);
  assert.equal((await put(mutation(workout(), 2))).status, 409);
  assert.equal((await put(mutation(workout(), 3))).status, 409);
  assert.equal((await f.request('/api/v2/records', a)).data.records[0].data, null);
});

test('draft saves persist and malformed records never enter storage', async () => {
  const f = fixture(), a = await f.signup('alice');
  const draft = { day: 'Push', entries: workout().entries, meta: { bodyweight: 80.5 } };
  assert.equal((await f.request('/api/v2/records/draft:active', { ...a, method: 'PUT', body: mutation(draft) })).status, 200);
  assert.equal((await f.request('/api/v2/records', a)).data.records[0].data.meta.bodyweight, 80.5);
  const invalid = workout(); invalid.entries[0].sets[0].w = -1;
  assert.equal((await f.request('/api/v2/records/session:one', { ...a, method: 'PUT', body: mutation(invalid) })).status, 400);
  assert.equal((await f.request('/api/v2/records/session:bad%27id', { ...a, method: 'PUT', body: mutation(workout()) })).status, 400);
  assert.equal((await f.request('/api/v2/records/draft:active', { ...a, method: 'PUT', body: mutation({ ...draft, id: "bad'id" }, 1) })).status, 400);
});

test('planned rest days survive saving and edits without accepting rest workouts', async () => {
  const f = fixture(), a = await f.signup('alice');
  const plan = { id: 'plan-rest', date: '2026-10-21T12:00:00Z', day: 'Rest', status: 'planned', entries: [] };
  const put = data => f.request('/api/v2/records/session:plan-rest', { ...a, method: 'PUT', body: data });
  assert.equal((await put(mutation(plan))).status, 200);
  assert.equal((await put(mutation({...plan, notes: 'Recovery day'}, 1))).status, 200);
  assert.equal((await put(mutation({...plan, status:'done'}, 2))).status, 400);
  assert.equal((await put(mutation({...plan, entries:workout().entries}, 2))).status, 400);
  assert.equal((await f.request('/api/v2/records/draft:active', { ...a, method:'PUT', body:mutation({day:'Rest',entries:[]}) })).status, 400);
});

test('maintenance mode blocks API access before touching an unmigrated database', async () => {
  const response = await worker.fetch(new Request('https://sirona.example/api/me'), { MAINTENANCE_MODE: 'true' });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '300');
});

test('public signup remains closed until explicitly enabled', async () => {
  const f = fixture(); f.env.PUBLIC_SIGNUP = 'false';
  const result = await f.request('/api/signup', { method: 'POST', body: { username: 'alice', email: 'alice@example.com', password: 'a-strong-test-password' } });
  assert.equal(result.status, 503);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('recovery email contains a usable reset link and network failures do not expose accounts', async t => {
  const f = fixture(); await f.signup('alice');
  f.env.RESEND_API_KEY = 'fake-test-key'; f.env.MAIL_FROM = 'test@example.com';
  let email;
  const outbound = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    email = JSON.parse(options.body);
    return new Response('{}', { status: 200 });
  });
  const forgot = username => f.request('/api/forgot-password', { method: 'POST', body: { username } });
  assert.equal((await forgot('alice')).status, 200);
  assert.deepEqual(email.to, ['alice@example.com']);
  const link = email.text.match(/https:\/\/sirona\.example\/\?reset=[a-f0-9]{64}/)[0];
  const token = new URL(link).searchParams.get('reset');
  assert.equal((await f.request('/api/reset-check?token=' + token)).status, 200);
  outbound.mock.mockImplementation(async () => { throw new Error('network unavailable'); });
  const existing = await forgot('alice'), unknown = await forgot('missing');
  assert.equal(existing.status, unknown.status);
  assert.deepEqual(existing.data, unknown.data);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0);
});

test('logout revokes the session and authentication is throttled', async () => {
  const f = fixture(), a = await f.signup('alice');
  await f.request('/api/logout', { ...a, method: 'POST', body: {} });
  assert.equal((await f.request('/api/me', a)).status, 401);
  let result;
  for (let i = 0; i < 11; i++) result = await f.request('/api/login', { method: 'POST', body: { username: 'alice', password: 'wrong-password' } });
  assert.equal(result.status, 429);
});

test('reset tokens are single-use and revoke existing sessions', async () => {
  const f = fixture(), a = await f.signup('alice');
  const raw = 'a'.repeat(64);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('hex');
  f.sqlite.prepare('INSERT INTO password_resets VALUES (?, ?, ?, ?, NULL)').run(hash, a.user, new Date().toISOString(), new Date(Date.now() + 3600000).toISOString());
  const reset = () => f.request('/api/reset-password', { method: 'POST', body: { token: raw, password: 'new-strong-test-password' } });
  const results = await Promise.all([reset(), reset()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal((await f.request('/api/me', a)).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { username: 'alice', password: 'new-strong-test-password' } })).status, 200);
});

test('migration retains original history and rejects ambiguous ownership', () => {
  function legacy(users) {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, date TEXT, day TEXT, data TEXT, updated_at TEXT);`);
    for(let i=0;i<users;i++) db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run('u'+i,'user'+i,'u'+i+'@example.com','salt','hash','now');
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('one',workout().date,'Push',JSON.stringify(workout()),'now');
    return db;
  }
  const good = legacy(1); good.exec(migration);
  assert.equal(good.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
  assert.equal(good.prepare('SELECT user_id FROM records').get().user_id,'u0');
  const bad = legacy(2); assert.throws(() => bad.exec(migration), /CHECK constraint/);
  assert.equal(bad.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
});
