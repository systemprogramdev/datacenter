"use client";

import { useState } from "react";
import type { SybilJob, SybilBot } from "@/lib/types";

interface SybilJobTableProps {
  jobs: SybilJob[];
  sybils: SybilBot[];
}

const statusBadge: Record<string, string> = {
  pending: "badge-warning",
  running: "badge-info",
  completed: "badge-success",
  failed: "badge-danger",
};

export default function SybilJobTable({ jobs, sybils }: SybilJobTableProps) {
  const [filter, setFilter] = useState("all");

  const sybilMap = new Map(sybils.map((s) => [s.id, s]));
  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  return (
    <div className="panel-log">
      <div className="panel-log-header">
        <span className="panel-log-title">
          <span className="sys-icon sys-icon-clock sys-icon-sm" /> SYBIL JOBS
        </span>
        <div className="dc-filter-bar">
          {["all", "pending", "completed", "failed"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`btn btn-xs ${filter === s ? "btn-primary" : "btn-ghost"}`}
              style={{ fontSize: "0.6rem" }}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-log-body" style={{ maxHeight: "40rem", overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div className="text-center text-muted p-4 text-xs">No jobs found</div>
        ) : (
          <table className="job-table">
            <thead>
              <tr>
                <th>SYBIL BOT</th>
                <th>ACTION</th>
                <th>STATUS</th>
                <th>SCHEDULED</th>
                <th>ERROR</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => {
                const bot = sybilMap.get(job.sybil_bot_id);
                return (
                  <tr key={job.id}>
                    <td className="text-secondary">{bot?.name || job.sybil_bot_id.slice(0, 8)}</td>
                    <td style={{ color: "var(--sys-accent)" }}>{job.action_type}</td>
                    <td>
                      <span className={`badge ${statusBadge[job.status]} badge-pill dc-badge-sm`}>
                        {job.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-muted">{new Date(job.scheduled_for).toLocaleTimeString()}</td>
                    <td className="text-muted" style={{ maxWidth: "10rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {job.error || "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
