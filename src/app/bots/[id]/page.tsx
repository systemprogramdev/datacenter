"use client";

import { useEffect, use } from "react";
import Link from "next/link";
import { useBotStore } from "@/stores/botStore";
import BotDetail from "@/components/BotDetail";
import JobQueue from "@/components/JobQueue";
import ActionLog from "@/components/ActionLog";

export default function BotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { selectedBot, loading, fetchBot } = useBotStore();

  useEffect(() => {
    fetchBot(id);
  }, [id, fetchBot]);

  if (loading && !selectedBot) {
    return (
      <div className="text-center text-muted p-5">
        <div className="loader-cyber" style={{ margin: "0 auto 0.75rem" }} />
        Loading bot...
      </div>
    );
  }

  if (!selectedBot) {
    return (
      <div className="text-center p-5">
        <div className="alert alert-danger" style={{ display: "inline-block" }}>
          <span className="sys-icon sys-icon-x sys-icon-sm" /> Bot not found
        </div>
        <div style={{ marginTop: "0.4rem" }}>
          <Link href="/bots" className="btn btn-ghost btn-sm">
            <span className="sys-icon sys-icon-chevron-left sys-icon-sm" /> Back to bots
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dc-page">
      <Link href="/bots" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
        <span className="sys-icon sys-icon-chevron-left sys-icon-sm" /> BACK TO BOTS
      </Link>

      <BotDetail bot={selectedBot} />

      <div className="grid-2col">
        <JobQueue botId={id} limit={10} />
        <ActionLog botId={id} limit={10} />
      </div>
    </div>
  );
}
