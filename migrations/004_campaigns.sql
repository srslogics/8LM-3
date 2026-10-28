-- Campaigns fetched from Google Ads per workspace
CREATE TABLE IF NOT EXISTS eightlm.campaigns (
  id TEXT NOT NULL,
  workspace_id INTEGER NOT NULL REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  budget TEXT NOT NULL,
  imported BOOLEAN NOT NULL DEFAULT false,
  imported_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, id)
);
