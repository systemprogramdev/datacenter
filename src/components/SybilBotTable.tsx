"use client";

import type { SybilBot } from "@/lib/types";

interface SybilBotTableProps {
  sybils: SybilBot[];
}

export default function SybilBotTable({ sybils }: SybilBotTableProps) {
  return (
    <div className="panel-log">
      <div className="panel-log-header">
        <span className="panel-log-title">
          <span className="sys-icon sys-icon-user sys-icon-sm" /> SYBIL BOTS
        </span>
        <span className="text-muted text-xs">{sybils.length} total</span>
      </div>
      <div className="panel-log-body" style={{ maxHeight: "40rem", overflowY: "auto" }}>
        {sybils.length === 0 ? (
          <div className="text-center text-muted p-4 text-xs">No sybil bots</div>
        ) : (
          <table className="job-table">
            <thead>
              <tr>
                <th>NAME</th>
                <th>HANDLE</th>
                <th>HP</th>
                <th>STATUS</th>
                <th>DEPLOY</th>
                <th>DEPLOYED AT</th>
              </tr>
            </thead>
            <tbody>
              {sybils.map((bot) => (
                <tr key={bot.id}>
                  <td style={{ color: !bot.is_alive ? "var(--sys-danger)" : "inherit" }}>
                    {bot.name}
                  </td>
                  <td className="text-secondary">@{bot.handle}</td>
                  <td style={{ color: !bot.is_alive ? "var(--sys-danger)" : bot.hp < 1000 ? "var(--sys-warning)" : "var(--sys-success)" }}>
                    {bot.hp.toLocaleString()}/5,000
                  </td>
                  <td>
                    <span className={`badge ${bot.is_alive ? "badge-success" : "badge-danger"} badge-pill dc-badge-sm`}>
                      {bot.is_alive ? "ALIVE" : "DEAD"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${bot.is_deployed ? "badge-success" : bot.deploy_started_at ? "badge-warning" : "badge-outline"} badge-pill dc-badge-sm`}>
                      {bot.is_deployed ? "DEPLOYED" : bot.deploy_started_at ? "PENDING" : "WAITING"}
                    </span>
                  </td>
                  <td className="text-muted">
                    {bot.deployed_at ? new Date(bot.deployed_at).toLocaleString() : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
