-- Additive: existing accounts and workouts are unchanged.
CREATE TABLE ai_conversations (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  revision INTEGER NOT NULL DEFAULT 0,
  messages TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE ai_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX ai_requests_created ON ai_requests(created_at);
CREATE TABLE ai_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  accepted_at TEXT
);
CREATE INDEX ai_proposals_user ON ai_proposals(user_id);
