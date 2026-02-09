import type { BotWithConfig, BotStatus, FeedItem, MarketData } from "./types";

export function buildActionDecisionPrompt(
  bot: BotWithConfig,
  status: BotStatus,
  feed: FeedItem[],
  targets?: { id: string; handle: string; hp: number; max_hp?: number; level?: number }[],
  market?: MarketData
): string {
  const config = bot.config;
  const enabledActions = config?.enabled_actions.join(", ") || "post, reply, like";

  const feedText =
    feed.length > 0
      ? feed
          .map((f) => `- spit_id="${f.id}" by @${f.handle} (user_id="${f.user_id}" HP:${f.hp || "?"}/${f.max_hp || "?"} Lv${f.level || "?"}${f.destroyed ? " DESTROYED" : ""}): "${f.content}" (${f.likes} likes, ${f.respits} respits)`)
          .join("\n")
      : "No recent feed items - do NOT use like/reply/respit actions.";

  const targetText = targets?.length
    ? `\nPotential targets (USE THESE EXACT IDs for attack/follow):\n${targets.map((t) => `- @${t.handle} id="${t.id}" HP:${t.hp || "?"}/${t.max_hp || "?"} Lv${t.level || "?"}`).join("\n")}`
    : "\nNo targets available - do NOT use attack or follow actions.";

  const inventoryText =
    status.inventory.length > 0
      ? status.inventory.map((i) => `${i.name || i.item_type} x${i.quantity} (id="${i.id}")`).join(", ")
      : "Empty (no weapons - buy one to attack!)";

  return `You are ${bot.name} (@${bot.handle}), a user on SPITr (a social combat game).
Personality: ${bot.personality}
${config?.custom_prompt ? `Special instructions: ${config.custom_prompt}` : ""}

Current state:
- HP: ${status.hp}/${status.max_hp}${status.destroyed ? " ⚠️ DESTROYED" : ""}
- Level: ${status.level} (XP: ${status.xp}/${status.xp_next_level})
- Spits (credits): ${status.credits}
- Gold: ${status.gold}
- Inventory: ${inventoryText}
- Bank balance: ${status.bank_balance}
- Stocks owned: ${status.stocks_owned}
- Defense: ${status.has_firewall ? "Firewall ACTIVE" : "No firewall"}${status.kevlar_charges > 0 ? `, Kevlar (${status.kevlar_charges} charges)` : ""}
- Daily chest: ${status.daily_chest_available ? "AVAILABLE" : "already claimed"}

Strategy: Combat=${config?.combat_strategy || "balanced"}, Banking=${config?.banking_strategy || "conservative"}
Enabled actions: ${enabledActions}
Auto-heal threshold: ${config?.auto_heal_threshold || 1000}
${status.hp < (config?.auto_heal_threshold || 1000) ? "\n⚠️ HP is below auto-heal threshold! Consider using a healing item or defensive action." : ""}
${market ? `
Market Intelligence:
- Exchange rate: ${market.current_rate} (${market.current_rate_percent}%, trend: ${market.rate_trend})
- Market signal: ${market.signal} ${market.signal === "bank" ? "(good time to deposit)" : market.signal === "trade" ? "(good time to withdraw/trade)" : "(hold steady)"}
- Stock price: ${market.stock_price} (trend: ${market.stock_trend})${market.time_to_peak_hours != null ? `, peak in ~${market.time_to_peak_hours}h` : ""}${market.time_to_trough_hours != null ? `, trough in ~${market.time_to_trough_hours}h` : ""}` : ""}

Recent feed (last 5 spits):
${feedText}
${targetText}

Choose your next action. You MUST respond with valid JSON only:
{"action": "<action>", "params": {}, "reasoning": "brief explanation"}

ACTIONS:
- "post": {"content": "text (max 540 chars)"}
- "reply": {"spit_id": "id from feed", "content": "reply text"}
- "like": {"spit_id": "id from feed"}
- "respit": {"spit_id": "id from feed"}
- "attack": {"target_id": "user id"} — REQUIRES a weapon in inventory!
- "use_item": {"item_id": "inventory item id"} — use potions to heal, defense to activate
- "follow": {"target_id": "user id to follow"}
- "buy_item": {"item_type": "..."} — see SHOP below
- "bank_deposit": {"amount": number}
- "bank_withdraw": {"amount": number}
- "bank_convert": {"direction": "spits_to_gold|gold_to_spits", "amount": number}
- "bank_stock": {"action": "buy", "amount": number} or {"action": "sell", "amount": number}
- "bank_lottery": {"ticket_type": "ping|phishing|buffer|ddos|token|backdoor|zeroday|mainframe"}
- "bank_cd": {"action": "buy", "amount": number, "term_days": 7, "currency": "spit"|"gold"}
- "open_chest": {}
- "transfer": {"target_id": "user id", "amount": number}
- "dm_send": {"target_user_id": "user id", "content": "DM text (max 2000 chars)"}
- "claim_chest": {} — claim free daily chest (only if available)
- "consolidate": {} — send surplus spits/gold to owner (once per day)

SHOP (buy_item item_type options):
Weapons (used automatically when attacking):
  knife=1g (5 dmg), gun=5g (25 dmg), soldier=25g (100 dmg), drone=100g (500 dmg), nuke=250g (2500 dmg)
Potions (buy then use_item to heal):
  soda=1g (+50 HP), small_potion=10g (+500 HP), medium_potion=25g (+1500 HP), large_potion=75g (+5000 HP)
Defense (buy then use_item to activate):
  firewall=15g (blocks 1 attack), kevlar=30g (blocks 3 attacks)

STRATEGY RULES:
- Do NOT always pick "post". Vary your actions!
- No weapons in inventory? BUY one before attacking. Match weapon to your gold.
- Have a weapon? ATTACK someone.
- Low HP? Buy and use a potion (soda if broke, large_potion if rich).
- Have credits? Bank deposit or buy stocks for investment.
- Low on gold? Convert spits to gold with bank_convert.
- Feeling lucky? Buy a lottery ticket.
- Want safe returns? Open a 7-day bank CD (1.43%/day, best returns). Gold CDs also available.
- Interact with the feed: reply, like, respit other people's spits.
- Buy better weapons when you can afford them (soldier > gun > knife).
- If you have gold and no defense, consider buying a firewall or kevlar.
- DM someone if you want a private conversation.
- Daily chest available? Claim it for free loot!
- Target low-HP users for easier kills. Skip destroyed users.
- Check market signal: "bank" = deposit now for good rates, "trade" = withdraw to trade/invest, "hold" = stay put.
- Stock price low? Buy stocks. Stock price high? Sell for profit.
- Consolidate once per day to send surplus to your owner.`;
}

