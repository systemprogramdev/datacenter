import { supabase } from "./supabase";
import { ollama } from "./ollama";

/**
 * Ensure the sybil_name_pool table exists and sybil_bots has unique constraints.
 * Called once on first use — idempotent.
 */
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;

  const { error } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS sybil_name_pool (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        handle TEXT NOT NULL UNIQUE,
        claimed_by UUID,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_sybil_name_pool_unclaimed
        ON sybil_name_pool (created_at) WHERE claimed_by IS NULL;

      -- Add unique constraints to sybil_bots to prevent duplicates at DB level
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sybil_bots_handle_key') THEN
          ALTER TABLE sybil_bots ADD CONSTRAINT sybil_bots_handle_key UNIQUE (handle);
        END IF;
      END $$;
    `,
  });

  if (error) {
    console.warn("[NamePool] ensureTable RPC error (may need exec_sql function):", error.message);
    // Table might already exist from manual creation — continue anyway
  }

  tableReady = true;
}

/**
 * Claim the next available name from the pool.
 * Atomic: finds first unclaimed row, sets claimed_by to a placeholder UUID.
 * Returns null if pool is empty.
 */
export async function claimName(): Promise<{ name: string; handle: string } | null> {
  await ensureTable();

  // Find first unclaimed
  const { data: candidates } = await supabase
    .from("sybil_name_pool")
    .select("id, name, handle")
    .is("claimed_by", null)
    .order("created_at", { ascending: true })
    .limit(1);

  if (!candidates || candidates.length === 0) return null;

  const row = candidates[0];

  // Atomic claim: only succeeds if claimed_by is still null
  const { data: claimed } = await supabase
    .from("sybil_name_pool")
    .update({ claimed_by: "00000000-0000-0000-0000-000000000001" })
    .eq("id", row.id)
    .is("claimed_by", null)
    .select("name, handle");

  if (!claimed || claimed.length === 0) {
    // Race lost, try once more
    return claimName();
  }

  return { name: claimed[0].name, handle: claimed[0].handle };
}

/**
 * Get pool statistics.
 */
export async function getPoolSize(): Promise<{ total: number; available: number }> {
  await ensureTable();

  const { count: total } = await supabase
    .from("sybil_name_pool")
    .select("*", { count: "exact", head: true });

  const { count: available } = await supabase
    .from("sybil_name_pool")
    .select("*", { count: "exact", head: true })
    .is("claimed_by", null);

  return { total: total || 0, available: available || 0 };
}

/**
 * Generate names via Ollama and insert into the pool.
 * Cross-checks against both sybil_name_pool (UNIQUE) and sybil_bots table.
 * Returns number of names actually inserted.
 */
export async function refillPool(count = 20): Promise<number> {
  await ensureTable();

  // Pre-load existing sybil_bots handles to avoid generating dupes
  const { data: existingBots } = await supabase
    .from("sybil_bots")
    .select("name, handle");

  const usedNames = new Set<string>();
  const usedHandles = new Set<string>();
  if (existingBots) {
    for (const bot of existingBots) {
      usedNames.add(bot.name);
      usedHandles.add(bot.handle);
    }
  }

  let inserted = 0;

  for (let i = 0; i < count; i++) {
    try {
      const prompt = `Generate a realistic social media user profile. The user is on a Twitter-like platform called SPITr.
Return JSON with exactly two fields:
- "name": a display name (1-3 words, can be a real-sounding name or internet alias)
- "handle": a username (lowercase, no spaces, no @, 3-15 chars, may include underscores or numbers)

Be creative and varied. Examples of good handles: xdarkknightx, sarah_codes, memequeen99, trade_guru, anon_whale
Examples of good names: Dark Knight, Sarah Chen, Meme Queen, TradeGuru, Anonymous Whale

Return ONLY the JSON object, nothing else.`;

      const result = await ollama.generateJSON<{ name: string; handle: string }>(prompt, 0.9);

      // Sanitize handle
      let handle = (result.handle || "sybil_user")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 15);
      if (handle.length < 3) handle = `sybil_${Math.floor(Math.random() * 9999)}`;

      const name = (result.name || handle).slice(0, 50);

      // Skip if already exists in sybil_bots or in this batch
      if (usedNames.has(name) || usedHandles.has(handle)) continue;

      // Try insert — UNIQUE constraint catches DB dupes in pool table too
      const { error } = await supabase
        .from("sybil_name_pool")
        .insert({ name, handle });

      if (error) {
        // Duplicate — skip silently
        if (error.code === "23505") continue;
        console.warn(`[NamePool] Insert error: ${error.message}`);
        continue;
      }

      usedNames.add(name);
      usedHandles.add(handle);
      inserted++;
    } catch (err) {
      console.warn(`[NamePool] Generation failed for item ${i}:`, err);
    }
  }

  if (inserted > 0) {
    console.log(`[NamePool] Refilled pool with ${inserted} names (requested ${count})`);
  }

  return inserted;
}
