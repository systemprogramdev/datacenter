"use client";

import { useState } from "react";
import { useBotStore } from "@/stores/botStore";
import type { BotWithConfig, ActionType } from "@/lib/types";

interface BotDetailProps {
  bot: BotWithConfig;
}

const ALL_ACTIONS: ActionType[] = [
  "post", "reply", "like", "respit", "attack", "follow",
  "buy_item", "use_item", "open_chest", "claim_chest", "dm_send",
  "bank_deposit", "bank_withdraw", "bank_convert", "bank_stock", "bank_lottery", "bank_cd",
  "transfer",
];

export default function BotDetail({ bot }: BotDetailProps) {
  const { updateBot, deleteBot, triggerAction } = useBotStore();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    personality: string;
    action_frequency: number;
    combat_strategy: string;
    banking_strategy: string;
    auto_heal_threshold: number;
    custom_prompt: string;
    target_mode: string;
  }>({
    personality: bot.personality,
    action_frequency: bot.action_frequency,
    combat_strategy: bot.config?.combat_strategy || "balanced",
    banking_strategy: bot.config?.banking_strategy || "conservative",
    auto_heal_threshold: bot.config?.auto_heal_threshold || 1000,
    custom_prompt: bot.config?.custom_prompt || "",
    target_mode: bot.config?.target_mode || "random",
  });

  const handleAction = async (action: string) => {
    setActionLoading(action);
    setLastResult(null);
    try {
      const result = await triggerAction(bot.id, action);
      setLastResult(
        result
          ? `Action "${action}" executed.\n${JSON.stringify(result.planned, null, 2)}`
          : `Action "${action}" failed.`
      );
    } catch {
      setLastResult(`Error triggering "${action}"`);
    }
    setActionLoading(null);
  };

  const handleSave = async () => {
    await updateBot(bot.id, editForm);
    setEditing(false);
  };

  const handleToggleActive = async () => {
    await updateBot(bot.id, { is_active: !bot.is_active });
  };

  return (
    <div className="dc-page">
      {/* Header */}
      <div className="dc-page-header">
        <div>
          <div className="flex items-center gap-2">
            <div className="pulse-dot-lg" style={{ background: bot.is_active ? "var(--sys-success)" : "var(--sys-danger)" }} />
            <h2 className="text-glow dc-page-title">{bot.name}</h2>
            <span className="text-secondary text-sm">@{bot.handle}</span>
          </div>
          <div className="dc-page-subtitle">ID: {bot.id} | User: {bot.user_id}</div>
        </div>
        <div className="flex gap-1">
          <button onClick={handleToggleActive} className={`btn btn-sm ${bot.is_active ? "btn-outline-danger" : "btn-outline"}`}>
            <span className={`sys-icon ${bot.is_active ? "sys-icon-x" : "sys-icon-check"} sys-icon-sm`} />
            {bot.is_active ? "DEACTIVATE" : "ACTIVATE"}
          </button>
          <button onClick={() => setEditing(!editing)} className="btn btn-sm btn-outline">
            <span className="sys-icon sys-icon-settings sys-icon-sm" />
            {editing ? "CANCEL" : "EDIT"}
          </button>
          <button
            onClick={() => { if (confirm("Delete this bot?")) deleteBot(bot.id); }}
            className="btn btn-sm btn-danger"
          >
            <span className="sys-icon sys-icon-x sys-icon-sm" /> DELETE
          </button>
        </div>
      </div>

      {/* Config Editor */}
      {editing && (
        <div className="panel-glow">
          <div className="dc-panel-body">
            <h3 className="dc-panel-title" style={{ color: "var(--sys-primary)" }}>
              <span className="sys-icon sys-icon-settings sys-icon-sm" /> EDIT CONFIG
            </h3>
            <div className="dc-form-grid">
              <div className="input-group">
                <label className="input-label">Personality</label>
                <input className="input" value={editForm.personality} onChange={(e) => setEditForm({ ...editForm, personality: e.target.value })} />
              </div>
              <div className="input-group">
                <label className="input-label">Actions/Day (1-100)</label>
                <input type="number" min={1} max={100} className="input" value={editForm.action_frequency} onChange={(e) => setEditForm({ ...editForm, action_frequency: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="input-group">
                <label className="input-label">Combat Strategy</label>
                <select className="select" value={editForm.combat_strategy} onChange={(e) => setEditForm({ ...editForm, combat_strategy: e.target.value })}>
                  <option value="aggressive">Aggressive</option>
                  <option value="defensive">Defensive</option>
                  <option value="passive">Passive</option>
                  <option value="balanced">Balanced</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Banking Strategy</label>
                <select className="select" value={editForm.banking_strategy} onChange={(e) => setEditForm({ ...editForm, banking_strategy: e.target.value })}>
                  <option value="aggressive">Aggressive</option>
                  <option value="conservative">Conservative</option>
                  <option value="balanced">Balanced</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Target Mode</label>
                <select className="select" value={editForm.target_mode} onChange={(e) => setEditForm({ ...editForm, target_mode: e.target.value })}>
                  <option value="random">Random</option>
                  <option value="specific">Specific</option>
                  <option value="allies">Allies</option>
                  <option value="enemies">Enemies</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Auto-heal HP</label>
                <input type="number" className="input" value={editForm.auto_heal_threshold} onChange={(e) => setEditForm({ ...editForm, auto_heal_threshold: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="input-group" style={{ marginTop: "0.4rem" }}>
              <label className="input-label">Custom Prompt</label>
              <textarea className="textarea" value={editForm.custom_prompt} onChange={(e) => setEditForm({ ...editForm, custom_prompt: e.target.value })} placeholder="Custom personality instructions for the LLM..." />
            </div>
            <div className="dc-form-footer">
              <button onClick={handleSave} className="btn btn-success btn-sm">
                <span className="sys-icon sys-icon-check sys-icon-sm" /> SAVE CHANGES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Actions */}
      <div className="panel-terminal">
        <div className="dc-panel-body">
          <h3 className="dc-panel-title" style={{ color: "var(--sys-primary)" }}>
            <span className="sys-icon sys-icon-terminal sys-icon-sm" /> MANUAL ACTIONS
          </h3>
          <div className="dc-action-grid">
            {ALL_ACTIONS.map((action) => (
              <button
                key={action}
                onClick={() => handleAction(action)}
                disabled={actionLoading !== null}
                className={`btn btn-sm ${actionLoading === action ? "btn-warning btn-loading" : "btn-outline"}`}
              >
                {action.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Result */}
      {lastResult && (
        <div className="panel-cli">
          <div className="panel-cli-header">LAST RESULT</div>
          <div className="panel-cli-body">
            <pre className="panel-cli-output" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{lastResult}</pre>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="card">
        <div className="card-header">
          <span className="sys-icon sys-icon-user sys-icon-sm" /> BOT INFO
        </div>
        <div className="card-body" style={{ padding: "0.6rem 0.75rem" }}>
          <div className="dc-info-grid">
            <div><span className="text-muted">Personality:</span> <span className="badge badge-info badge-pill dc-badge-sm">{bot.personality}</span></div>
            <div><span className="text-muted">Frequency:</span> <span style={{ color: "var(--sys-info)" }}>{bot.action_frequency}x/day</span></div>
            <div><span className="text-muted">Combat:</span> <span style={{ color: "var(--sys-danger)" }}>{bot.config?.combat_strategy}</span></div>
            <div><span className="text-muted">Banking:</span> <span style={{ color: "var(--sys-warning)" }}>{bot.config?.banking_strategy}</span></div>
            <div><span className="text-muted">Target:</span> <span className="text-secondary">{bot.config?.target_mode}</span></div>
            <div><span className="text-muted">Auto-heal:</span> <span className="text-secondary">{bot.config?.auto_heal_threshold} HP</span></div>
            <div style={{ gridColumn: "span 2" }}>
              <span className="text-muted">Enabled:</span>{" "}
              <span className="text-secondary">{bot.config?.enabled_actions.join(", ")}</span>
            </div>
            {bot.config?.custom_prompt && (
              <div style={{ gridColumn: "span 2" }}>
                <span className="text-muted">Custom prompt:</span>{" "}
                <span className="text-secondary">{bot.config.custom_prompt}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
