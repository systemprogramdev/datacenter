-- Bot Memory System + Trending Content
-- Requires pgvector extension (free on Supabase)

create extension if not exists vector with schema extensions;

-- Bot memories with vector embeddings for semantic search
create table bot_memories (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references bots(id) on delete cascade,
  memory_type text not null check (memory_type in ('interaction', 'observation', 'opinion', 'self')),
  subject text,              -- @handle, topic, or null
  content text not null,     -- natural language memory
  embedding vector(768),     -- nomic-embed-text dimensions
  importance int not null default 5 check (importance between 0 and 10),
  recalled_count int not null default 0,
  created_at timestamptz not null default now(),
  last_recalled_at timestamptz
);

create index idx_memories_bot on bot_memories(bot_id);
create index idx_memories_bot_subject on bot_memories(bot_id, subject);
create index idx_memories_bot_type on bot_memories(bot_id, memory_type);
create index idx_memories_importance on bot_memories(bot_id, importance desc);

-- HNSW index for fast cosine similarity search
create index idx_memories_embedding on bot_memories
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Trending content pool (multi-source)
create table trending_content (
  id uuid primary key default gen_random_uuid(),
  source text not null,      -- 'youtube' | 'reddit' | 'hackernews' | 'rss' | 'google_trends'
  category text not null,    -- 'tech' | 'gaming' | 'music' | 'culture' | 'crypto' | 'science' | 'memes' | 'news'
  title text not null,
  url text not null unique,  -- dedup key
  description text,          -- snippet/summary
  thumbnail_url text,        -- for youtube etc
  score float not null default 0, -- normalized trending score
  metadata jsonb,            -- source-specific data (upvotes, views, subreddit, etc)
  ingested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours')
);

create index idx_trending_category on trending_content(category);
create index idx_trending_score on trending_content(category, score desc);
create index idx_trending_expires on trending_content(expires_at);

-- Auto-cleanup expired trending content
create or replace function cleanup_expired_trends() returns void as $$
  delete from trending_content where expires_at < now();
$$ language sql;

-- Memory recall function: cosine similarity search
create or replace function recall_memories(
  p_bot_id uuid,
  p_embedding vector(768),
  p_limit int default 5
) returns table (
  id uuid,
  memory_type text,
  subject text,
  content text,
  importance int,
  similarity float,
  created_at timestamptz
) as $$
  select
    m.id,
    m.memory_type,
    m.subject,
    m.content,
    m.importance,
    1 - (m.embedding <=> p_embedding) as similarity,
    m.created_at
  from bot_memories m
  where m.bot_id = p_bot_id
    and m.embedding is not null
    and m.importance > 0
  order by
    -- blend semantic similarity with importance and recency
    (1 - (m.embedding <=> p_embedding)) * 0.6
    + (m.importance::float / 10.0) * 0.25
    + (1.0 / (1.0 + extract(epoch from (now() - m.created_at)) / 86400.0)) * 0.15
    desc
  limit p_limit;
$$ language sql stable;
