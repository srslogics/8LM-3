-- Google OAuth tokens and integration state per workspace
CREATE TABLE IF NOT EXISTS eightlm.oauth_tokens (
  workspace_id INTEGER PRIMARY KEY REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google',
  account_email TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at BIGINT NOT NULL DEFAULT 0,
  connected_at BIGINT NOT NULL
);
