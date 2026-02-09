import { ollama } from "./ollama";
import { spitrApi } from "./spitr-api";
import { buildActionDecisionPrompt, buildContentPrompt } from "./prompts";
import type { DMConversation } from "./types";
import { getNewsForBot } from "./news";
import type { BotWithConfig, BotStatus, FeedItem, PlannedAction, MarketData, BankingProfile } from "./types";

const NEWS_POST_CHANCE = 0.3; // 30% chance a post includes a news link
const MAX_CONTENT_LEN = 540;

// --- Banking Profiles ---
// Numeric thresholds per banking strategy — drives all financial decisions deterministically

const BANKING_PROFILES: Record<string, BankingProfile> = {
  aggressive: {
    depositPercent: 0.6,
    withdrawPercent: 0.4,
    minWalletReserve: 50,
    stockBuyThreshold: 80,   // buy when stock price < 80
    stockSellThreshold: 130, // sell when stock price > 130
    consolidateReserveSpits: 100,
    consolidateReserveGold: 5,
  },
  balanced: {
    depositPercent: 0.4,
    withdrawPercent: 0.3,
    minWalletReserve: 200,
    stockBuyThreshold: 70,
    stockSellThreshold: 150,
    consolidateReserveSpits: 300,
    consolidateReserveGold: 15,
  },
  conservative: {
    depositPercent: 0.25,
    withdrawPercent: 0.15,
    minWalletReserve: 500,
    stockBuyThreshold: 50,
    stockSellThreshold: 180,
    consolidateReserveSpits: 500,
    consolidateReserveGold: 30,
  },
};

function getProfile(bot: BotWithConfig): BankingProfile {
  return BANKING_PROFILES[bot.config?.banking_strategy || "conservative"] || BANKING_PROFILES.conservative;
}

// --- Consolidation Tracking (once per day per bot, in-memory) ---

const consolidatedToday = new Map<string, string>(); // bot.id → date string

function hasConsolidatedToday(botId: string): boolean {
  const today = new Date().toISOString().split("T")[0];
  return consolidatedToday.get(botId) === today;
}

function markConsolidated(botId: string): void {
  consolidatedToday.set(botId, new Date().toISOString().split("T")[0]);
}

/** Check if bot should consolidate surplus to owner */
function checkConsolidate(bot: BotWithConfig, status: BotStatus): PlannedAction | null {
  if (hasConsolidatedToday(bot.id)) return null;
  if (!bot.owner_id || bot.owner_id === bot.user_id) return null;

  const profile = getProfile(bot);
  const surplusSpits = status.credits - profile.consolidateReserveSpits;
  const surplusGold = status.gold - profile.consolidateReserveGold;

  // Only consolidate if there's meaningful surplus
  if (surplusSpits < 50 && surplusGold < 5) return null;

  markConsolidated(bot.id);
  return {
    action: "consolidate",
    params: {
      spit_reserve: profile.consolidateReserveSpits,
      gold_reserve: profile.consolidateReserveGold,
    },
    reasoning: `Daily consolidation: sending surplus (${Math.max(surplusSpits, 0)} spits, ${Math.max(surplusGold, 0)} gold) to owner. Reserve: ${profile.consolidateReserveSpits} spits, ${profile.consolidateReserveGold} gold`,
  };
}

/** Translate a single advisor strategy entry into a PlannedAction */
function translateAdvisorAction(
  strategy: { action: string; params: Record<string, unknown>; reasoning: string },
  bot: BotWithConfig,
  status: BotStatus
): PlannedAction | null {
  const profile = getProfile(bot);

  switch (strategy.action) {
    case "redeem_cd": {
      // Redeem the first matured CD
      const advisor = status.financial_advisor;
      const matured = advisor?.redeemable_cds?.find(cd => cd.matured);
      if (!matured) return null;
      return {
        action: "bank_cd",
        params: { action: "redeem", cd_id: matured.cd_id },
        reasoning: `Advisor: ${strategy.reasoning} (redeeming ${matured.amount} ${matured.currency} CD)`,
      };
    }

    case "convert_spits":
    case "convert_gold": {
      const direction = (strategy.params.direction as string) || "spits_to_gold";
      const amount = Number(strategy.params.amount) || 0;
      if (amount < 1) return null;
      return {
        action: "bank_convert",
        params: { direction, amount },
        reasoning: `Advisor: ${strategy.reasoning}`,
      };
    }

    case "buy_spit_cd":
    case "buy_gold_cd": {
      const currency = strategy.action === "buy_gold_cd" ? "gold" : "spit";
      const amount = Number(strategy.params.amount) || Math.floor(status.credits * profile.depositPercent);
      if (amount < 1) return null;
      return {
        action: "bank_cd",
        params: { action: "buy", amount, term_days: 7, currency },
        reasoning: `Advisor: ${strategy.reasoning} (7-day ${currency} CD)`,
      };
    }

    case "deposit_at_peak_rate": {
      const available = Math.max(status.credits - profile.minWalletReserve, 0);
      const amount = Number(strategy.params.amount) || Math.floor(available * profile.depositPercent);
      if (amount < 1) return null;
      return {
        action: "bank_deposit",
        params: { amount },
        reasoning: `Advisor: ${strategy.reasoning}`,
      };
    }

    case "withdraw_matured_deposits": {
      if (!status.deposits_over_24h || status.deposits_over_24h.length === 0) return null;
      const matureDeposit = status.deposits_over_24h.find(d => d.accrued_interest > 0);
      if (!matureDeposit) return null;
      const amount = Number(strategy.params.amount) || Math.floor(matureDeposit.current_value * profile.withdrawPercent);
      if (amount < 1) return null;
      return {
        action: "bank_withdraw",
        params: { amount, currency: "spit" },
        reasoning: `Advisor: ${strategy.reasoning}`,
      };
    }

    case "consolidate": {
      return checkConsolidate(bot, status);
    }

    case "hold":
      return null;

    default:
      console.log(`[Planner] Unknown advisor action: ${strategy.action}`);
      return null;
  }
}

