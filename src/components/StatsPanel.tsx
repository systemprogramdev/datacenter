"use client";

import { useDashboardStore } from "@/stores/dashboardStore";
import { usePolling } from "@/lib/usePolling";

export default function StatsPanel() {
  const { stats, fetchStats } = useDashboardStore();

  usePolling(fetchStats, 30000);

  const statItems = [
    { label: "TOTAL BOTS", value: stats.totalBots, color: "var(--sys-info)" },
    { label: "ACTIVE BOTS", value: stats.activeBots, color: "var(--sys-success)" },
    { label: "JOBS TODAY", value: stats.totalJobsToday, color: "var(--sys-accent)" },
    { label: "COMPLETED", value: stats.completedJobsToday, color: "var(--sys-success)" },
    { label: "FAILED", value: stats.failedJobsToday, color: "var(--sys-danger)" },
    { label: "PENDING", value: stats.pendingJobs, color: "var(--sys-warning)" },
    { label: "TOKENS", value: stats.totalTokens.toLocaleString(), color: "var(--sys-accent)" },
    { label: "SYBIL BOTS", value: stats.sybilBotsAlive, color: "var(--sys-accent)" },
    { label: "SYBIL JOBS", value: stats.sybilJobsToday, color: "var(--sys-info)" },
  ];

  return (
    <div className="grid-stats">
      {statItems.map((item) => (
        <div key={item.label} className="panel">
          <div className="stat-label">{item.label}</div>
          <div className="stat-value" style={{ color: item.color }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
