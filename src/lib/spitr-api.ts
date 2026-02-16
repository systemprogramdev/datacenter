import type { BotStatus, FeedItem, DMConversation, DMMessage, BotNotification, UserLookup, MarketData, ConsolidateResult, FinancialAdvisor, RedeemableCD, FinancialStrategy, CDAdvice, ConversionAdvice, ConsolidationAdvice } from "./types";
/* eslint-disable @typescript-eslint/no-explicit-any */

const SPITR_API_URL = process.env.SPITR_API_URL || "https://spitr.wtf";
const DATACENTER_API_KEY = process.env.DATACENTER_API_KEY || "";

const MARKET_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const DEFAULT_MARKET: MarketData = {
  current_rate: 1.0,
  current_rate_percent: 100,
  rate_trend: "stable",
  signal: "hold",
  stock_price: 100,
  stock_trend: "stable",
  rate_position: 0.5,
  stock_signal: "hold",
};

function parseFinancialAdvisor(raw: Record<string, unknown>): FinancialAdvisor {
  const priorityQueue = Array.isArray(raw.priority_queue)
    ? (raw.priority_queue as Record<string, unknown>[]).map((s): FinancialStrategy => ({
        action: String(s.action || "hold"),
        params: (s.params as Record<string, unknown>) || {},
        reasoning: String(s.reasoning || ""),
        priority: Number(s.priority) || 0,
      }))
    : [];

  const redeemableCds = Array.isArray(raw.redeemable_cds)
    ? (raw.redeemable_cds as Record<string, unknown>[]).map((cd): RedeemableCD => ({
        cd_id: String(cd.cd_id || cd.id || ""),
        amount: Number(cd.amount) || 0,
        currency: (cd.currency as "spit" | "gold") || "spit",
        matured: Boolean(cd.matured),
        rate: Number(cd.rate) || 0,
        matures_at: String(cd.matures_at || ""),
      }))
    : [];

  const rawCd = (raw.cd_advice as Record<string, unknown>) || {};
  const cdAdvice: CDAdvice = {
    recommended_currency: (rawCd.recommended_currency as "spit" | "gold") || "spit",
    recommended_term_days: Number(rawCd.recommended_term_days) || 7,
    current_spit_rate: Number(rawCd.current_spit_rate) || 0,
    current_gold_rate: Number(rawCd.current_gold_rate) || 0,
    reasoning: String(rawCd.reasoning || ""),
  };

  let conversionAdvice: ConversionAdvice | null = null;
  if (raw.conversion_advice) {
    const rawConv = raw.conversion_advice as Record<string, unknown>;
    conversionAdvice = {
      direction: (rawConv.direction as "spits_to_gold" | "gold_to_spits") || "spits_to_gold",
      amount: Number(rawConv.amount) || 0,
      reasoning: String(rawConv.reasoning || ""),
    };
  }

  const rawConsol = (raw.consolidation as Record<string, unknown>) || {};
  const consolidation: ConsolidationAdvice = {
    ready: Boolean(rawConsol.ready),
    spit_surplus: Number(rawConsol.spit_surplus) || 0,
    gold_surplus: Number(rawConsol.gold_surplus) || 0,
  };

  return { priority_queue: priorityQueue, redeemable_cds: redeemableCds, cd_advice: cdAdvice, conversion_advice: conversionAdvice, consolidation };
}

class SpitrApiClient {
  private baseUrl: string;
  private apiKey: string;
  private dryRun: boolean;
  private marketCache: { data: MarketData; fetchedAt: number } | null = null;

  constructor() {
    this.baseUrl = SPITR_API_URL;
    this.apiKey = DATACENTER_API_KEY;
    this.dryRun = !DATACENTER_API_KEY || DATACENTER_API_KEY === "your-datacenter-api-key";
  }

