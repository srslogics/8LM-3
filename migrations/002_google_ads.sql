-- Google Ads account connections (one per workspace)
CREATE TABLE eightlm.google_ads (
  workspace_id  INTEGER PRIMARY KEY REFERENCES eightlm.workspaces(id) ON DELETE CASCADE,
  customer_id   TEXT    NOT NULL,           -- Google Ads Customer ID (###-###-####)
  account_name  TEXT    NOT NULL DEFAULT '',
  connected_by  INTEGER NOT NULL REFERENCES eightlm.users(id),
  connected_at  BIGINT  NOT NULL
);