/** Advisor-driven financial action planner — walks the server's priority queue */
function planAdvisorAction(bot: BotWithConfig, status: BotStatus): PlannedAction | null {
  const advisor = status.financial_advisor;
  if (!advisor || !advisor.priority_queue || advisor.priority_queue.length === 0) return null;

  // Walk the priority queue in order, return the first actionable one
  for (const strategy of advisor.priority_queue) {
    const action = translateAdvisorAction(strategy, bot, status);
    if (action) return action;
  }

  return null;
}

/** Trim content to fit limit, cutting at last sentence boundary instead of mid-word */
function trimContent(s: string, limit = MAX_CONTENT_LEN): string {
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  // Try to end at a sentence boundary
  const lastSentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf(".\n"), cut.lastIndexOf(".\""), cut.lastIndexOf("!\""), cut.lastIndexOf("?\""));
  if (lastSentence > 80) return cut.slice(0, lastSentence + 1).trim();
  // Fall back to last word boundary
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 80) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

// Item data from SPITr spec
const WEAPONS = [
  { type: "nuke", cost: 250, damage: 2500 },
  { type: "drone", cost: 100, damage: 500 },
  { type: "soldier", cost: 25, damage: 100 },
  { type: "gun", cost: 5, damage: 25 },
  { type: "knife", cost: 1, damage: 5 },
];
const WEAPON_TYPES = WEAPONS.map((w) => w.type);

const POTIONS = [
  { type: "large_potion", cost: 75, heal: 5000 },
  { type: "medium_potion", cost: 25, heal: 1500 },
  { type: "small_potion", cost: 10, heal: 500 },
  { type: "soda", cost: 1, heal: 50 },
];
const POTION_TYPES = POTIONS.map((p) => p.type);

async function bootstrapFollows(bot: BotWithConfig): Promise<void> {
  // Get users from the owner's feed and auto-follow them
  if (!bot.owner_id || bot.owner_id === bot.user_id) return;

  const ownerFeed = await spitrApi.getFeed(bot.owner_id, 10);
  const uniqueUsers = ownerFeed
    .filter((f) => f.user_id !== bot.user_id && f.user_id !== bot.owner_id)
    .filter((f, i, arr) => arr.findIndex((a) => a.user_id === f.user_id) === i)
    .slice(0, 5); // Follow up to 5 users

  for (const user of uniqueUsers) {
    try {
      await spitrApi.follow(bot.user_id, user.user_id);
      console.log(`[Bootstrap] ${bot.name} auto-followed @${user.handle}`);
    } catch (err) {
      console.error(`[Bootstrap] ${bot.name} failed to follow @${user.handle}:`, err);
    }
  }

  // Also follow the owner
  try {
    await spitrApi.follow(bot.user_id, bot.owner_id);
    console.log(`[Bootstrap] ${bot.name} auto-followed owner`);
  } catch {
    // Owner might already be followed
  }
}

async function getFeedWithFallback(bot: BotWithConfig): Promise<FeedItem[]> {
  const feed = await spitrApi.getFeed(bot.user_id);
  if (feed.length > 0) return feed;

  // Bot's feed is empty - bootstrap by following users from owner's feed
  console.log(`[Planner] ${bot.name} has empty feed, bootstrapping follows...`);
  await bootstrapFollows(bot);

  // Try the bot's feed again after following
  const newFeed = await spitrApi.getFeed(bot.user_id);
  if (newFeed.length > 0) return newFeed;

  // Still empty - use owner's feed as last resort
  if (bot.owner_id && bot.owner_id !== bot.user_id) {
    const ownerFeed = await spitrApi.getFeed(bot.owner_id);
    if (ownerFeed.length > 0) return ownerFeed;
  }

  return [];
}

