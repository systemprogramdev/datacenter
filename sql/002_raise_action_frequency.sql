-- Raise the action_frequency cap from 3 to 100
-- Run this in the Supabase SQL editor

ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_action_frequency_check;
ALTER TABLE bots ADD CONSTRAINT bots_action_frequency_check CHECK (action_frequency BETWEEN 1 AND 100);

-- Update existing bots to 10 actions/day as a sensible default
UPDATE bots SET action_frequency = 10;
