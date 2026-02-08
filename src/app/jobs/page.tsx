"use client";

import JobQueue from "@/components/JobQueue";

export default function JobsPage() {
  return (
    <div className="dc-page">
      <div>
        <h1 className="text-glow dc-page-title">
          <span className="sys-icon sys-icon-clock sys-icon-lg" /> JOB QUEUE
        </h1>
        <p className="dc-page-subtitle">All scheduled and executed bot jobs</p>
      </div>

      <JobQueue limit={100} />
    </div>
  );
}
