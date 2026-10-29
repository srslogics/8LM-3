-- Migration 007: Add campaign creation metadata
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES eightlm.users(id);
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS bidding_strategy TEXT DEFAULT 'Maximize Conversions';
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS target_location TEXT DEFAULT 'Global';
