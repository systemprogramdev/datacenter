"use client";

import { create } from "zustand";
import type { BotWithConfig, BotJob } from "@/lib/types";

interface BotStore {
  bots: BotWithConfig[];
  selectedBot: BotWithConfig | null;
  botJobs: BotJob[];
  loading: boolean;
  error: string | null;
  fetchBots: () => Promise<void>;
  fetchBot: (id: string) => Promise<void>;
  fetchBotJobs: (botId: string) => Promise<void>;
  createBot: (data: Partial<BotWithConfig> & { owner_id: string; user_id: string; name: string; handle: string }) => Promise<BotWithConfig | null>;
  updateBot: (id: string, data: Record<string, unknown>) => Promise<void>;
  deleteBot: (id: string) => Promise<void>;
  triggerAction: (botId: string, action: string) => Promise<{ planned: unknown; job: unknown } | null>;
}

export const useBotStore = create<BotStore>((set, get) => ({
  bots: [],
  selectedBot: null,
  botJobs: [],
  loading: false,
  error: null,

  fetchBots: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/bots");
      const data = await res.json();
      if (data.success) {
        set({ bots: data.data, loading: false });
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchBot: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/bots/${id}`);
      const data = await res.json();
      if (data.success) {
        set({ selectedBot: data.data, loading: false });
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchBotJobs: async (botId) => {
    try {
      const res = await fetch(`/api/jobs?bot_id=${botId}&limit=20`);
      const data = await res.json();
      if (data.success) {
        set({ botJobs: data.data });
      }
    } catch (error) {
      console.error("Failed to fetch bot jobs:", error);
    }
  },

  createBot: async (botData) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(botData),
      });
      const data = await res.json();
      if (data.success) {
        await get().fetchBots();
        set({ loading: false });
        return data.data;
      } else {
        set({ error: data.error, loading: false });
        return null;
      }
    } catch (error) {
      set({ error: String(error), loading: false });
      return null;
    }
  },

  updateBot: async (id, updates) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/bots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        set({ selectedBot: data.data, loading: false });
        await get().fetchBots();
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  deleteBot: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/bots/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        set({ selectedBot: null, loading: false });
        await get().fetchBots();
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  triggerAction: async (botId, action) => {
    try {
      const res = await fetch(`/api/bots/${botId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        return data.data;
      }
      throw new Error(data.error);
    } catch (error) {
      console.error("Action trigger failed:", error);
      return null;
    }
  },
}));
