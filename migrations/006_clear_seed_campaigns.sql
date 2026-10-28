-- Migration 006: Delete placeholder seed campaigns
DELETE FROM eightlm.campaigns WHERE id LIKE 'c-%';
