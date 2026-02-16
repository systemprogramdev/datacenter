-- Add retry support to sybil_jobs
ALTER TABLE sybil_jobs ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
