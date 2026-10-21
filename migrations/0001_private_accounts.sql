-- Additive migration. Keep the old sessions table as a recovery source.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT,
  password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, date TEXT, day TEXT, data TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);

-- Stop rather than assigning shared history to an arbitrary person.
CREATE TABLE migration_owner_guard (valid INTEGER NOT NULL CHECK(valid = 1));
INSERT INTO migration_owner_guard VALUES (
  CASE WHEN (SELECT COUNT(*) FROM sessions) = 0
    OR (SELECT COUNT(*) FROM users) = 1 THEN 1 ELSE 0 END
);
DROP TABLE migration_owner_guard;

CREATE UNIQUE INDEX users_username_normalized ON users(lower(username));
CREATE UNIQUE INDEX users_email_normalized ON users(lower(email))
  WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS auth_tokens_expiry ON auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);

CREATE TABLE records (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  data TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1)),
  mutation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
INSERT INTO records (user_id, key, data, mutation_id, updated_at)
  SELECT u.id, 'session:' || s.id, s.data, 'migration',
    COALESCE(s.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  FROM sessions s CROSS JOIN users u;

CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO app_settings
  SELECT 'legacy_owner_id', id FROM users WHERE (SELECT COUNT(*) FROM users) = 1;

CREATE TABLE auth_limits (
  key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX auth_limits_expiry ON auth_limits(expires_at);
