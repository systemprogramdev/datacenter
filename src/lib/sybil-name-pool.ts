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

// Regions to rotate through for diversity
const REGIONS = [
  "East Asian (Chinese, Japanese, Korean)",
  "South Asian (Indian, Pakistani, Bengali, Sri Lankan)",
  "Southeast Asian (Vietnamese, Thai, Filipino, Indonesian)",
  "West African (Nigerian, Ghanaian, Senegalese)",
  "East African (Ethiopian, Kenyan, Somali)",
  "North African / Middle Eastern (Egyptian, Moroccan, Lebanese, Turkish, Iranian)",
  "Latin American (Mexican, Colombian, Brazilian, Argentine, Cuban)",
  "Caribbean (Jamaican, Haitian, Trinidadian)",
  "Eastern European (Russian, Polish, Ukrainian, Romanian, Czech)",
  "Western European (British, French, German, Italian, Dutch, Spanish)",
  "Scandinavian (Swedish, Norwegian, Danish, Finnish)",
  "North American mixed (diverse American/Canadian backgrounds)",
  "Pacific Islander (Hawaiian, Samoan, Tongan, Maori)",
  "Central Asian (Kazakh, Uzbek, Mongolian)",
];

let regionIndex = 0;

/**
 * Generate names via Ollama in batches and insert into the pool.
 * Uses rotating regional diversity prompts.
 * Cross-checks against both sybil_name_pool (UNIQUE) and sybil_bots table.
 * Returns number of names actually inserted.
 */
export async function refillPool(count = 20): Promise<number> {
  await ensureTable();

  // Pre-load existing handles to avoid generating dupes
  const { data: existingBots } = await supabase
    .from("sybil_bots")
    .select("name, handle");
  const { data: existingPool } = await supabase
    .from("sybil_name_pool")
    .select("name, handle");

  const usedNames = new Set<string>();
  const usedHandles = new Set<string>();
  for (const row of existingBots || []) {
    usedNames.add(row.name.toLowerCase());
    usedHandles.add(row.handle.toLowerCase());
  }
  for (const row of existingPool || []) {
    usedNames.add(row.name.toLowerCase());
    usedHandles.add(row.handle.toLowerCase());
  }

  let inserted = 0;
  const BATCH_SIZE = 10;
  const batches = Math.ceil(count / BATCH_SIZE);

  for (let b = 0; b < batches; b++) {
    const batchCount = Math.min(BATCH_SIZE, count - inserted);
    const region = REGIONS[regionIndex % REGIONS.length];
    regionIndex++;

    try {
      const prompt = `Generate ${batchCount} realistic social media profiles for people with ${region} backgrounds.

Rules:
- Every name must be a realistic full name (first + last) that a real person from that region would have
- Every handle must be a realistic username: lowercase, no spaces, no @, 3-15 chars. Mix of name abbreviations, numbers, underscores — like real people pick on Twitter
- Each name and handle must be UNIQUE — no duplicates within this batch
- Vary ages, genders, and name styles. Mix traditional and modern names
- Do NOT use celebrity names, fictional characters, or generic placeholders

Return JSON:
{"profiles":[{"name":"Full Name","handle":"username"},{"name":"Full Name","handle":"username"},...]}`;

      const result = await ollama.generateJSON<{ profiles: { name: string; handle: string }[] }>(prompt, 0.95);

      if (!Array.isArray(result.profiles)) continue;

      for (const profile of result.profiles) {
        if (!profile.name || !profile.handle) continue;

        let handle = profile.handle
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "")
          .slice(0, 15);
        if (handle.length < 3) handle = `user_${Math.floor(Math.random() * 99999)}`;

        const name = profile.name.trim().slice(0, 50);

        if (usedNames.has(name.toLowerCase()) || usedHandles.has(handle)) continue;

        const { error } = await supabase
          .from("sybil_name_pool")
          .insert({ name, handle });

        if (error) {
          if (error.code === "23505") continue;
          console.warn(`[NamePool] Insert error: ${error.message}`);
          continue;
        }

        usedNames.add(name.toLowerCase());
        usedHandles.add(handle);
        inserted++;
      }
    } catch (err) {
      console.warn(`[NamePool] Batch ${b + 1} generation failed (region: ${region}):`, err);
    }
  }

  if (inserted > 0) {
    console.log(`[NamePool] Refilled pool with ${inserted} names across ${batches} batches (requested ${count})`);
  }

  return inserted;
}
