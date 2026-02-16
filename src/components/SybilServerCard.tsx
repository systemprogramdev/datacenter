"use client";

import Link from "next/link";
import type { SybilServerWithStats } from "@/lib/types";

interface SybilServerCardProps {
  server: SybilServerWithStats;
}

const statusColors: Record<string, string> = {
  active: "var(--sys-success)",
  provisioning: "var(--sys-warning)",
  suspended: "var(--sys-danger)",
};

export default function SybilServerCard({ server }: SybilServerCardProps) {
  return (
    <Link href={`/sybil/${server.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card" style={{ cursor: "pointer", transition: "border-color 0.2s" }}>
        <div className="card-header">
          <div className="flex items-center justify-between" style={{ width: "100%" }}>
            <div className="flex items-center gap-2">
              <div className="pulse-dot" style={{ background: statusColors[server.status] || "var(--sys-text-muted)" }} />
              <span className="font-bold text-sm">SERVER</span>
            </div>
            <span className={`badge ${server.status === "active" ? "badge-success" : server.status === "provisioning" ? "badge-warning" : "badge-danger"} badge-pill dc-badge-sm`}>
              {server.status.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="card-body" style={{ padding: "0.6rem 0.75rem" }}>
          <div className="text-xs text-secondary" style={{ marginBottom: "0.35rem" }}>
            <span className="sys-icon sys-icon-user sys-icon-sm" /> Owner: {server.owner_user_id.slice(0, 8)}...
          </div>

          <div className="flex flex-wrap gap-1" style={{ marginBottom: "0.35rem" }}>
            <span className="badge badge-info badge-pill dc-badge-sm">
              {server.alive_count}/{server.max_sybils} alive
            </span>
            <span className="badge badge-outline badge-pill dc-badge-sm">
              {server.deployed_count} deployed
            </span>
            <span className="badge badge-outline badge-pill dc-badge-sm">
              {server.total_count} total
            </span>
          </div>

          <div className="text-muted" style={{ fontSize: "0.6rem" }}>
            Created {new Date(server.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>
    </Link>
  );
}
