-- Sybil Server System Tables
-- Run this in Supabase SQL Editor

-- 1. Sybil Servers (one per purchasing user)
CREATE TABLE IF NOT EXISTS sybil_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'suspended')),
  max_sybils INT NOT NULL DEFAULT 50,
  last_owner_spit_id TEXT,
  last_owner_poll_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sybil_servers_owner ON sybil_servers(owner_user_id);
CREATE INDEX idx_sybil_servers_status ON sybil_servers(status);

-- 2. Sybil Bots (individual sybil accounts per server)
CREATE TABLE IF NOT EXISTS sybil_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES sybil_servers(id) ON DELETE CASCADE,
  user_id TEXT,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  avatar_url TEXT,
  banner_url TEXT,
  hp INT NOT NULL DEFAULT 100,
  is_alive BOOLEAN NOT NULL DEFAULT true,
  is_deployed BOOLEAN NOT NULL DEFAULT false,
  deploy_started_at TIMESTAMPTZ,
  deployed_at TIMESTAMPTZ,
  died_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sybil_bots_server ON sybil_bots(server_id);
CREATE INDEX idx_sybil_bots_alive ON sybil_bots(server_id, is_alive, is_deployed);

-- 3. Sybil Response Cache (pre-generated reactions)
CREATE TABLE IF NOT EXISTS sybil_response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES sybil_servers(id) ON DELETE CASCADE,
  spit_id TEXT NOT NULL,
  response_text TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_sybil_response_cache_lookup ON sybil_response_cache(server_id, spit_id, used);

-- 4. Sybil Jobs (action queue for sybil bots)
CREATE TABLE IF NOT EXISTS sybil_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES sybil_servers(id) ON DELETE CASCADE,
  sybil_bot_id UUID NOT NULL REFERENCES sybil_bots(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('like', 'reply', 'respit')),
  action_payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sybil_jobs_pending ON sybil_jobs(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_sybil_jobs_server ON sybil_jobs(server_id);
CREATE INDEX idx_sybil_jobs_bot ON sybil_jobs(sybil_bot_id);
