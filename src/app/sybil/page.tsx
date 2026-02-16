"use client";

import { useState } from "react";
import { useSybilStore } from "@/stores/sybilStore";
import { usePolling } from "@/lib/usePolling";
import SybilServerCard from "@/components/SybilServerCard";

export default function SybilPage() {
  const { servers, loading, error, poolStats, fetchServers, fetchPoolStats, createServer } = useSybilStore();
  const [showCreate, setShowCreate] = useState(false);
  const [ownerUserId, setOwnerUserId] = useState("");

  usePolling(fetchServers, 30000);
  usePolling(fetchPoolStats, 30000);

  const handleCreate = async () => {
    if (!ownerUserId) return;
    const ok = await createServer(ownerUserId);
    if (ok) {
      setShowCreate(false);
      setOwnerUserId("");
    }
  };

  const activeServers = servers.filter((s) => s.status === "active").length;
  const totalSybils = servers.reduce((sum, s) => sum + s.total_count, 0);
  const aliveSybils = servers.reduce((sum, s) => sum + s.alive_count, 0);
  const deployedSybils = servers.reduce((sum, s) => sum + s.deployed_count, 0);

  const statItems = [
    { label: "SERVERS", value: servers.length, color: "var(--sys-info)" },
    { label: "ACTIVE", value: activeServers, color: "var(--sys-success)" },
    { label: "TOTAL SYBILS", value: totalSybils, color: "var(--sys-accent)" },
    { label: "ALIVE", value: aliveSybils, color: "var(--sys-success)" },
    { label: "DEPLOYED", value: deployedSybils, color: "var(--sys-warning)" },
    { label: "NAME POOL", value: poolStats?.available ?? "—", color: (poolStats?.available ?? 0) < 10 ? "var(--sys-danger)" : "var(--sys-success)" },
  ];

  return (
    <div className="dc-page">
      <div className="dc-page-header">
        <div>
          <h1 className="text-glow dc-page-title">
            <span className="sys-icon sys-icon-users sys-icon-lg" /> SYBIL SERVERS
          </h1>
          <p className="dc-page-subtitle">{servers.length} servers registered</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className={`btn btn-sm ${showCreate ? "btn-outline-danger" : "btn-success"}`}>
          <span className={`sys-icon ${showCreate ? "sys-icon-x" : "sys-icon-plus"} sys-icon-sm`} />
          {showCreate ? "CANCEL" : "NEW SERVER"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "0.4rem" }}>
        {statItems.map((item) => (
          <div key={item.label} className="panel">
            <div className="stat-label">{item.label}</div>
            <div className="stat-value" style={{ color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="panel-glow">
          <div className="dc-panel-body">
            <h3 className="dc-panel-title" style={{ color: "var(--sys-primary)" }}>
              <span className="sys-icon sys-icon-plus sys-icon-sm" /> CREATE SYBIL SERVER
            </h3>
            <div className="input-group">
              <label className="input-label">Owner User ID</label>
              <input
                className="input"
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                placeholder="UUID of the server owner"
              />
            </div>
            {error && <div className="text-xs" style={{ color: "var(--sys-danger)" }}>{error}</div>}
            <div className="dc-form-footer">
              <button
                onClick={handleCreate}
                disabled={!ownerUserId || loading}
                className="btn btn-success btn-sm"
                style={{ opacity: !ownerUserId || loading ? 0.3 : 1 }}
              >
                <span className="sys-icon sys-icon-check sys-icon-sm" /> CREATE
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && servers.length === 0 ? (
        <div className="text-center text-muted p-5">
          <div className="loader-cyber" style={{ margin: "0 auto 0.75rem" }} />
          Loading servers...
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center p-5">
          <div className="text-muted text-sm">No sybil servers</div>
          <div className="dc-page-subtitle">Create a server to get started</div>
        </div>
      ) : (
        <div className="grid-bots">
          {servers.map((server) => (
            <SybilServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
