"use client";

import StatsPanel from "@/components/StatsPanel";
import SchedulerControls from "@/components/SchedulerControls";
import OllamaStatus from "@/components/OllamaStatus";
import JobQueue from "@/components/JobQueue";

export default function DashboardPage() {
  return (
    <div className="dc-page">
      <div className="dc-page-header">
        <div>
          <h1 className="glitch text-glow dc-page-title" data-text="SYSTEM OVERVIEW">
            SYSTEM OVERVIEW
          </h1>
          <p className="dc-page-subtitle">Real-time datacenter monitoring and control</p>
        </div>
      </div>

      <StatsPanel />

      <div className="grid-2col">
        <SchedulerControls />
        <OllamaStatus />
      </div>

      <JobQueue limit={50} />
    </div>
  );
}
