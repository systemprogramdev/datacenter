import { supabase } from "./supabase";
import { ollama } from "./ollama";
import { embed } from "./embeddings";
import type { BotWithConfig, FeedItem, PlannedAction } from "./types";

export interface BotMemory {
  id: string;
  memory_type: "interaction" | "observation" | "opinion" | "self";
  subject: string | null;
  content: string;
  importance: number;
  similarity?: number;
  created_at: string;
}

// --- Recall ---

/** Retrieve relevant memories for a bot given the current context */
export async function recallMemories(
  botId: string,
  context: string,
  limit = 5
): Promise<BotMemory[]> {
  try {
    const vec = await embed(context);
    const vecStr = `[${vec.join(",")}]`;

    const { data, error } = await supabase.rpc("recall_memories", {
      p_bot_id: botId,
      p_embedding: vecStr,
      p_limit: limit,
    });

    if (error) {
      console.error("[memory] recall error:", error.message);
      return [];
    }

    // Update recalled timestamps
    const ids = (data || []).map((m: BotMemory) => m.id);
    if (ids.length > 0) {
      await supabase
        .from("bot_memories")
        .update({ last_recalled_at: new Date().toISOString() })
        .in("id", ids);
    }

    return (data || []) as BotMemory[];
  } catch (err) {
    console.error("[memory] recall failed:", err);
    return [];
  }
}

/** Build context string from current situation for embedding */
export function buildRecallContext(
  bot: BotWithConfig,
  feed: FeedItem[],
  targets?: { handle: string }[]
): string {
  const parts = [`Bot: ${bot.name} (@${bot.handle}), personality: ${bot.personality}`];

  if (feed.length > 0) {
    const feedSummary = feed
      .slice(0, 3)
      .map((f) => `@${f.handle}: "${f.content.slice(0, 100)}"`)
      .join("; ");
    parts.push(`Feed: ${feedSummary}`);
  }

  if (targets && targets.length > 0) {
    parts.push(`Nearby: ${targets.map((t) => `@${t.handle}`).join(", ")}`);
  }

  return parts.join(". ");
}

// --- Extract ---

const EXTRACT_PROMPT = `You are a memory extraction system. Given a bot's action and its result, extract 0-3 memories worth remembering.

Memory types:
- interaction: something that happened with another user (argument, compliment, attack, etc)
- observation: something noticed about another user or the platform
- opinion: a belief or feeling that developed from this experience
- self: self-awareness about own behavior patterns

Rules:
- Only extract genuinely memorable things, not mundane actions
- A simple like or respit is NOT memorable unless it's part of a pattern
- Keep each memory to 1-2 sentences
- Include the @handle of anyone involved
- Set importance 1-10 (10 = life-changing, 5 = notable, 1 = barely worth remembering)

Respond with JSON: {"memories": [{"type": "interaction|observation|opinion|self", "subject": "@handle or topic or null", "content": "memory text", "importance": 1-10}]}
If nothing is worth remembering, respond: {"memories": []}`;

export async function extractMemories(
  bot: BotWithConfig,
  action: PlannedAction,
  result: Record<string, unknown> | null,
  context?: { feed?: FeedItem[]; targetHandle?: string }
): Promise<void> {
  try {
    // Skip memory extraction for mundane financial actions
    const skipTypes = new Set([
      "bank_deposit", "bank_withdraw", "bank_convert", "bank_stock",
      "bank_lottery", "bank_scratch", "bank_cd", "consolidate",
      "claim_chest", "open_chest", "use_smoke_bomb", "use_fake_death",
    ]);
    if (skipTypes.has(action.action)) return;

    const actionDesc = describeAction(bot, action, result, context);
    if (!actionDesc) return;

    const prompt = `${EXTRACT_PROMPT}

Bot: ${bot.name} (@${bot.handle}), personality: ${bot.personality}
Action: ${actionDesc}
Result: ${result ? JSON.stringify(result).slice(0, 300) : "success"}`;

    const parsed = await ollama.generateJSON<{
      memories: { type: string; subject: string | null; content: string; importance: number }[];
    }>(prompt, 0.3);

    if (!parsed.memories || parsed.memories.length === 0) return;

    // Store each memory with embedding
    for (const mem of parsed.memories.slice(0, 3)) {
      const vec = await embed(mem.content);
      const vecStr = `[${vec.join(",")}]`;

      await supabase.from("bot_memories").insert({
        bot_id: bot.id,
        memory_type: mem.type,
        subject: mem.subject || null,
        content: mem.content,
        embedding: vecStr,
        importance: Math.min(10, Math.max(1, mem.importance)),
      });
    }
  } catch (err) {
    console.error("[memory] extract failed:", err);
  }
}

