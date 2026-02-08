-- ============================================================
-- SPITr Datacenter - Bot Management Tables
-- Run this migration on your Supabase SQL editor
-- ============================================================

-- Bots table - core bot registration
CREATE TABLE IF NOT EXISTS bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  personality TEXT DEFAULT 'neutral',
  action_frequency INT DEFAULT 3 CHECK (action_frequency BETWEEN 1 AND 3),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Bot configs - per-bot strategy and behavior settings
CREATE TABLE IF NOT EXISTS bot_configs (
  bot_id UUID PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  enabled_actions TEXT[] DEFAULT ARRAY['post','reply','like','respit','attack','bank_deposit','buy_item','open_chest'],
  target_mode TEXT DEFAULT 'random' CHECK (target_mode IN ('random','specific','allies','enemies')),
  target_users UUID[] DEFAULT '{}',
  combat_strategy TEXT DEFAULT 'balanced' CHECK (combat_strategy IN ('aggressive','defensive','passive','balanced')),
  banking_strategy TEXT DEFAULT 'conservative' CHECK (banking_strategy IN ('aggressive','conservative','balanced')),
  auto_heal_threshold INT DEFAULT 1000,
  custom_prompt TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Bot jobs - scheduled and executed actions
CREATE TABLE IF NOT EXISTS bot_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_payload JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_jobs_status ON bot_jobs(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_bot_jobs_bot ON bot_jobs(bot_id, created_at DESC);

-- Bot daily action tracking
CREATE TABLE IF NOT EXISTS bot_daily_actions (
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  action_date DATE NOT NULL DEFAULT CURRENT_DATE,
  actions_used INT DEFAULT 0,
  PRIMARY KEY (bot_id, action_date)
);

-- Datacenter API keys for authentication
CREATE TABLE IF NOT EXISTS datacenter_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT DEFAULT 'default',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RPC function to increment daily action count
-- ============================================================
CREATE OR REPLACE FUNCTION increment_daily_actions(p_bot_id UUID, p_date DATE)
RETURNS VOID AS $$
BEGIN
  INSERT INTO bot_daily_actions (bot_id, action_date, actions_used)
  VALUES (p_bot_id, p_date, 1)
  ON CONFLICT (bot_id, action_date)
  DO UPDATE SET actions_used = bot_daily_actions.actions_used + 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS Policies (optional - datacenter uses service role)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_daily_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE datacenter_keys ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, but add policies for owner access
CREATE POLICY "Bot owners can view their bots"
  ON bots FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Bot owners can update their bots"
  ON bots FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Bot owners can view configs"
  ON bot_configs FOR SELECT
  USING (bot_id IN (SELECT id FROM bots WHERE owner_id = auth.uid()));

CREATE POLICY "Bot owners can update configs"
  ON bot_configs FOR UPDATE
  USING (bot_id IN (SELECT id FROM bots WHERE owner_id = auth.uid()));

CREATE POLICY "Bot owners can view jobs"
  ON bot_jobs FOR SELECT
  USING (bot_id IN (SELECT id FROM bots WHERE owner_id = auth.uid()));

CREATE POLICY "Bot owners can view daily actions"
  ON bot_daily_actions FOR SELECT
  USING (bot_id IN (SELECT id FROM bots WHERE owner_id = auth.uid()));
