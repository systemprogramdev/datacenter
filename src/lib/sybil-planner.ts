import { ollama } from "./ollama";
import { supabase } from "./supabase";

const RESPONSE_CACHE_THRESHOLD = 5; // regenerate batch when fewer than this remain unused

/**
 * Generate a realistic social media name + handle via Ollama.
 * Returns { name, handle } — handle is lowercase, no @.
 */
export async function generateName(): Promise<{ name: string; handle: string }> {
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

  return { name, handle };
}

/**
 * Generate a batch of short reactions to a post via Ollama.
 * Returns an array of 1-5 word reaction strings.
 */
export async function generateResponseBatch(
  spitContent: string,
  count = 10
): Promise<string[]> {
  const prompt = `You are generating short social media reactions to a post on SPITr (a Twitter-like platform).

The post says: "${spitContent.slice(0, 300)}"

Generate ${count} different short reactions (1-5 words each). These should feel like authentic, varied social media replies — some enthusiastic, some casual, some funny, some agreeing, some questioning.

Examples of good reactions: "fr fr", "this is insane", "W take", "no way lmaooo", "based", "ratio", "huge if true", "yooo 💀", "say less", "real talk"

Return a JSON object with a single field "reactions" containing an array of ${count} strings.
Return ONLY the JSON object.`;

  const result = await ollama.generateJSON<{ reactions: string[] }>(prompt, 0.9);

  if (!Array.isArray(result.reactions)) return [];

  // Filter and trim reactions
  return result.reactions
    .map((r: string) => String(r).trim().slice(0, 100))
    .filter((r: string) => r.length > 0 && r.length <= 100)
    .slice(0, count);
}

/**
 * Ensure the response cache has enough unused entries for a given spit.
 * If below threshold, generate a new batch.
 */
export async function ensureResponseCache(
  serverId: string,
  spitId: string,
  spitContent: string
): Promise<void> {
  const { count } = await supabase
    .from("sybil_response_cache")
    .select("*", { count: "exact", head: true })
    .eq("server_id", serverId)
    .eq("spit_id", spitId)
    .eq("used", false);

  if ((count || 0) >= RESPONSE_CACHE_THRESHOLD) return;

  console.log(`[SybilPlanner] Generating response batch for spit ${spitId.slice(0, 8)}...`);
  const responses = await generateResponseBatch(spitContent, 10);

  if (responses.length === 0) return;

  const rows = responses.map((text) => ({
    server_id: serverId,
    spit_id: spitId,
    response_text: text,
    used: false,
  }));

  await supabase.from("sybil_response_cache").insert(rows);
  console.log(`[SybilPlanner] Cached ${rows.length} responses for spit ${spitId.slice(0, 8)}`);
}

/**
 * Pull one unused cached response for a spit, mark it as used.
 * Returns null if cache is empty.
 */
export async function getNextCachedResponse(
  serverId: string,
  spitId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("sybil_response_cache")
    .select("id, response_text")
    .eq("server_id", serverId)
    .eq("spit_id", spitId)
    .eq("used", false)
    .limit(1)
    .single();

  if (!data) return null;

  await supabase
    .from("sybil_response_cache")
    .update({ used: true })
    .eq("id", data.id);

  return data.response_text;
}

/**
 * Delete all used response cache entries to keep the table clean.
 */
export async function cleanupUsedResponses(): Promise<number> {
  const { data } = await supabase
    .from("sybil_response_cache")
    .delete()
    .eq("used", true)
    .select("id");

  const count = data?.length || 0;
  if (count > 0) {
    console.log(`[SybilPlanner] Cleaned up ${count} used response cache entries`);
  }
  return count;
}
