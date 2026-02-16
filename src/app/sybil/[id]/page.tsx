"use client";

import { use, useCallback } from "react";
import { useSybilStore } from "@/stores/sybilStore";
import { usePolling } from "@/lib/usePolling";
import SybilBotTable from "@/components/SybilBotTable";
import SybilJobTable from "@/components/SybilJobTable";

export default function SybilServerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { selectedServer, loading, fetchServer, suspendServer, activateServer } = useSybilStore();

  const poll = useCallback(() => fetchServer(id), [fetchServer, id]);
  usePolling(poll, 15000);

  if (loading && !selectedServer) {
    return (
      <div className="text-center text-muted p-5">
        <div className="loader-cyber" style={{ margin: "0 auto 0.75rem" }} />
        Loading server...
      </div>
    );
  }

  if (!selectedServer) {
    return <div className="text-center text-muted p-5">Server not found</div>;
  }

  const { server, sybils, recent_jobs, stats, job_stats } = selectedServer;

  const statusColors: Record<string, string> = {
    active: "var(--sys-success)",
    provisioning: "var(--sys-warning)",
    suspended: "var(--sys-danger)",
  };

  const statItems = [
    { label: "ALIVE", value: stats.alive, color: "var(--sys-success)" },
    { label: "DEAD", value: stats.dead, color: "var(--sys-danger)" },
    { label: "DEPLOYED", value: stats.deployed, color: "var(--sys-accent)" },
    { label: "PENDING DEPLOY", value: stats.pending_deploy, color: "var(--sys-warning)" },
    { label: "JOBS COMPLETED", value: job_stats.completed, color: "var(--sys-success)" },
    { label: "JOBS FAILED", value: job_stats.failed, color: "var(--sys-danger)" },
  ];

  return (
    <div className="dc-page">
      <div className="dc-page-header">
        <div>
          <h1 className="text-glow dc-page-title">
            <span className="sys-icon sys-icon-users sys-icon-lg" />{" "}
            <span className="pulse-dot-lg" style={{ background: statusColors[server.status], display: "inline-block", verticalAlign: "middle" }} />{" "}
            SYBIL SERVER
          </h1>
          <p className="dc-page-subtitle">
            Owner: {server.owner_user_id.slice(0, 12)}... &middot; Created {new Date(server.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${server.status === "active" ? "badge-success" : server.status === "provisioning" ? "badge-warning" : "badge-danger"} badge-pill`}>
            {server.status.toUpperCase()}
          </span>
          {(server.status === "provisioning" || server.status === "suspended") && (
            <button
              onClick={() => activateServer(server.id)}
              className="btn btn-sm btn-success"
              disabled={loading}
            >
              <span className="sys-icon sys-icon-check sys-icon-sm" /> ACTIVATE
            </button>
          )}
          {server.status !== "suspended" && (
            <button
              onClick={() => suspendServer(server.id)}
              className="btn btn-sm btn-outline-danger"
            >
              <span className="sys-icon sys-icon-x sys-icon-sm" /> SUSPEND
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "0.4rem" }}>
        {statItems.map((item) => (
          <div key={item.label} className="panel">
            <div className="stat-label">{item.label}</div>
            <div className="stat-value" style={{ color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div className="grid-2col">
        <SybilBotTable sybils={sybils} />
        <SybilJobTable jobs={recent_jobs} sybils={sybils} />
      </div>
    </div>
  );
}