export function buildContentPrompt(
  bot: BotWithConfig,
  type: "post" | "reply" | "dm_send" | "dm_reply",
  context?: { replyTo?: string; topic?: string; newsArticle?: { title: string; link: string }; dmHistory?: string }
): string {
  const tones: Record<string, string> = {
    aggressive: "confrontational, edgy, and provocative",
    neutral: "casual and conversational",
    friendly: "warm, supportive, and encouraging",
    chaotic: "unpredictable, random, and chaotic",
    intellectual: "thoughtful, analytical, and philosophical",
    troll: "sarcastic, provocative, and meme-heavy",
  };

  const tone = tones[bot.personality] || tones.neutral;
  const rules = "NEVER use hashtags. SPITr does not have hashtags.";

  // Randomize target length to feel more human
  // Sometimes short and punchy, sometimes longer
  const lengthRoll = Math.random();
  const lengthHint = lengthRoll < 0.3
    ? "Keep it very short — just a few words or one brief sentence (under 60 chars)."
    : lengthRoll < 0.6
    ? "Keep it casual length — one or two sentences (under 140 chars)."
    : "Write a normal length post (under 540 chars).";

  if (type === "dm_send") {
    return `You are ${bot.name} (@${bot.handle}) on SPITr. Your personality is ${bot.personality}.
${bot.config?.custom_prompt ? `Special instructions: ${bot.config.custom_prompt}` : ""}

Write a direct message${context?.replyTo ? ` (context: ${context.replyTo})` : ""}.

Be ${tone}. Keep it casual — one or two sentences. ${rules}
Just output the DM text, nothing else. Do not wrap in quotes.`;
  }

  if (type === "dm_reply") {
    return `You are ${bot.name} (@${bot.handle}) on SPITr. Your personality is ${bot.personality}.
${bot.config?.custom_prompt ? `Special instructions: ${bot.config.custom_prompt}` : ""}

You have an unread DM conversation. Here is the recent chat history:
${context?.dmHistory || "(no history)"}

Write your reply to continue this conversation. Stay in character.
Be ${tone}. Keep it natural — respond to what they said. ${rules}
Just output your reply text, nothing else. Do not wrap in quotes.`;
  }

  if (type === "reply" && context?.replyTo) {
    const replyLengthHint = lengthRoll < 0.4
      ? "Keep your reply very short — a few words is fine."
      : "Keep your reply casual length.";

    return `You are ${bot.name} (@${bot.handle}) on SPITr. Your personality is ${bot.personality}.
${bot.config?.custom_prompt ? `Special instructions: ${bot.config.custom_prompt}` : ""}

Write a reply to this spit:
"${context.replyTo}"

Be ${tone}. ${replyLengthHint} ${rules}
Just output the reply text, nothing else.`;
  }

  if (context?.newsArticle) {
    const newsLengthHint = lengthRoll < 0.4
      ? "React in just a few words (under 50 chars)."
      : "Write a short comment (under 150 chars).";

    return `You are ${bot.name} (@${bot.handle}) on SPITr, a social combat game. Your personality is ${bot.personality}.
${bot.config?.custom_prompt ? `Special instructions: ${bot.config.custom_prompt}` : ""}

You found this article and want to share it:
"${context.newsArticle.title}"

${newsLengthHint} Sound like YOU would say it. Be ${tone}. ${rules}
IMPORTANT: Just output your comment text, nothing else. Do NOT include the link - it will be appended automatically. Do not wrap in quotes.`;
  }

  return `You are ${bot.name} (@${bot.handle}) on SPITr, a social combat game. Your personality is ${bot.personality}.
${bot.config?.custom_prompt ? `Special instructions: ${bot.config.custom_prompt}` : ""}
${context?.topic ? `Topic hint: ${context.topic}` : ""}

${lengthHint} Be ${tone}. ${rules}
Just output the post text, nothing else. Do not wrap in quotes.`;
}
