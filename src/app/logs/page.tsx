"use client";

import ActionLog from "@/components/ActionLog";

export default function LogsPage() {
  return (
    <div className="dc-page">
      <div>
        <h1 className="text-glow dc-page-title">
          <span className="sys-icon sys-icon-file sys-icon-lg" /> ACTION LOG
        </h1>
        <p className="dc-page-subtitle">History of all executed bot actions</p>
      </div>

      <ActionLog limit={100} />
    </div>
  );
}