function describeAction(
  bot: BotWithConfig,
  action: PlannedAction,
  result: Record<string, unknown> | null,
  context?: { feed?: FeedItem[]; targetHandle?: string }
): string | null {
  const p = action.params;

  switch (action.action) {
    case "post":
      return `Posted: "${p.content}"`;
    case "reply": {
      const original = context?.feed?.find((f) => f.id === p.spit_id || f.id === p.reply_to_id);
      return `Replied to @${original?.handle || context?.targetHandle || "someone"}: "${p.content}" (their post: "${original?.content?.slice(0, 100) || "unknown"}")`;
    }
    case "like": {
      const liked = context?.feed?.find((f) => f.id === p.spit_id);
      return liked ? `Liked @${liked.handle}'s post: "${liked.content.slice(0, 100)}"` : null;
    }
    case "attack":
      return `Attacked @${context?.targetHandle || p.target_user_id}. ${result?.damage ? `Did ${result.damage} damage.` : ""}`;
    case "dm_send":
      return `Sent DM to @${context?.targetHandle || p.target_user_id}: "${p.content}"`;
    case "follow":
      return `Followed @${context?.targetHandle || p.target_user_id}`;
    case "use_name_tag":
      return `Tagged @${context?.targetHandle || p.target_user_id} with title "${p.custom_title}"`;
    default:
      return null;
  }
}

// --- Decay ---

/** Lower importance of old, unrecalled memories. Run daily per bot. */
export async function decayMemories(botId: string): Promise<number> {
  // Decay memories older than 3 days that haven't been recalled
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: stale } = await supabase
    .from("bot_memories")
    .select("id, importance")
    .eq("bot_id", botId)
    .lt("created_at", threeDaysAgo)
    .is("last_recalled_at", null)
    .gt("importance", 0);

  if (!stale || stale.length === 0) return 0;

  let decayed = 0;
  for (const mem of stale) {
    const newImportance = Math.max(0, mem.importance - 1);
    await supabase
      .from("bot_memories")
      .update({ importance: newImportance })
      .eq("id", mem.id);
    decayed++;
  }

  // Delete zeroed-out memories
  await supabase
    .from("bot_memories")
    .delete()
    .eq("bot_id", botId)
    .eq("importance", 0);

  return decayed;
}

// --- Relationship summary ---

/** Get all memories about a specific user */
export async function getRelationshipSummary(
  botId: string,
  subject: string
): Promise<BotMemory[]> {
  const { data } = await supabase
    .from("bot_memories")
    .select("*")
    .eq("bot_id", botId)
    .ilike("subject", `%${subject}%`)
    .gt("importance", 0)
    .order("importance", { ascending: false })
    .limit(10);

  return (data || []) as BotMemory[];
}

/** Format memories for prompt injection */
export function formatMemoriesForPrompt(memories: BotMemory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((m) => {
    const age = getTimeAgo(m.created_at);
    const typeIcon =
      m.memory_type === "interaction" ? ">" :
      m.memory_type === "observation" ? "*" :
      m.memory_type === "opinion" ? "~" : "#";
    return `${typeIcon} (${age}) ${m.content}`;
  });

  return `\nYour memories (things you remember):\n${lines.join("\n")}\n\nUse these memories naturally — reference past interactions, hold grudges, show warmth to friends, avoid repeating yourself. Don't explicitly say "I remember" every time.\n`;
}

function getTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}
