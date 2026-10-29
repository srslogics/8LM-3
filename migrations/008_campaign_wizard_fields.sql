-- Migration 008: Add campaign creation wizard fields
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS objective TEXT DEFAULT 'Sales';
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS conversion_goals TEXT DEFAULT 'Purchases, Phone call leads';
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS ways_to_reach TEXT DEFAULT 'Website visits';
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT '';
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS phone_number TEXT DEFAULT '';
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS optimize_new_customers BOOLEAN DEFAULT false;
ALTER TABLE eightlm.campaigns ADD COLUMN IF NOT EXISTS reengage_lapsed_customers BOOLEAN DEFAULT false;
