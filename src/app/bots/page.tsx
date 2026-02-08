"use client";

import { useEffect, useState } from "react";
import { useBotStore } from "@/stores/botStore";
import BotCard from "@/components/BotCard";

export default function BotsPage() {
  const { bots, loading, fetchBots, createBot } = useBotStore();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    handle: "",
    owner_id: "",
    user_id: "",
    personality: "neutral",
    action_frequency: 3,
  });

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  const handleCreate = async () => {
    if (!form.name || !form.handle || !form.owner_id || !form.user_id) return;
    await createBot(form);
    setShowCreate(false);
    setForm({ name: "", handle: "", owner_id: "", user_id: "", personality: "neutral", action_frequency: 3 });
  };

  return (
    <div className="dc-page">
      <div className="dc-page-header">
        <div>
          <h1 className="text-glow dc-page-title">
            <span className="sys-icon sys-icon-user sys-icon-lg" /> BOTS
          </h1>
          <p className="dc-page-subtitle">{bots.length} registered bots</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className={`btn btn-sm ${showCreate ? "btn-outline-danger" : "btn-success"}`}>
          <span className={`sys-icon ${showCreate ? "sys-icon-x" : "sys-icon-plus"} sys-icon-sm`} />
          {showCreate ? "CANCEL" : "NEW BOT"}
        </button>
      </div>

      {showCreate && (
        <div className="panel-glow">
          <div className="dc-panel-body">
            <h3 className="dc-panel-title" style={{ color: "var(--sys-primary)" }}>
              <span className="sys-icon sys-icon-plus sys-icon-sm" /> CREATE BOT
            </h3>
            <div className="dc-form-grid">
              <div className="input-group">
                <label className="input-label">Bot Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CoolBot2000" />
              </div>
              <div className="input-group">
                <label className="input-label">Handle</label>
                <input className="input" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="coolbot2000" />
              </div>
              <div className="input-group">
                <label className="input-label">Owner User ID</label>
                <input className="input" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })} placeholder="UUID of the bot owner" />
              </div>
              <div className="input-group">
                <label className="input-label">Bot User ID</label>
                <input className="input" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} placeholder="UUID of the bot's user account" />
              </div>
              <div className="input-group">
                <label className="input-label">Personality</label>
                <select className="select" value={form.personality} onChange={(e) => setForm({ ...form, personality: e.target.value })}>
                  <option value="neutral">Neutral</option>
                  <option value="aggressive">Aggressive</option>
                  <option value="friendly">Friendly</option>
                  <option value="chaotic">Chaotic</option>
                  <option value="intellectual">Intellectual</option>
                  <option value="troll">Troll</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Actions/Day</label>
                <select className="select" value={form.action_frequency} onChange={(e) => setForm({ ...form, action_frequency: parseInt(e.target.value) })}>
                  <option value={1}>1x/day</option>
                  <option value={2}>2x/day</option>
                  <option value={3}>3x/day</option>
                </select>
              </div>
            </div>
            <div className="dc-form-footer">
              <button
                onClick={handleCreate}
                disabled={!form.name || !form.handle || !form.owner_id || !form.user_id}
                className="btn btn-success btn-sm"
                style={{ opacity: (!form.name || !form.handle || !form.owner_id || !form.user_id) ? 0.3 : 1 }}
              >
                <span className="sys-icon sys-icon-check sys-icon-sm" /> CREATE
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-muted p-5">
          <div className="loader-cyber" style={{ margin: "0 auto 0.75rem" }} />
          Loading bots...
        </div>
      ) : bots.length === 0 ? (
        <div className="text-center p-5">
          <div className="text-muted text-sm">No bots registered</div>
          <div className="dc-page-subtitle">Create a bot to get started</div>
        </div>
      ) : (
        <div className="grid-bots">
          {bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} />
          ))}
        </div>
      )}
    </div>
  );
}
