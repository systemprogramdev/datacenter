import type { BotStatus, FeedItem } from "./types";
/* eslint-disable @typescript-eslint/no-explicit-any */

const SPITR_API_URL = process.env.SPITR_API_URL || "https://spitr.wtf";
const DATACENTER_API_KEY = process.env.DATACENTER_API_KEY || "";

class SpitrApiClient {
  private baseUrl: string;
  private apiKey: string;
  private dryRun: boolean;

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
        inventory: [],
      };
    }
    const raw = await this.request<Record<string, unknown>>("/status", botId);
    // Normalize spitr response to our BotStatus shape
    const bankDeposits = Array.isArray(raw.bank_deposits) ? raw.bank_deposits : [];
    const bankBalance = bankDeposits.reduce((sum: number, d: Record<string, unknown>) => sum + ((Number(d.principal) || 0) - (Number(d.withdrawn) || 0)), 0);
    return {
      hp: Number(raw.hp) || 0,
      max_hp: Number(raw.max_hp) || 5000,
      credits: Number(raw.credits) || 0,
      gold: Number(raw.gold) || 0,
      bank_balance: Number(raw.bank_balance) || bankBalance,
      level: Number(raw.level) || 1,
      inventory: Array.isArray(raw.inventory) ? raw.inventory as BotStatus["inventory"] : [],
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

  async useItem(botId: string, itemId: string) {
    return this.request("/use-item", botId, {
      method: "POST",
      body: { item_id: itemId },
    });
  }

  async bankDeposit(botId: string, amount: number) {
    return this.request("/bank/deposit", botId, {
      method: "POST",
      body: { amount },
    });
  }

  async bankWithdraw(botId: string, amount: number) {
    return this.request("/bank/withdraw", botId, {
      method: "POST",
      body: { amount },
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
      body: action === "buy" ? { action, amount } : { action, shares: amount },
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

  async bankCd(botId: string, action: "buy" | "redeem", opts: { amount?: number; term?: number; cdId?: string }) {
    if (action === "buy") {
      return this.request("/bank/cd", botId, {
        method: "POST",
        body: { action: "buy", amount: opts.amount, term: opts.term },
      });
    }
    return this.request("/bank/cd", botId, {
      method: "POST",
      body: { action: "redeem", cd_id: opts.cdId },
    });
  }
}

export const spitrApi = new SpitrApiClient();
