-- Meta credentials and campaign state are independent of Google Ads.
CREATE TABLE eightlm.meta_connections (
 workspace_id INTEGER PRIMARY KEY REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, account_name TEXT NOT NULL,
 token_ciphertext TEXT NOT NULL, expires_at BIGINT NOT NULL,
 connected_at BIGINT NOT NULL
);
CREATE TABLE eightlm.meta_oauth_states (
 state_hash TEXT PRIMARY KEY,
 workspace_id INTEGER NOT NULL REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES eightlm.users(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX meta_oauth_expiry ON eightlm.meta_oauth_states(expires_at);
CREATE TABLE eightlm.meta_accounts (
 workspace_id INTEGER PRIMARY KEY REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL,
 timezone_name TEXT NOT NULL, selected_at BIGINT NOT NULL
);
CREATE TABLE eightlm.meta_publications (
 id UUID PRIMARY KEY,
 workspace_id INTEGER NOT NULL REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL, currency TEXT NOT NULL, payload JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','SENDING','UNKNOWN','FAILED','PUBLISHED')),
 resources JSONB NOT NULL DEFAULT '{}', pending_step TEXT,
 error TEXT, created_at BIGINT NOT NULL
);
CREATE INDEX meta_publications_workspace ON eightlm.meta_publications(workspace_id,account_id);
CREATE TABLE eightlm.meta_tracked_campaigns (
 workspace_id INTEGER NOT NULL REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,account_id,campaign_id)
);
