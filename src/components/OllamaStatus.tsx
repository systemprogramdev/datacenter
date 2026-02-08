"use client";

import { useState, useCallback } from "react";
import { usePolling } from "@/lib/usePolling";

interface OllamaInfo {
  connected: boolean;
  url: string;
  model: string;
  availableModels: { name: string; size: number }[];
}

export default function OllamaStatus() {
  const [info, setInfo] = useState<OllamaInfo | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama");
      const data = await res.json();
      if (data.success) setInfo(data.data);
    } catch {
      setInfo({ connected: false, url: "", model: "", availableModels: [] });
    }
  }, []);

  usePolling(check, 60000);

  if (!info) {
    return (
      <div className="panel">
        <div className="text-xs text-muted">
          <span className="sys-icon sys-icon-clock sys-icon-sm" /> Checking Ollama...
        </div>
      </div>
    );
  }

  return (
    <div className="panel-hud">
      <div className="dc-panel-body">
        <div className="flex items-center gap-2">
          <div className="pulse-dot" style={{ background: info.connected ? "var(--sys-success)" : "var(--sys-danger)" }} />
          <span className="dc-panel-title">OLLAMA {info.connected ? "ONLINE" : "OFFLINE"}</span>
          <span className={`badge dc-badge-sm ${info.connected ? "badge-success" : "badge-danger"}`}>
            {info.connected ? "CONNECTED" : "DISCONNECTED"}
          </span>
        </div>
        <div className="text-xs text-muted" style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          <div><span className="sys-icon sys-icon-globe sys-icon-sm" /> URL: {info.url}</div>
          <div><span className="sys-icon sys-icon-code sys-icon-sm" /> Model: {info.model}</div>
          {info.availableModels.length > 0 && (
            <div><span className="sys-icon sys-icon-folder sys-icon-sm" /> Available: {info.availableModels.map((m) => m.name).join(", ")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
