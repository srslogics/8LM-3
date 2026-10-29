CREATE TABLE eightlm.google_oauth_states (
 state_hash TEXT PRIMARY KEY,
 workspace_id INTEGER NOT NULL REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES eightlm.users(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL,
 verifier TEXT NOT NULL,
 expires_at BIGINT NOT NULL
);
ALTER TABLE eightlm.google_ads ADD COLUMN currency_code TEXT;
ALTER TABLE eightlm.campaigns ADD COLUMN google_resource TEXT;
ALTER TABLE eightlm.campaigns ADD COLUMN currency_code TEXT;
ALTER TABLE eightlm.campaigns ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'UNVERIFIED';
CREATE TABLE eightlm.campaign_publications (
 id UUID PRIMARY KEY,
 workspace_id INTEGER NOT NULL REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
 customer_id TEXT NOT NULL,
 payload JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'DRAFT',
 resource_name TEXT,
 error TEXT,
 created_at BIGINT NOT NULL
);
CREATE INDEX campaign_publications_workspace ON eightlm.campaign_publications(workspace_id);
-- Do not let old demo credentials masquerade as a real connection.
DELETE FROM eightlm.google_ads WHERE workspace_id IN
 (SELECT workspace_id FROM eightlm.oauth_tokens WHERE access_token LIKE 'demo_%');
DELETE FROM eightlm.oauth_tokens WHERE access_token LIKE 'demo_%';
