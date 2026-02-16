"use client";

import { create } from "zustand";
import type {
  ImageServerStats,
  ImageServerHealth,
  ImageServerFile,
  ImageServerStyles,
  ImageServerAction,
} from "@/lib/types";

interface ServerData {
  online: boolean;
  health: ImageServerHealth | null;
  stats: ImageServerStats | null;
  recent_files: ImageServerFile[];
}

interface ImageStore {
  serverData: ServerData;
  styles: ImageServerStyles | null;
  generatedStyles: ImageServerStyles | null;
  generating: boolean;
  loading: boolean;
  actionLoading: ImageServerAction | null;
  error: string | null;
  fetchServerData: () => Promise<void>;
  fetchStyles: () => Promise<void>;
  updateStyles: (partial: Partial<ImageServerStyles>) => Promise<boolean>;
  executeAction: (action: ImageServerAction) => Promise<boolean>;
  generateNewStyles: () => Promise<boolean>;
  clearGeneratedStyles: () => void;
}

export const useImageStore = create<ImageStore>((set) => ({
  serverData: { online: false, health: null, stats: null, recent_files: [] },
  styles: null,
  generatedStyles: null,
  generating: false,
  loading: false,
  actionLoading: null,
  error: null,

  fetchServerData: async () => {
    try {
      const res = await fetch("/api/images");
      const json = await res.json();
      if (json.success) {
        set({ serverData: json.data });
      }
    } catch {
      set({ serverData: { online: false, health: null, stats: null, recent_files: [] } });
    }
  },

  fetchStyles: async () => {
    try {
      const res = await fetch("/api/images/styles");
      const json = await res.json();
      if (json.success) {
        set({ styles: json.data });
      }
    } catch {
      // Non-critical
    }
  },

  updateStyles: async (partial) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/images/styles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const json = await res.json();
      if (json.success) {
        // Refetch to get updated styles
        const stylesRes = await fetch("/api/images/styles");
        const stylesJson = await stylesRes.json();
        if (stylesJson.success) {
          set({ styles: stylesJson.data, loading: false });
        } else {
          set({ loading: false });
        }
        return true;
      } else {
        set({ error: json.error, loading: false });
        return false;
      }
    } catch (err) {
      set({ error: String(err), loading: false });
      return false;
    }
  },

  generateNewStyles: async () => {
    set({ generating: true, error: null, generatedStyles: null });
    try {
      const res = await fetch("/api/images/generate-styles", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        set({ generatedStyles: json.data, generating: false });
        return true;
      } else {
        set({ error: json.error, generating: false });
        return false;
      }
    } catch (err) {
      set({ error: String(err), generating: false });
      return false;
    }
  },

  clearGeneratedStyles: () => {
    set({ generatedStyles: null });
  },

  executeAction: async (action) => {
    set({ actionLoading: action, error: null });
    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      set({ actionLoading: null });
      if (!json.success) {
        set({ error: json.error });
        return false;
      }
      return true;
    } catch (err) {
      set({ actionLoading: null, error: String(err) });
      return false;
    }
  },
}));
