// Sirona — Worker backend
// Serves static assets and a tiny sync API backed by D1.
// Auth: Authorization: Bearer <SIRONA_KEY>  (set with: npx wrangler secret put SIRONA_KEY)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }
    // Everything else: static assets (index.html)
    return env.ASSETS.fetch(request);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function authed(request, env) {
  const h = request.headers.get('Authorization') || '';
  return env.SIRONA_KEY && h === 'Bearer ' + env.SIRONA_KEY;
}

async function handleApi(request, env, url) {
  if (!authed(request, env)) return json({ error: 'unauthorised' }, 401);

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

    // Deletions: anything in D1 but absent from the client's full list.
    // Planned sessions (status:"planned") are ordinary rows — GET returns them,
    // PUT upserts them. External clients should GET, merge, PUT *without*
    // full:true so a week write cannot wipe completed history.
    if (body.full === true) {
      const ids = body.sessions.map(s => s.id);
      const { results } = await env.DB.prepare('SELECT id FROM sessions').all();
      const gone = results.map(r => r.id).filter(id => !ids.includes(id));
      if (gone.length) {
        const del = env.DB.prepare('DELETE FROM sessions WHERE id = ?1');
        await env.DB.batch(gone.map(id => del.bind(id)));
      }
    }
    return json({ ok: true, count: batch.length });
  }

  return json({ error: 'not found' }, 404);
}
