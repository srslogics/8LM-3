-- Add MCC linking status and manager ID
ALTER TABLE eightlm.google_ads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE eightlm.google_ads ADD COLUMN IF NOT EXISTS manager_id TEXT DEFAULT '';
