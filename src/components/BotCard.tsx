"use client";

import Link from "next/link";
import type { BotWithConfig } from "@/lib/types";

interface BotCardProps {
  bot: BotWithConfig;
}

export default function BotCard({ bot }: BotCardProps) {
  return (
    <Link href={`/bots/${bot.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card" style={{ cursor: "pointer", transition: "border-color 0.2s" }}>
        <div className="card-header">
          <div className="flex items-center justify-between" style={{ width: "100%" }}>
            <div className="flex items-center gap-2">
              <div className="pulse-dot" style={{ background: bot.is_active ? "var(--sys-success)" : "var(--sys-danger)" }} />
              <span className="font-bold text-sm">{bot.name}</span>
            </div>
            <span className="text-xs text-muted">{bot.action_frequency}x/day</span>
          </div>
        </div>
        <div className="card-body" style={{ padding: "0.6rem 0.75rem" }}>
          <div className="text-xs text-secondary" style={{ marginBottom: "0.35rem" }}>
            <span className="sys-icon sys-icon-user sys-icon-sm" /> @{bot.handle}
          </div>

          <div className="flex flex-wrap gap-1" style={{ marginBottom: "0.35rem" }}>
            <span className="badge badge-info badge-pill dc-badge-sm">{bot.personality}</span>
            {bot.config && (
              <>
                <span className="badge badge-outline badge-pill dc-badge-sm">{bot.config.combat_strategy}</span>
                <span className="badge badge-outline badge-pill dc-badge-sm">{bot.config.target_mode}</span>
              </>
            )}
          </div>

          {bot.config && (
            <div className="text-muted" style={{ fontSize: "0.6rem" }}>
              {bot.config.enabled_actions.slice(0, 4).join(", ")}
              {bot.config.enabled_actions.length > 4 && ` +${bot.config.enabled_actions.length - 4}`}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