  private async request<T = unknown>(
    path: string,
    botId: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    if (this.dryRun) {
      console.log(`[DRY RUN] ${options.method || "GET"} ${path}`, {
        botId,
        body: options.body,
      });
      return { success: true, dry_run: true } as T;
    }

    const url = `${this.baseUrl}/api/bot${path}`;
    console.log(`[SpitrAPI] ${options.method || "GET"} ${url} (bot: ${botId.slice(0, 8)}...)`);
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Datacenter-Key": this.apiKey,
        "X-Bot-Id": botId,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spitr API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  private async requestPublic<T = unknown>(path: string): Promise<T> {
    if (this.dryRun) {
      console.log(`[DRY RUN] GET ${path} (public)`);
      return {} as T;
    }

    const url = `${this.baseUrl}/api/bot${path}`;
    console.log(`[SpitrAPI] GET ${url} (public)`);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Datacenter-Key": this.apiKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spitr API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  isDryRun(): boolean {
    return this.dryRun;
  }

  // --- Status ---

  async getStatus(botId: string): Promise<BotStatus> {
    if (this.dryRun) {
      return {
        hp: 5000,
        max_hp: 5000,
        credits: 1000,
        gold: 50,
        bank_balance: 500,
        level: 1,
        xp: 0,
        xp_next_level: 100,
        destroyed: false,
        daily_chest_available: true,
        weekly_paycheck_available: false,
        has_firewall: false,
        kevlar_charges: 0,
        stocks_owned: 0,
        active_cds: [],
        inventory: [],
      };
    }
    const raw = await this.request<Record<string, unknown>>("/status", botId);
    // Fallback bank balance calculation from deposits if bank_balance not provided
    const bankDeposits = Array.isArray(raw.bank_deposits) ? raw.bank_deposits : [];
    const bankBalanceFallback = bankDeposits.reduce((sum: number, d: Record<string, unknown>) => sum + ((Number(d.principal) || 0) - (Number(d.withdrawn) || 0)), 0);
    return {
      hp: Number(raw.hp) || 0,
      max_hp: Number(raw.max_hp) || 5000,
      credits: Number(raw.credits) || 0,
      gold: Number(raw.gold) || 0,
      bank_balance: Number(raw.bank_balance) || bankBalanceFallback,
      level: Number(raw.level) || 1,
      xp: Number(raw.xp) || 0,
      xp_next_level: Number(raw.xp_next_level) || 100,
      destroyed: Boolean(raw.destroyed),
      daily_chest_available: Boolean(raw.daily_chest_available),
      weekly_paycheck_available: Boolean(raw.weekly_paycheck_available),
      has_firewall: Boolean(raw.has_firewall),
      kevlar_charges: Number(raw.kevlar_charges) || 0,
      stocks_owned: Number(raw.stocks_owned) || 0,
      active_cds: Array.isArray(raw.active_cds) ? (raw.active_cds as Record<string, unknown>[]).map(cd => ({
        id: String(cd.id),
        amount: Number(cd.amount) || 0,
        term: Number(cd.term) || 7,
        matures_at: String(cd.matures_at || ""),
        currency: (cd.currency as "spit" | "gold") || "spit",
        rate: Number(cd.rate) || 0,
      })) : [],
      inventory: Array.isArray(raw.inventory) ? raw.inventory as BotStatus["inventory"] : [],
      market: raw.market ? {
        current_rate: Number((raw.market as Record<string, unknown>).current_rate) || 1.0,
        current_rate_percent: Number((raw.market as Record<string, unknown>).current_rate_percent) || 100,
        rate_trend: ((raw.market as Record<string, unknown>).rate_trend as MarketData["rate_trend"]) || "stable",
        signal: ((raw.market as Record<string, unknown>).signal as MarketData["signal"]) || "hold",
        stock_price: Number((raw.market as Record<string, unknown>).stock_price) || 100,
        stock_trend: ((raw.market as Record<string, unknown>).stock_trend as MarketData["stock_trend"]) || "stable",
        rate_position: Number((raw.market as Record<string, unknown>).rate_position) || 0.5,
        stock_signal: ((raw.market as Record<string, unknown>).stock_signal as MarketData["stock_signal"]) || "hold",
      } as MarketData : undefined,
      deposits_over_24h: Array.isArray(raw.deposits_over_24h) ? (raw.deposits_over_24h as Record<string, unknown>[]).map(d => ({
        id: String(d.id),
        principal: Number(d.principal) || 0,
        withdrawn: Number(d.withdrawn) || 0,
        accrued_interest: Number(d.accrued_interest) || 0,
        current_value: Number(d.current_value) || 0,
      })) : undefined,
      suggested_action: raw.suggested_action ? String(raw.suggested_action) : undefined,
      financial_advisor: raw.financial_advisor ? parseFinancialAdvisor(raw.financial_advisor as Record<string, unknown>) : undefined,
    };
  }

  async getFeed(botId: string, limit = 5): Promise<FeedItem[]> {
    if (this.dryRun) {
      return [
        {
          id: "mock-1",
          user_id: "mock-user",
          handle: "testuser",
          content: "This is a mock feed item for dry run mode",
          created_at: new Date().toISOString(),
          likes: 3,
          respits: 1,
          hp: 5000,
          max_hp: 5000,
          level: 1,
          destroyed: false,
        },
      ];
    }
    const raw = await this.request<Record<string, unknown>>(`/feed?limit=${limit}`, botId);
    // Spitr returns {spits: [...]} - unwrap it
    const spits = Array.isArray(raw) ? raw : Array.isArray(raw.spits) ? raw.spits : [];
    return spits.map((s: Record<string, unknown>) => ({
      id: String(s.id),
      user_id: String(s.user_id),
      handle: String((s.users as Record<string, unknown>)?.handle || s.handle || "unknown"),
      content: String(s.content || ""),
      created_at: String(s.created_at),
      likes: Number(s.likes) || 0,
      respits: Number(s.respits) || 0,
      hp: Number(s.hp) || 0,
      max_hp: Number(s.max_hp) || 5000,
      level: Number(s.level) || 1,
      destroyed: Boolean(s.destroyed),
    }));
  }

  // --- Actions ---

  async post(botId: string, content: string) {
    return this.request("/post", botId, {
      method: "POST",
      body: { content },
    });
  }

  async reply(botId: string, spitId: string, content: string) {
    return this.request("/reply", botId, {
      method: "POST",
      body: { reply_to_id: spitId, content },
    });
  }

  async like(botId: string, spitId: string) {
    return this.request("/like", botId, {
      method: "POST",
      body: { spit_id: spitId },
    });
  }

  async respit(botId: string, spitId: string) {
    return this.request("/respit", botId, {
      method: "POST",
      body: { spit_id: spitId },
    });
  }

  async attack(botId: string, targetId: string) {
    return this.request("/attack", botId, {
      method: "POST",
      body: { target_user_id: targetId },
    });
  }

  async useItem(botId: string, itemType: string) {
    return this.request("/use-item", botId, {
      method: "POST",
      body: { itemType },
    });
  }

  async bankDeposit(botId: string, amount: number) {
    return this.request("/bank/deposit", botId, {
      method: "POST",
      body: { amount },
    });
  }

  async bankWithdraw(botId: string, amount: number, currency: "spit" | "gold" = "spit") {
    return this.request("/bank/withdraw", botId, {
      method: "POST",
      body: { amount, currency },
    });
  }

  async buyItem(botId: string, itemType: string) {
    return this.request("/buy-item", botId, {
      method: "POST",
      body: { itemType },
    });
  }

  async openChest(botId: string) {
    return this.request("/chest", botId, {
      method: "POST",
      body: {},
    });
  }

  async follow(botId: string, targetId: string) {
    return this.request("/follow", botId, {
      method: "POST",
      body: { target_user_id: targetId },
    });
  }

  async transfer(botId: string, targetId: string, amount: number) {
    return this.request("/transfer", botId, {
      method: "POST",
      body: { target_user_id: targetId, amount },
    });
  }

  // --- Bank Extended ---

  async bankConvert(botId: string, direction: "spits_to_gold" | "gold_to_spits", amount: number) {
    return this.request("/bank/convert", botId, {
      method: "POST",
      body: { direction, amount },
    });
  }

  async bankStock(botId: string, action: "buy" | "sell", amount: number) {
    return this.request("/bank/stock", botId, {
      method: "POST",
      body: action === "buy" ? { action, spit_amount: amount } : { action, shares: amount },
    });
  }

  async bankLottery(botId: string, ticketType: string) {
    return this.request("/bank/lottery", botId, {
      method: "POST",
      body: { ticket_type: ticketType },
    });
  }

  async bankScratch(botId: string, ticketId: string) {
    return this.request("/bank/scratch", botId, {
      method: "POST",
      body: { ticket_id: ticketId },
    });
  }

  async bankCd(botId: string, action: "buy" | "redeem", opts: { amount?: number; termDays?: number; currency?: "spit" | "gold"; cdId?: string }) {
    if (action === "buy") {
      return this.request("/bank/cd", botId, {
        method: "POST",
        body: { action: "buy", amount: opts.amount, term_days: opts.termDays || 7, currency: opts.currency || "spit" },
      });
    }
    return this.request("/bank/cd/redeem", botId, {
      method: "POST",
      body: { cd_id: opts.cdId },
    });
  }

  // --- Market Intelligence & Financial Advisor ---

  async getMarket(): Promise<MarketData> {
    // Return cached data if fresh enough
    if (this.marketCache && Date.now() - this.marketCache.fetchedAt < MARKET_CACHE_TTL) {
      return this.marketCache.data;
    }

    if (this.dryRun) {
      return DEFAULT_MARKET;
    }

    try {
      const raw = await this.requestPublic<Record<string, unknown>>("/market");
      const data: MarketData = {
        current_rate: Number(raw.current_rate) || 1.0,
        current_rate_percent: Number(raw.current_rate_percent) || 100,
        rate_trend: (raw.rate_trend as MarketData["rate_trend"]) || "stable",
        signal: (raw.signal as MarketData["signal"]) || "hold",
        stock_price: Number(raw.stock_price) || 100,
        stock_trend: (raw.stock_trend as MarketData["stock_trend"]) || "stable",
        rate_position: Number(raw.rate_position) || 0.5,
        stock_signal: (raw.stock_signal as MarketData["stock_signal"]) || "hold",
        time_to_peak_hours: raw.time_to_peak_hours != null ? Number(raw.time_to_peak_hours) : undefined,
        time_to_trough_hours: raw.time_to_trough_hours != null ? Number(raw.time_to_trough_hours) : undefined,
      };
      this.marketCache = { data, fetchedAt: Date.now() };
      return data;
    } catch (err) {
      console.error("[SpitrAPI] Market fetch failed, using cached/default:", err);
      return this.marketCache?.data || DEFAULT_MARKET;
    }
  }

  // --- Consolidation ---

  async consolidate(botId: string, opts: { spit_reserve?: number; gold_reserve?: number } = {}): Promise<ConsolidateResult> {
    if (this.dryRun) {
      return { spits_sent: 0, gold_sent: 0, limits: { spits_remaining: 0, gold_remaining: 0 }, bot_wealth: { credits: 0, gold: 0, bank_balance: 0 } };
    }
    const raw = await this.request<Record<string, unknown>>("/consolidate", botId, {
      method: "POST",
      body: opts,
    });
    return {
      spits_sent: Number(raw.spits_sent) || 0,
      gold_sent: Number(raw.gold_sent) || 0,
      limits: {
        spits_remaining: Number((raw.limits as Record<string, unknown>)?.spits_remaining) || 0,
        gold_remaining: Number((raw.limits as Record<string, unknown>)?.gold_remaining) || 0,
      },
      bot_wealth: {
        credits: Number((raw.bot_wealth as Record<string, unknown>)?.credits) || 0,
        gold: Number((raw.bot_wealth as Record<string, unknown>)?.gold) || 0,
        bank_balance: Number((raw.bot_wealth as Record<string, unknown>)?.bank_balance) || 0,
      },
    };
  }

  // --- DMs ---

  async getConversations(botId: string): Promise<DMConversation[]> {
    if (this.dryRun) return [];
    const raw = await this.request<Record<string, unknown>>("/dm/conversations", botId);
    const convos = Array.isArray(raw) ? raw : Array.isArray((raw as any).conversations) ? (raw as any).conversations : [];
    return convos.map((c: Record<string, unknown>) => {
      // Spitr nests participant info and last_message as objects
      const participant = (c.participant || {}) as Record<string, unknown>;
      const lastMsg = (c.last_message || null) as Record<string, unknown> | null;
      return {
        conversation_id: String(c.conversation_id || c.id),
        other_user_id: String(participant.id || c.other_user_id || ""),
        other_handle: String(participant.handle || c.other_handle || "unknown"),
        other_name: String(participant.name || c.other_name || ""),
        last_message: lastMsg ? String(lastMsg.content || "") : null,
        last_message_at: lastMsg ? String(lastMsg.created_at || "") : null,
        unread: Boolean(c.unread),
      };
    });
  }

  async getMessages(botId: string, conversationId: string): Promise<DMMessage[]> {
    if (this.dryRun) return [];
    const raw = await this.request<Record<string, unknown>>(`/dm/messages?conversation_id=${conversationId}`, botId);
    const msgs = Array.isArray(raw) ? raw : Array.isArray((raw as any).messages) ? (raw as any).messages : [];
    return msgs.map((m: Record<string, unknown>) => ({
      id: String(m.id),
      sender_id: String(m.sender_id),
      content: String(m.content || ""),
      created_at: String(m.created_at),
    }));
  }

  async sendDM(botId: string, targetUserId: string, content: string) {
    return this.request("/dm/send", botId, {
      method: "POST",
      body: { target_user_id: targetUserId, content },
    });
  }

  // --- Notifications ---

  async getNotifications(botId: string): Promise<BotNotification[]> {
    if (this.dryRun) return [];
    const raw = await this.request<Record<string, unknown>>("/notifications", botId);
    const notifs = Array.isArray(raw) ? raw : Array.isArray((raw as any).notifications) ? (raw as any).notifications : [];
    return notifs.map((n: Record<string, unknown>) => ({
      id: String(n.id),
      type: String(n.type),
      actor_id: n.actor_id ? String(n.actor_id) : null,
      actor_handle: n.actor_handle ? String(n.actor_handle) : null,
      actor_name: n.actor_name ? String(n.actor_name) : null,
      spit_id: n.spit_id ? String(n.spit_id) : null,
      reference_id: n.reference_id ? String(n.reference_id) : null,
      read: Boolean(n.read),
      created_at: String(n.created_at),
    }));
  }

  // --- User Lookup ---

  async lookupUser(botId: string, handle: string): Promise<UserLookup | null> {
    if (this.dryRun) return null;
    try {
      const raw = await this.request<Record<string, unknown>>(`/user?handle=${encodeURIComponent(handle)}`, botId);
      return {
        id: String(raw.id),
        handle: String(raw.handle),
        name: String(raw.name || ""),
        hp: Number(raw.hp) || 0,
        max_hp: Number(raw.max_hp) || 5000,
        level: Number(raw.level) || 1,
        destroyed: Boolean(raw.destroyed),
        is_bot: Boolean(raw.is_bot),
      };
    } catch {
      return null;
    }
  }

  // --- Powerups & Utility ---

  async usePowerup(botId: string, itemType: string) {
    return this.request("/use-powerup", botId, {
      method: "POST",
      body: { itemType },
    });
  }

  async useSmokeBomb(botId: string) {
    return this.request("/use-smoke-bomb", botId, {
      method: "POST",
      body: {},
    });
  }

  async useFakeDeath(botId: string) {
    return this.request("/use-fake-death", botId, {
      method: "POST",
      body: {},
    });
  }

  async useNameTag(botId: string, targetUserId: string, customTitle: string) {
    return this.request("/use-name-tag", botId, {
      method: "POST",
      body: { targetUserId, customTitle },
    });
  }

  // --- Daily Chest ---

  async claimChest(botId: string) {
    return this.request("/claim-chest", botId, {
      method: "POST",
      body: {},
    });
  }

  // --- Sybil ---

  async createSybilAccount(
    ownerUserId: string,
    name: string,
    handle: string,
    avatarUrl: string | null,
    bannerUrl: string | null
  ): Promise<{ user_id: string }> {
    if (this.dryRun) {
      console.log(`[DRY RUN] createSybilAccount for owner ${ownerUserId}: ${name} (@${handle})`);
      return { user_id: `dry-sybil-${Date.now()}` };
    }

    const url = `${this.baseUrl}/api/bot/sybil/create`;
    console.log(`[SpitrAPI] POST ${url} (sybil create for owner: ${ownerUserId.slice(0, 8)}...)`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Datacenter-Key": this.apiKey,
      },
      body: JSON.stringify({
        owner_user_id: ownerUserId,
        name,
        handle,
        avatar_url: avatarUrl,
        banner_url: bannerUrl,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spitr sybil create error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return { user_id: String(data.user_id || data.id) };
  }

  async getUserSpits(userId: string, limit = 5): Promise<{ id: string; content: string; created_at: string }[]> {
    if (this.dryRun) {
      return [{ id: "mock-spit-1", content: "mock post for dry run", created_at: new Date().toISOString() }];
    }

    const url = `${this.baseUrl}/api/bot/user/spits?user_id=${encodeURIComponent(userId)}&limit=${limit}`;
    console.log(`[SpitrAPI] GET ${url}`);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Datacenter-Key": this.apiKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spitr user spits error ${res.status}: ${text}`);
    }

    const raw = await res.json();
    const spits = Array.isArray(raw) ? raw : Array.isArray(raw.spits) ? raw.spits : [];
    return spits.map((s: Record<string, unknown>) => ({
      id: String(s.id),
      content: String(s.content || ""),
      created_at: String(s.created_at),
    }));
  }

  async uploadSybilImage(
    imageBuffer: Uint8Array,
    filename: string,
    userId?: string,
    imageType?: "avatar" | "banner"
  ): Promise<string> {
    if (this.dryRun) {
      console.log(`[DRY RUN] uploadSybilImage: ${filename}`);
      return `https://example.com/dry-run/${filename}`;
    }

    const url = `${this.baseUrl}/api/bot/sybil/upload-image`;
    console.log(`[SpitrAPI] POST ${url} (upload: ${filename}, user: ${userId || "none"}, type: ${imageType || "none"})`);

    const formData = new FormData();
    const arrayBuf = imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength) as ArrayBuffer;
    formData.append("file", new File([arrayBuf], filename, { type: "image/png" }));
    if (userId) formData.append("user_id", userId);
    if (imageType) formData.append("type", imageType);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Datacenter-Key": this.apiKey,
      },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spitr image upload error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const imageUrl = data.url || data.image_url || "";
    if (!imageUrl) {
      throw new Error("Spitr upload-image returned no URL in response");
    }
    return String(imageUrl);
  }