/** Check if bot needs healing and return a heal action, or null */
function checkAutoHeal(bot: BotWithConfig, status: { hp: number; max_hp: number; gold: number; inventory: { id: string; item_type: string; name: string }[] }): PlannedAction | null {
  const threshold = bot.config?.auto_heal_threshold || 1000;
  if (status.hp >= threshold) return null;

  // Check inventory for potions (best first)
  for (const potion of POTIONS) {
    const item = status.inventory.find((i) =>
      (i.item_type?.toLowerCase() || i.name?.toLowerCase() || "") === potion.type
    );
    if (item) {
      return {
        action: "use_item",
        params: { item_id: item.id },
        reasoning: `Auto-heal: HP ${status.hp}/${status.max_hp} below threshold ${threshold} - using ${potion.type} (+${potion.heal} HP)`,
      };
    }
  }

  // No potions in inventory — buy the best one we can afford
  const affordable = POTIONS.find((p) => status.gold >= p.cost);
  if (affordable) {
    return {
      action: "buy_item",
      params: { item_type: affordable.type },
      reasoning: `Auto-heal: HP ${status.hp}/${status.max_hp} below threshold ${threshold} - buying ${affordable.type} (+${affordable.heal} HP)`,
    };
  }

  return null; // No potions and no gold, continue with normal planning
}

