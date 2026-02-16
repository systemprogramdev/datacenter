"use client";

import { useState, useCallback } from "react";
import { usePolling } from "@/lib/usePolling";
import type { BotJob } from "@/lib/types";

interface ActionLogProps {
  botId?: string;
  limit?: number;
}

export default function ActionLog({ botId, limit = 50 }: ActionLogProps) {
  const [logs, setLogs] = useState<(BotJob & { bot?: { name: string; handle: string } })[]>([]);

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (botId) params.set("bot_id", botId);
    params.set("limit", String(limit));

    try {
      const res = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      if (data.success) setLogs(data.data);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    }
  }, [botId, limit]);

  usePolling(fetchLogs, 15000);

  return (
    <div className="panel-console">
      <div className="dc-panel-header-bar">
        <span className="dc-panel-title">
          <span className="sys-icon sys-icon-file sys-icon-sm" /> ACTION LOG
        </span>
        <span className="text-xs text-muted">{logs.length} entries</span>
      </div>
      <div className="panel-console-body" style={{ maxHeight: "500px", overflowY: "auto" }}>
        {logs.length === 0 ? (
          <div className="text-center text-muted p-4 text-xs">No logs yet</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="log-entry">
              <span className="text-muted">
                {log.completed_at ? new Date(log.completed_at).toLocaleTimeString() : "??:??"}
              </span>
              <span style={{ color: log.status === "completed" ? "var(--sys-success)" : "var(--sys-danger)" }}>
                [{log.status.toUpperCase()}]
              </span>
              {(log as unknown as Record<string, unknown>)._source === "sybil" && (
                <span style={{ color: "var(--sys-warning)", fontSize: "0.6rem" }}>[SYBIL]</span>
              )}
              <span className="text-secondary">{log.bot?.name || log.bot_id.slice(0, 8)}</span>
              <span style={{ color: "var(--sys-accent)" }}>{log.action_type}</span>
              {log.error && (
                <span style={{ color: "var(--sys-danger)" }}>Error: {log.error}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
