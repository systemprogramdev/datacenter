"use client";

import { create } from "zustand";
import type { SybilServerWithStats, SybilServer, SybilBot, SybilJob } from "@/lib/types";

interface SybilServerDetail {
  server: SybilServer;
  sybils: SybilBot[];
  recent_jobs: SybilJob[];
  stats: {
    total: number;
    alive: number;
    deployed: number;
    dead: number;
    pending_deploy: number;
  };
  job_stats: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
  };
}

interface PoolStats {
  total: number;
  available: number;
  claimed: number;
}

interface SybilStore {
  servers: SybilServerWithStats[];
  selectedServer: SybilServerDetail | null;
  poolStats: PoolStats | null;
  loading: boolean;
  error: string | null;
  fetchServers: () => Promise<void>;
  fetchServer: (id: string) => Promise<void>;
  fetchPoolStats: () => Promise<void>;
  createServer: (ownerUserId: string) => Promise<boolean>;
  suspendServer: (id: string) => Promise<void>;
  activateServer: (id: string) => Promise<void>;
}

export const useSybilStore = create<SybilStore>((set, get) => ({
  servers: [],
  selectedServer: null,
  poolStats: null,
  loading: false,
  error: null,

  fetchServers: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/sybil");
      const data = await res.json();
      if (data.success) {
        set({ servers: data.data, loading: false });
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchPoolStats: async () => {
    try {
      const res = await fetch("/api/sybil/pool");
      const data = await res.json();
      if (data.success) {
        set({ poolStats: data.data });
      }
    } catch {
      // Non-critical, silently ignore
    }
  },

  fetchServer: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/sybil/${id}`);
      const data = await res.json();
      if (data.success) {
        set({ selectedServer: data.data, loading: false });
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  createServer: async (ownerUserId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/sybil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_user_id: ownerUserId }),
      });
      const data = await res.json();
      if (data.success) {
        await get().fetchServers();
        set({ loading: false });
        return true;
      } else {
        set({ error: data.error, loading: false });
        return false;
      }
    } catch (error) {
      set({ error: String(error), loading: false });
      return false;
    }
  },

  suspendServer: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/sybil/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        set({ selectedServer: null, loading: false });
        await get().fetchServers();
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  activateServer: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/sybil/${id}`, { method: "PATCH" });
      const data = await res.json();
      if (data.success) {
        await get().fetchServer(id);
        set({ loading: false });
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
}));
