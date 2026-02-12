"use client";

import { create } from "zustand";
import type { DashboardStats, SchedulerState, SSEEvent } from "@/lib/types";

interface DashboardStore {
  stats: DashboardStats;
  schedulerState: SchedulerState;
  events: SSEEvent[];
  connected: boolean;
  setStats: (stats: DashboardStats) => void;
  setSchedulerState: (state: SchedulerState) => void;
  addEvent: (event: SSEEvent) => void;
  setConnected: (connected: boolean) => void;
  fetchStats: () => Promise<void>;
  fetchSchedulerState: () => Promise<void>;
  controlScheduler: (action: "start" | "stop" | "pause" | "resume") => Promise<void>;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  stats: {
    totalBots: 0,
    activeBots: 0,
    totalJobsToday: 0,
    completedJobsToday: 0,
    failedJobsToday: 0,
    pendingJobs: 0,
    schedulerRunning: false,
    ollamaConnected: false,
    totalTokens: 0,
  },
  schedulerState: {
    running: false,
    paused: false,
    lastTick: null,
    activeJobs: 0,
    totalProcessed: 0,
    errors: 0,
  },
  events: [],
  connected: false,

  setStats: (stats) => set({ stats }),
  setSchedulerState: (schedulerState) => set({ schedulerState }),
  setConnected: (connected) => set({ connected }),

  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, 200),
    })),

  fetchStats: async () => {
    try {
      const [statsRes, ollamaRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/ollama").catch(() => null),
      ]);
      const { data } = await statsRes.json();
      let totalTokens = get().stats.totalTokens;
      if (ollamaRes) {
        const ollamaData = await ollamaRes.json();
        totalTokens = ollamaData?.data?.tokenStats?.total_tokens || 0;
      }
      if (data) {
        set({
          stats: {
            ...data,
            schedulerRunning: get().schedulerState.running,
            ollamaConnected: get().stats.ollamaConnected,
            totalTokens,
          },
        });
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  },

  fetchSchedulerState: async () => {
    try {
      const res = await fetch("/api/scheduler");
      const data = await res.json();
      if (data.success) {
        set({ schedulerState: data.data });
      }
    } catch (error) {
      console.error("Failed to fetch scheduler state:", error);
    }
  },

  controlScheduler: async (action) => {
    try {
      const res = await fetch("/api/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        set({ schedulerState: data.data });
      }
    } catch (error) {
      console.error("Failed to control scheduler:", error);
    }
  },
}));
