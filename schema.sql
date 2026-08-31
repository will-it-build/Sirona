-- Sirona D1 tables. The Worker also CREATE TABLE IF NOT EXISTS these
-- auth tables on first API request. The sessions table already exists
-- in production; do not drop it.

-- Workout log (existing). One JSON document per session.
-- CREATE TABLE sessions (
--   id TEXT PRIMARY KEY,
--   date TEXT,
--   day TEXT,
--   data TEXT,
--   updated_at TEXT
-- );

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