  async updateSybilProfile(
    userId: string,
    updates: { avatar_url?: string; banner_url?: string }
  ): Promise<void> {
    if (this.dryRun) {
      console.log(`[DRY RUN] updateSybilProfile for ${userId}:`, updates);
      return;
    }

    const url = `${this.baseUrl}/api/bot/sybil/update-profile`;
    console.log(`[SpitrAPI] POST ${url} (update profile for user: ${userId.slice(0, 8)}...)`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Datacenter-Key": this.apiKey,
      },
      body: JSON.stringify({ user_id: userId, ...updates }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spitr sybil update-profile error ${res.status}: ${text}`);
    }
  }

  async purchaseSybilServer(ownerUserId: string): Promise<{ success: boolean }> {
    if (this.dryRun) {
      console.log(`[DRY RUN] purchaseSybilServer for ${ownerUserId}`);
      return { success: true };
    }

    const url = `${this.baseUrl}/api/bot/sybil/purchase`;
    console.log(`[SpitrAPI] POST ${url} (purchase for owner: ${ownerUserId.slice(0, 8)}...)`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Datacenter-Key": this.apiKey,
      },
      body: JSON.stringify({ owner_user_id: ownerUserId }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spitr sybil purchase error ${res.status}: ${text}`);
    }

    return { success: true };
  }
}

export const spitrApi = new SpitrApiClient();
