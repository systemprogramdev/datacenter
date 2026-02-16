import { supabase } from "./supabase";
import { ollama } from "./ollama";

/**
 * Verify the sybil_name_pool table is accessible.
 * Table must be created via Supabase migration — see migration SQL.
 */
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;

  const { error } = await supabase
    .from("sybil_name_pool")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[NamePool] Table sybil_name_pool not found — run the migration first:", error.message);
    return;
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
      const prompt = `Generate a realistic person's social media profile. This should look like a real human being on Twitter.
Return JSON with exactly two fields:
- "name": a realistic full name (first + last). Use diverse ethnicities and backgrounds. Examples: Marcus Thompson, Priya Sharma, Emily Rodriguez, James O'Brien, Yuki Tanaka, Aaliyah Jackson, Devon Mitchell, Sofia Reyes
- "handle": a realistic username based on the name (lowercase, no spaces, no @, 3-15 chars). Should look like something a real person would pick — use parts of their name, maybe add a number. Examples: marcust94, priya_sharma, emrodriguez, jamesobrien7, yukitanaka, aaliyah_j, devmitch, sofiareyes22

Do NOT use internet slang, memes, or edgy aliases. These should pass as real people.

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
