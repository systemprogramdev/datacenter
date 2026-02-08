"use client";

import { useDashboardStore } from "@/stores/dashboardStore";
import { usePolling } from "@/lib/usePolling";

export default function SchedulerControls() {
  const { schedulerState, fetchSchedulerState, controlScheduler } =
    useDashboardStore();

  usePolling(fetchSchedulerState, 30000);

  const { running, paused, lastTick, activeJobs, totalProcessed, errors } =
    schedulerState;

  const statusLabel = running ? (paused ? "PAUSED" : "RUNNING") : "STOPPED";
  const statusColor = running && !paused ? "var(--sys-success)" : running && paused ? "var(--sys-warning)" : "var(--sys-danger)";

  return (
    <div className="panel-hud">
      <div className="dc-panel-body">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="pulse-dot" style={{ background: statusColor }} />
            <span className="dc-panel-title">SCHEDULER [{statusLabel}]</span>
          </div>
          <div className="flex gap-1">
            {!running && (
              <button onClick={() => controlScheduler("start")} className="btn btn-success btn-xs">START</button>
            )}
            {running && !paused && (
              <button onClick={() => controlScheduler("pause")} className="btn btn-warning btn-xs">PAUSE</button>
            )}
            {running && paused && (
              <button onClick={() => controlScheduler("resume")} className="btn btn-primary btn-xs">RESUME</button>
            )}
            {running && (
              <button onClick={() => controlScheduler("stop")} className="btn btn-danger btn-xs">STOP</button>
            )}
          </div>
        </div>
        <div className="dc-hud-stats">
          <div className="dc-hud-stat">Last tick: <span className="text-secondary">{lastTick ? new Date(lastTick).toLocaleTimeString() : "Never"}</span></div>
          <div className="dc-hud-stat">Active jobs: <span style={{ color: "var(--sys-info)" }}>{activeJobs}</span></div>
          <div className="dc-hud-stat">Processed: <span style={{ color: "var(--sys-success)" }}>{totalProcessed}</span></div>
          <div className="dc-hud-stat">Errors: <span style={{ color: "var(--sys-danger)" }}>{errors}</span></div>
        </div>
      </div>
    </div>
  );
}
