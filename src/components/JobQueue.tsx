"use client";

import { useState, useCallback } from "react";
import { usePolling } from "@/lib/usePolling";
import type { BotJob } from "@/lib/types";

interface JobQueueProps {
  botId?: string;
  limit?: number;
}

export default function JobQueue({ botId, limit = 20 }: JobQueueProps) {
  const [jobs, setJobs] = useState<(BotJob & { bot?: { name: string; handle: string } })[]>([]);
  const [filter, setFilter] = useState<string>("all");

  const fetchJobs = useCallback(async () => {
    const params = new URLSearchParams();
    if (botId) params.set("bot_id", botId);
    if (filter !== "all") params.set("status", filter);
    params.set("limit", String(limit));

    try {
      const res = await fetch(`/api/jobs?${params}`);
      const data = await res.json();
      if (data.success) setJobs(data.data);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  }, [botId, filter, limit]);

  usePolling(fetchJobs, 15000);

  const statusBadge: Record<string, string> = {
    pending: "badge-warning",
    running: "badge-info",
    completed: "badge-success",
    failed: "badge-danger",
  };

  return (
    <div className="panel-log">
      <div className="panel-log-header">
        <span className="panel-log-title">
          <span className="sys-icon sys-icon-clock sys-icon-sm" /> JOB QUEUE
        </span>
        <div className="dc-filter-bar">
          {["all", "pending", "running", "completed", "failed"].map((s) => (
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
      <div className="panel-log-body" style={{ maxHeight: "50rem", overflowY: "auto" }}>
        {jobs.length === 0 ? (
          <div className="text-center text-muted p-4 text-xs">No jobs found</div>
        ) : (
          <table className="job-table">
            <thead>
              <tr>
                <th>BOT</th>
                <th>ACTION</th>
                <th>STATUS</th>
                <th>SCHEDULED</th>
                <th>RESULT</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="text-secondary">
                    {(job as unknown as Record<string, unknown>)._source === "sybil" && (
                      <span style={{ color: "var(--sys-warning)", fontSize: "0.6rem", marginRight: "0.3rem" }}>[SYBIL]</span>
                    )}
                    {job.bot?.name || job.bot_id.slice(0, 8)}
                  </td>
                  <td style={{ color: "var(--sys-accent)" }}>{job.action_type}</td>
                  <td>
                    <span className={`badge ${statusBadge[job.status]} badge-pill dc-badge-sm`}>
                      {job.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-muted">{new Date(job.scheduled_for).toLocaleTimeString()}</td>
                  <td className="text-muted" style={{ maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {job.error || (job.result ? "OK" : "-")}
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