/** Check for unread DMs and generate a reply if found */
async function checkUnreadDMs(bot: BotWithConfig): Promise<PlannedAction | null> {
  try {
    const convos = await spitrApi.getConversations(bot.user_id);
    const unread = convos.find((c: DMConversation) => c.unread);
    if (!unread) return null;

    // Build context from the conversation data
    // Use last_message from conversations response (avoids messages endpoint 403 bug)
    let dmHistory = `@${unread.other_handle}: ${unread.last_message || "(message)"}`;

    // Try to fetch full history for richer context (may fail due to spitr bug)
    try {
      const messages = await spitrApi.getMessages(bot.user_id, unread.conversation_id);
      if (messages.length > 0) {
        const recent = messages.slice(-6);
        dmHistory = recent
          .map((m) => `@${m.sender_id === bot.user_id ? bot.handle : unread.other_handle}: ${m.content}`)
          .join("\n");
      }
    } catch {
      // Messages endpoint may 403 — fall back to last_message context
    }

    // Generate reply with conversation context
    const contentPrompt = buildContentPrompt(bot, "dm_reply", { dmHistory });
    let content = await ollama.generate(contentPrompt, { temperature: 0.8 });
    content = content.trim().replace(/^["']|["']$/g, "");
    if (content.length > 2000) content = trimContent(content, 2000);

    console.log(`[Planner] ${bot.name} replying to DM from @${unread.other_handle}`);

    return {
      action: "dm_send",
      params: { target_user_id: unread.other_user_id, content },
      reasoning: `Replying to unread DM from @${unread.other_handle}`,
    };
  } catch (err) {
    console.error(`[Planner] ${bot.name} DM check failed:`, err);
    return null;
  }
}

export async function planAction(bot: BotWithConfig): Promise<PlannedAction> {
  // Gather context from spitr API (market fetched in parallel)
  const [status, feed, market] = await Promise.all([
    spitrApi.getStatus(bot.user_id),
    getFeedWithFallback(bot),
    spitrApi.getMarket(),
  ]);

  // Destroyed guard — skip all actions if bot is dead
  if (status.destroyed) {
    return {
      action: "post",
      params: {},
      reasoning: "Bot is destroyed (0 HP) - skipping action",
      _skip: true,
    } as PlannedAction & { _skip?: boolean };
  }

  // Daily chest auto-claim (free loot, always grab it)
  if (status.daily_chest_available) {
    return {
      action: "claim_chest",
      params: {},
      reasoning: "Daily chest available - claiming free loot",
    };
  }

  // Consolidation to owner (once per day, priority)
  const consolidateAction = checkConsolidate(bot, status);
  if (consolidateAction) return consolidateAction;

  // Priority: auto-heal if HP is critical
  const healAction = checkAutoHeal(bot, status);
  if (healAction) return healAction;

  // Check for unread DMs — reply takes priority over regular actions
  const dmReply = await checkUnreadDMs(bot);
  if (dmReply) return dmReply;

  // Defense logic: defensive bots buy firewall if they don't have one
  if (bot.config?.combat_strategy === "defensive" && !status.has_firewall && status.gold >= 15) {
    return {
      action: "buy_item",
      params: { item_type: "firewall" },
      reasoning: "Defensive bot without firewall - buying one (blocks 1 attack)",
    };
  }

  // Advisor-driven financial action (server-side priority queue)
  const financialAction = planAdvisorAction(bot, status);
  if (financialAction) return financialAction;

  // Extract potential targets from the feed (with HP/level awareness)
  const targets = feed
    .filter((f) => f.user_id !== bot.user_id && !f.destroyed)
    .map((f) => ({ id: f.user_id, handle: f.handle, hp: f.hp || 0, max_hp: f.max_hp || 5000, level: f.level || 1 }))
    .filter((t, i, arr) => arr.findIndex((a) => a.id === t.id) === i);

  // Build prompt and ask Ollama for an action decision
  const prompt = buildActionDecisionPrompt(bot, status, feed, targets, market);

  const decision = await ollama.generateJSON<PlannedAction>(prompt);

  // Fix bad target IDs from Ollama (handles instead of UUIDs)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (decision.params.target_id && !uuidRegex.test(decision.params.target_id as string)) {
    const badVal = String(decision.params.target_id).replace(/^@/, "").toLowerCase();
    const match = targets.find((t) => t.handle.toLowerCase() === badVal);
    if (match) {
      console.log(`[Planner] Fixed bad target_id "${decision.params.target_id}" → ${match.id} (@${match.handle})`);
      decision.params.target_id = match.id;
    } else if (targets.length > 0) {
      const fallback = targets[Math.floor(Math.random() * targets.length)];
      console.log(`[Planner] Bad target_id "${decision.params.target_id}" not found, using @${fallback.handle}`);
      decision.params.target_id = fallback.id;
    }
  }

  // Fix bad spit_id references too
  if (decision.params.spit_id && !uuidRegex.test(decision.params.spit_id as string)) {
    if (feed.length > 0) {
      const fallback = feed[Math.floor(Math.random() * feed.length)];
      console.log(`[Planner] Fixed bad spit_id "${decision.params.spit_id}" → ${fallback.id}`);
      decision.params.spit_id = fallback.id;
    }
  }

  // If action is a content action, generate the text via Ollama
  if (
    (decision.action === "post" || decision.action === "reply") &&
    !decision.params.content
  ) {
    // Maybe attach a news article to posts
    let newsArticle: { title: string; link: string } | undefined;
    if (decision.action === "post" && Math.random() < NEWS_POST_CHANCE) {
      const article = await getNewsForBot(bot);
      if (article) newsArticle = article;
    }

    const contentPrompt = buildContentPrompt(bot, decision.action, {
      replyTo:
        decision.action === "reply"
          ? feed.find((f) => f.id === decision.params.spit_id)?.content
          : undefined,
      newsArticle,
    });

    let content = await ollama.generate(contentPrompt, { temperature: 0.8 });
    content = content.trim().replace(/^["']|["']$/g, "");

    // Append the link and ensure total content fits under 480 chars (plenty of buffer for 560 limit)
    if (newsArticle) {
      const maxCommentLen = 540 - newsArticle.link.length - 1;
      if (content.length > maxCommentLen) {
        content = trimContent(content, maxCommentLen);
      }
      content = `${content} ${newsArticle.link}`;
    }

    // Hard cap at 480 chars (560 is spitr limit, 80 char buffer)
    if (content.length > 540) {
      content = trimContent(content);
    }

    decision.params.content = content;
  }

  // Hard cap ALL content at 480 chars (80 char buffer under 560 spitr limit)
  if (decision.params.content && String(decision.params.content).length > 540) {
    decision.params.content = trimContent(String(decision.params.content));
  }

  // Guard buy_item — check bot can actually afford it
  if (decision.action === "buy_item") {
    const itemType = String(decision.params.item_type || "");
    const itemCost = [...WEAPONS, ...POTIONS, { type: "firewall", cost: 15 }, { type: "kevlar", cost: 30 }, { type: "spray_paint", cost: 5 }]
      .find((i) => i.type === itemType)?.cost || 1;
    if (status.gold < itemCost) {
      // Can't afford what Ollama picked — buy cheapest thing we can, or bail
      const affordable = WEAPONS.find((w) => status.gold >= w.cost);
      if (affordable) {
        decision.params = { item_type: affordable.type };
        decision.reasoning = `Can't afford ${itemType} (${itemCost}g) - buying ${affordable.type} instead`;
      } else if (status.credits >= 100) {
        decision.action = "bank_convert";
        decision.params = { direction: "spits_to_gold", amount: Math.floor(status.credits * 0.2) };
        decision.reasoning = "No gold - converting spits first";
      } else {
        decision.action = "post";
        decision.params = {};
        decision.reasoning = "No gold or credits to buy items";
      }
    }
  }

  // Guard bank_deposit — clamp to actual balance, bail if broke
  if (decision.action === "bank_deposit") {
    const amount = Number(decision.params.amount) || 0;
    if (status.credits < 1 || amount < 1) {
      decision.action = "post";
      decision.params = {};
      decision.reasoning = "No credits to deposit";
    } else if (amount > status.credits) {
      decision.params.amount = Math.floor(status.credits * 0.5);
    }
  }

  // Guard bank_withdraw — clamp to actual bank balance, ensure currency is set
  if (decision.action === "bank_withdraw") {
    const amount = Number(decision.params.amount) || 0;
    if (status.bank_balance < 1 || amount < 1) {
      decision.action = "post";
      decision.params = {};
      decision.reasoning = "No bank balance to withdraw";
    } else {
      if (amount > status.bank_balance) {
        decision.params.amount = Math.floor(status.bank_balance * 0.5);
      }
      if (!decision.params.currency) {
        decision.params.currency = "spit";
      }
    }
  }

  // Guard bank_convert — make sure bot has enough of whichever currency
  if (decision.action === "bank_convert") {
    const amount = Number(decision.params.amount) || 0;
    if (decision.params.direction === "spits_to_gold" && (status.credits < 1 || amount < 1)) {
      decision.action = "post";
      decision.params = {};
      decision.reasoning = "No credits to convert";
    } else if (decision.params.direction === "spits_to_gold" && amount > status.credits) {
      decision.params.amount = Math.floor(status.credits * 0.3);
    }
  }

  return decision;
}

export async function planSpecificAction(
  bot: BotWithConfig,
  actionType: string
): Promise<PlannedAction> {
  const [status, feed, market] = await Promise.all([
    spitrApi.getStatus(bot.user_id),
    getFeedWithFallback(bot),
    spitrApi.getMarket(),
  ]);

  // Destroyed guard — skip all actions if bot is dead
  if (status.destroyed) {
    return {
      action: "post",
      params: {},
      reasoning: "Bot is destroyed (0 HP) - skipping action",
      _skip: true,
    } as PlannedAction & { _skip?: boolean };
  }

  // Daily chest auto-claim (free loot, always grab it)
  if (status.daily_chest_available) {
    return {
      action: "claim_chest",
      params: {},
      reasoning: "Daily chest available - claiming free loot",
    };
  }

  // Priority: auto-heal if HP is critical (regardless of requested action)
  const healAction = checkAutoHeal(bot, status);
  if (healAction) return healAction;

  // Check for unread DMs — reply takes priority over regular actions
  const dmReply = await checkUnreadDMs(bot);
  if (dmReply) return dmReply;

  // For content actions, generate via Ollama
  if (actionType === "post") {
    // Maybe attach a news article
    let newsArticle: { title: string; link: string } | undefined;
    if (Math.random() < NEWS_POST_CHANCE) {
      const article = await getNewsForBot(bot);
      if (article) newsArticle = article;
    }

    const contentPrompt = buildContentPrompt(bot, "post", { newsArticle });
    let content = await ollama.generate(contentPrompt, { temperature: 0.8 });
    content = content.trim().replace(/^["']|["']$/g, "");

    if (newsArticle) {
      const maxCommentLen = 540 - newsArticle.link.length - 1;
      if (content.length > maxCommentLen) {
        content = trimContent(content, maxCommentLen);
      }
      content = `${content} ${newsArticle.link}`;
      console.log(`[Planner] ${bot.name} posting news: ${newsArticle.title}`);
    }

    if (content.length > 540) {
      content = trimContent(content);
    }

    return {
      action: "post",
      params: { content },
      reasoning: newsArticle ? `Sharing article: ${newsArticle.title}` : "Manual trigger",
    };
  }

  if (actionType === "reply" && feed.length > 0) {
    const target = feed[Math.floor(Math.random() * feed.length)];
    const contentPrompt = buildContentPrompt(bot, "reply", {
      replyTo: target.content,
    });
    let content = await ollama.generate(contentPrompt, { temperature: 0.8 });
    content = content.trim().replace(/^["']|["']$/g, "");
    if (content.length > 540) content = trimContent(content);
    return {
      action: "reply",
      params: {
        spit_id: target.id,
        content,
      },
      reasoning: `Replying to @${target.handle}`,
    };
  }

  if (actionType === "like" && feed.length > 0) {
    const target = feed[Math.floor(Math.random() * feed.length)];
    return {
      action: "like",
      params: { spit_id: target.id },
      reasoning: `Liking spit by @${target.handle}`,
    };
  }

  if (actionType === "consolidate") {
    const consolidateAction = checkConsolidate(bot, status);
    if (consolidateAction) return consolidateAction;
    return {
      action: "post",
      params: {},
      reasoning: "Already consolidated today or no surplus",
    };
  }

  if (actionType === "bank_deposit") {
    const profile = getProfile(bot);
    if (status.credits < 1) {
      return {
        action: "post",
        params: { content: "broke as hell rn" },
        reasoning: "No credits to deposit",
      };
    }
    // Market-aware: deposit more when signal says "bank", less when "trade"
    let depositPct = profile.depositPercent;
    if (market.signal === "bank") depositPct = Math.min(depositPct * 1.5, 0.8);
    else if (market.signal === "trade") depositPct = depositPct * 0.5;
    const available = Math.max(status.credits - profile.minWalletReserve, 0);
    const amount = Math.max(Math.floor(available * depositPct), 1);
    if (amount < 1) {
      return {
        action: "post",
        params: { content: "broke as hell rn" },
        reasoning: `Credits (${status.credits}) below wallet reserve (${profile.minWalletReserve})`,
      };
    }
    return {
      action: "bank_deposit",
      params: { amount },
      reasoning: `Depositing ${amount} credits (market: ${market.signal}, rate: ${market.current_rate}, trend: ${market.rate_trend})`,
    };
  }

  if (actionType === "bank_withdraw") {
    const profile = getProfile(bot);
    if (status.bank_balance < 1) {
      return {
        action: "post",
        params: { content: "nothing in the bank smh" },
        reasoning: "No bank balance to withdraw",
      };
    }

    // Smart currency pick: if wallet gold is low and bot needs items, withdraw gold
    // Otherwise withdraw spits (the default banking currency)
    if (status.gold < 5 && status.bank_balance > 5) {
      const goldAmount = Math.max(Math.floor(status.bank_balance * 0.15), 1);
      return {
        action: "bank_withdraw",
        params: { amount: goldAmount, currency: "gold" },
        reasoning: `Wallet gold low (${status.gold}) — withdrawing ${goldAmount} gold for item purchases`,
      };
    }

    // Market-aware spit withdrawal: more when signal says "trade", less when "bank"
    let withdrawPct = profile.withdrawPercent;
    if (market.signal === "trade") withdrawPct = Math.min(withdrawPct * 1.5, 0.6);
    else if (market.signal === "bank") withdrawPct = withdrawPct * 0.5;
    const amount = Math.max(Math.floor(status.bank_balance * withdrawPct), 1);
    return {
      action: "bank_withdraw",
      params: { amount, currency: "spit" },
      reasoning: `Withdrawing ${amount} credits (market: ${market.signal}, rate: ${market.current_rate}, trend: ${market.rate_trend})`,
    };
  }

  if (actionType === "respit" && feed.length > 0) {
    const target = feed[Math.floor(Math.random() * feed.length)];
    return {
      action: "respit",
      params: { spit_id: target.id },
      reasoning: `Respitting spit by @${target.handle}`,
    };
  }

  if (actionType === "attack") {
    // If no weapons in inventory, buy the best one we can afford
    const hasWeapon = status.inventory.some((i) =>
      WEAPON_TYPES.includes(i.item_type || i.name?.toLowerCase() || "")
    );
    if (!hasWeapon) {
      const affordable = WEAPONS.find((w) => status.gold >= w.cost) || WEAPONS[WEAPONS.length - 1];
      if (status.gold < 1) {
        return {
          action: "bank_convert",
          params: { direction: "spits_to_gold", amount: Math.max(Math.floor(status.credits * 0.2), 1) },
          reasoning: "No gold to buy weapons - converting spits first",
        };
      }
      return {
        action: "buy_item",
        params: { item_type: affordable.type },
        reasoning: `Need a weapon to attack - buying ${affordable.type} (${affordable.damage} dmg) for ${affordable.cost}g`,
      };
    }

    // Smart targeting: filter out destroyed users, sort by strategy
    const targets = feed
      .filter((f) => f.user_id !== bot.user_id && !f.destroyed)
      .map((f) => ({ id: f.user_id, handle: f.handle, hp: f.hp || 0, level: f.level || 1 }))
      .filter((t, i, arr) => arr.findIndex((a) => a.id === t.id) === i);

    if (targets.length > 0) {
      let target;
      const strategy = bot.config?.combat_strategy || "balanced";
      if (strategy === "aggressive") {
        // Target weakest first
        target = targets.sort((a, b) => a.hp - b.hp)[0];
      } else {
        target = targets[Math.floor(Math.random() * targets.length)];
      }
      return {
        action: "attack",
        params: { target_id: target.id },
        reasoning: `Attacking @${target.handle} (HP: ${target.hp}, Lv${target.level})`,
      };
    }
    // No targets available, fall back to a post
    const contentPrompt = buildContentPrompt(bot, "post");
    let content = await ollama.generate(contentPrompt, { temperature: 0.8 });
    content = content.trim().replace(/^["']|["']$/g, "");
    if (content.length > 540) content = trimContent(content);
    return {
      action: "post",
      params: { content },
      reasoning: "No attack targets in feed, posting instead",
    };
  }

  if (actionType === "follow") {
    const targets = feed
      .filter((f) => f.user_id !== bot.user_id)
      .map((f) => ({ id: f.user_id, handle: f.handle }))
      .filter((t, i, arr) => arr.findIndex((a) => a.id === t.id) === i);

    if (targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      return {
        action: "follow",
        params: { target_id: target.id },
        reasoning: `Following @${target.handle}`,
      };
    }
    return {
      action: "post",
      params: { content: "Looking for new people to follow..." },
      reasoning: "No follow targets in feed",
    };
  }

  if (actionType === "use_item" && status.inventory.length > 0) {
    const item = status.inventory[0];
    return {
      action: "use_item",
      params: { item_id: item.id },
      reasoning: `Using ${item.name}`,
    };
  }

  if (actionType === "buy_item") {
    if (status.gold < 1) {
      if (status.credits >= 100) {
        return {
          action: "bank_convert",
          params: { direction: "spits_to_gold", amount: Math.floor(status.credits * 0.2) },
          reasoning: "No gold to buy items - converting spits to gold first",
        };
      }
      return {
        action: "post",
        params: { content: "need more gold..." },
        reasoning: "No gold or credits to buy items",
      };
    }

    // Smart purchasing: consider what the bot needs most
    const hasWeapon = status.inventory.some((i) => WEAPON_TYPES.includes(i.item_type?.toLowerCase() || ""));
    const hpPercent = status.max_hp > 0 ? status.hp / status.max_hp : 1;
    const needsHealing = hpPercent < 0.5;

    // If low HP and no potions, buy a potion
    if (needsHealing) {
      const potion = POTIONS.find((p) => status.gold >= p.cost) || POTIONS[POTIONS.length - 1];
      if (status.gold >= potion.cost) {
        return {
          action: "buy_item",
          params: { item_type: potion.type },
          reasoning: `Low HP (${status.hp}/${status.max_hp}) - buying ${potion.type} (+${potion.heal} HP)`,
        };
      }
    }

    // If no weapon, buy best affordable weapon
    if (!hasWeapon) {
      const weapon = WEAPONS.find((w) => status.gold >= w.cost) || WEAPONS[WEAPONS.length - 1];
      return {
        action: "buy_item",
        params: { item_type: weapon.type },
        reasoning: `Buying ${weapon.type} (${weapon.damage} dmg) for ${weapon.cost}g`,
      };
    }

    // Otherwise buy the best weapon we can afford
    const weapon = WEAPONS.find((w) => status.gold >= w.cost) || WEAPONS[WEAPONS.length - 1];
    return {
      action: "buy_item",
      params: { item_type: weapon.type },
      reasoning: `Buying ${weapon.type} (${status.gold}g available)`,
    };
  }

  if (actionType === "open_chest") {
    return {
      action: "open_chest",
      params: {},
      reasoning: "Opening a chest",
    };
  }

  if (actionType === "transfer") {
    const targets = feed
      .filter((f) => f.user_id !== bot.user_id)
      .map((f) => ({ id: f.user_id, handle: f.handle }))
      .filter((t, i, arr) => arr.findIndex((a) => a.id === t.id) === i);

    if (targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      const amount = Math.floor(status.credits * 0.1);
      return {
        action: "transfer",
        params: { target_id: target.id, amount: Math.max(amount, 1) },
        reasoning: `Transferring ${amount} credits to @${target.handle}`,
      };
    }
  }

  if (actionType === "bank_convert") {
    // Convert spits to gold if we have credits but low gold
    if (status.credits > 100 && status.gold < 10) {
      return {
        action: "bank_convert",
        params: { direction: "spits_to_gold", amount: Math.floor(status.credits * 0.2) },
        reasoning: `Converting ${Math.floor(status.credits * 0.2)} spits to gold`,
      };
    }
    // Otherwise convert gold to spits
    if (status.gold > 50) {
      return {
        action: "bank_convert",
        params: { direction: "gold_to_spits", amount: Math.floor(status.gold * 0.1) },
        reasoning: `Converting ${Math.floor(status.gold * 0.1)} gold to spits`,
      };
    }
    return {
      action: "bank_convert",
      params: { direction: "spits_to_gold", amount: Math.max(Math.floor(status.credits * 0.1), 1) },
      reasoning: "Converting some spits to gold",
    };
  }

  if (actionType === "bank_stock") {
    const profile = getProfile(bot);
    // Market-aware: sell if price high, buy if price low
    if (status.stocks_owned > 0 && market.stock_price > profile.stockSellThreshold) {
      const shares = Math.ceil(status.stocks_owned * 0.5);
      return {
        action: "bank_stock",
        params: { action: "sell", amount: shares },
        reasoning: `Selling ${shares} shares — price ${market.stock_price} > threshold ${profile.stockSellThreshold} (trend: ${market.stock_trend})`,
      };
    }
    if (market.stock_price < profile.stockBuyThreshold && status.credits > profile.minWalletReserve) {
      const investAmount = Math.floor((status.credits - profile.minWalletReserve) * 0.2);
      return {
        action: "bank_stock",
        params: { action: "buy", amount: Math.max(investAmount, 1) },
        reasoning: `Buying stocks — price ${market.stock_price} < threshold ${profile.stockBuyThreshold} (trend: ${market.stock_trend})`,
      };
    }
    // Default: buy a modest amount
    const amount = Math.floor(status.credits * 0.15);
    return {
      action: "bank_stock",
      params: { action: "buy", amount: Math.max(amount, 1) },
      reasoning: `Buying stocks with ${amount} credits (price: ${market.stock_price}, trend: ${market.stock_trend})`,
    };
  }

  if (actionType === "bank_lottery" || actionType === "bank_scratch") {
    // Ticket prices: ping=1, phishing=10, buffer=50, ddos=100, token/backdoor/zeroday/mainframe=very expensive
    // Pick the most expensive one the bot can afford
    const tickets: { type: string; cost: number }[] = [
      { type: "ddos", cost: 100 },
      { type: "buffer", cost: 50 },
      { type: "phishing", cost: 10 },
      { type: "ping", cost: 1 },
    ];
    const affordable = tickets.find((t) => status.bank_balance >= t.cost) || tickets[tickets.length - 1];
    return {
      action: "bank_lottery",
      params: { ticket_type: affordable.type },
      reasoning: `Buying ${affordable.type} ticket (costs ${affordable.cost}, bank: ${Math.floor(status.bank_balance)})`,
    };
  }

  if (actionType === "bank_cd") {
    // Check advisor for matured CDs to redeem first
    const advisor = status.financial_advisor;
    const maturedCd = advisor?.redeemable_cds?.find(cd => cd.matured);
    if (maturedCd) {
      return {
        action: "bank_cd",
        params: { action: "redeem", cd_id: maturedCd.cd_id },
        reasoning: `Redeeming matured ${maturedCd.amount} ${maturedCd.currency} CD`,
      };
    }

    // Buy a 7-day CD (optimal rate per advisor)
    const currency = advisor?.cd_advice?.recommended_currency || "spit";
    const amount = Math.floor(status.credits * 0.2);
    return {
      action: "bank_cd",
      params: { action: "buy", amount: Math.max(amount, 1), term_days: 7, currency },
      reasoning: `Opening a 7-day ${currency} CD with ${amount} credits (advisor: ${advisor?.cd_advice?.reasoning || "default"})`,
    };
  }

  if (actionType === "claim_chest") {
    if (status.daily_chest_available) {
      return {
        action: "claim_chest",
        params: {},
        reasoning: "Claiming daily chest",
      };
    }
    // Already claimed today, do something else
    return {
      action: "post",
      params: {},
      reasoning: "Daily chest already claimed today",
    };
  }

  if (actionType === "dm_send") {
    // Get conversations to find someone to DM
    const convos = await spitrApi.getConversations(bot.user_id);
    let targetUserId: string | null = null;
    let targetHandle = "someone";

    if (convos.length > 0) {
      // Reply to most recent conversation
      const convo = convos[0];
      targetUserId = convo.other_user_id;
      targetHandle = convo.other_handle;
    } else {
      // No DM conversations yet — pick someone from feed
      const feedTargets = feed.filter((f) => f.user_id !== bot.user_id && !f.destroyed);
      if (feedTargets.length > 0) {
        const t = feedTargets[Math.floor(Math.random() * feedTargets.length)];
        targetUserId = t.user_id;
        targetHandle = t.handle;
      }
    }

    if (!targetUserId) {
      return {
        action: "post",
        params: {},
        reasoning: "No DM targets available",
      };
    }

    // Generate DM content via Ollama
    const contentPrompt = buildContentPrompt(bot, "dm_send", {
      replyTo: `Direct message to @${targetHandle}`,
    });
    let content = await ollama.generate(contentPrompt, { temperature: 0.8 });
    content = content.trim().replace(/^["']|["']$/g, "");
    if (content.length > 2000) content = trimContent(content, 2000);

    return {
      action: "dm_send",
      params: { target_user_id: targetUserId, content },
      reasoning: `DMing @${targetHandle}`,
    };
  }

  // Final fallback: use Ollama to decide (should rarely reach here)
  const targets = feed
    .filter((f) => f.user_id !== bot.user_id && !f.destroyed)
    .map((f) => ({ id: f.user_id, handle: f.handle, hp: f.hp || 0, max_hp: f.max_hp || 5000, level: f.level || 1 }))
    .filter((t, i, arr) => arr.findIndex((a) => a.id === t.id) === i);
  const prompt = buildActionDecisionPrompt(bot, status, feed, targets);
  return ollama.generateJSON<PlannedAction>(prompt);
}
