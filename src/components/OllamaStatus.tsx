"use client";

import { useState, useCallback } from "react";
import { usePolling } from "@/lib/usePolling";

interface TokenStats {
  total_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_duration_ms: number;
  started_at: string;
}

interface OllamaInfo {
  connected: boolean;
  url: string;
  model: string;
  availableModels: { name: string; size: number }[];
  tokenStats?: TokenStats;
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
        {info.tokenStats && info.tokenStats.total_calls > 0 && (
          <div style={{ marginTop: "0.4rem", borderTop: "1px solid var(--border)", paddingTop: "0.4rem" }}>
            <div className="text-xs" style={{ color: "var(--sys-primary)", marginBottom: "0.2rem", fontWeight: 600 }}>TOKEN USAGE (since restart)</div>
            <div className="dc-info-grid" style={{ fontSize: "0.7rem" }}>
              <div><span className="text-muted">Calls:</span> <span style={{ color: "var(--sys-info)" }}>{info.tokenStats.total_calls.toLocaleString()}</span></div>
              <div><span className="text-muted">Total:</span> <span style={{ color: "var(--sys-warning)" }}>{info.tokenStats.total_tokens.toLocaleString()}</span></div>
              <div><span className="text-muted">Prompt:</span> <span className="text-secondary">{info.tokenStats.prompt_tokens.toLocaleString()}</span></div>
              <div><span className="text-muted">Output:</span> <span className="text-secondary">{info.tokenStats.completion_tokens.toLocaleString()}</span></div>
              <div><span className="text-muted">Avg/call:</span> <span className="text-secondary">{Math.round(info.tokenStats.total_tokens / info.tokenStats.total_calls).toLocaleString()}</span></div>
              <div><span className="text-muted">Time:</span> <span className="text-secondary">{(info.tokenStats.total_duration_ms / 1000).toFixed(1)}s</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
