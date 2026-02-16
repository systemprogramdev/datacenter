"use client";

import { useState } from "react";
import { useImageStore } from "@/stores/imageStore";
import { usePolling } from "@/lib/usePolling";
import type { ImageServerAction } from "@/lib/types";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ImagesPage() {
  const {
    serverData,
    styles,
    generatedStyles,
    generating,
    actionLoading,
    error,
    fetchServerData,
    fetchStyles,
    updateStyles,
    executeAction,
    generateNewStyles,
    clearGeneratedStyles,
  } = useImageStore();

  const [editing, setEditing] = useState(false);
  const [editAvatarStyles, setEditAvatarStyles] = useState<string[]>([]);
  const [editBannerStyles, setEditBannerStyles] = useState<string[]>([]);

  usePolling(fetchServerData, 15000);
  usePolling(fetchStyles, 60000);

  const { online, health, stats, recent_files } = serverData;

  const handleAction = async (action: ImageServerAction) => {
    const ok = await executeAction(action);
    if (ok) {
      // Refresh data after action
      setTimeout(() => fetchServerData(), 1000);
    }
  };

  const startEdit = () => {
    if (styles) {
      setEditAvatarStyles([...styles.avatar_styles]);
      setEditBannerStyles([...styles.banner_styles]);
    }
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveStyles = async () => {
    const ok = await updateStyles({
      avatar_styles: editAvatarStyles,
      banner_styles: editBannerStyles,
    });
    if (ok) setEditing(false);
  };

  const updateStyleLine = (
    arr: string[],
    setArr: (v: string[]) => void,
    index: number,
    value: string
  ) => {
    const next = [...arr];
    next[index] = value;
    setArr(next);
  };

  const removeStyleLine = (arr: string[], setArr: (v: string[]) => void, index: number) => {
    setArr(arr.filter((_, i) => i !== index));
  };

  const addStyleLine = (arr: string[], setArr: (v: string[]) => void) => {
    setArr([...arr, ""]);
  };

  const applyGeneratedStyles = async (mode: "replace" | "append") => {
    if (!generatedStyles) return;
    if (mode === "replace") {
      const ok = await updateStyles({
        avatar_styles: generatedStyles.avatar_styles,
        banner_styles: generatedStyles.banner_styles,
      });
      if (ok) clearGeneratedStyles();
    } else {
      const merged = {
        avatar_styles: [...(styles?.avatar_styles || []), ...generatedStyles.avatar_styles],
        banner_styles: [...(styles?.banner_styles || []), ...generatedStyles.banner_styles],
      };
      const ok = await updateStyles(merged);
      if (ok) clearGeneratedStyles();
    }
  };

  const actionButtons: { action: ImageServerAction; label: string; icon: string; variant: string }[] = [
    { action: "unload", label: "UNLOAD MODEL", icon: "sys-icon-x", variant: "btn-outline-warning" },
    { action: "generate-test-avatar", label: "TEST AVATAR", icon: "sys-icon-user", variant: "btn-outline-info" },
    { action: "generate-test-banner", label: "TEST BANNER", icon: "sys-icon-image", variant: "btn-outline-info" },
    { action: "clear-output", label: "CLEAR OUTPUT", icon: "sys-icon-trash", variant: "btn-outline-danger" },
    { action: "restart", label: "RESTART SERVER", icon: "sys-icon-refresh", variant: "btn-outline-warning" },
  ];

  const statItems = [
    { label: "TOTAL GEN", value: stats?.total_generated ?? "—", color: "var(--sys-accent)" },
    { label: "AVATARS", value: stats?.avatars_generated ?? "—", color: "var(--sys-info)" },
    { label: "BANNERS", value: stats?.banners_generated ?? "—", color: "var(--sys-info)" },
    { label: "DISK MB", value: stats?.output_dir_size_mb ?? "—", color: "var(--sys-warning)" },
    { label: "DEVICE", value: stats?.device?.toUpperCase() ?? "—", color: "var(--sys-accent)" },
    { label: "UPTIME", value: stats ? formatUptime(stats.uptime_seconds) : "—", color: "var(--sys-success)" },
  ];

  return (
    <div className="dc-page">
      {/* Header */}
      <div className="dc-page-header">
        <div>
          <h1 className="text-glow dc-page-title">
            <span className="sys-icon sys-icon-image sys-icon-lg" /> IMAGE SERVER
          </h1>
          <p className="dc-page-subtitle">SDXL Turbo generation service // port 8100</p>
        </div>
      </div>

      {/* Status HUD */}
      <div className="panel-hud" style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            className="pulse-dot"
            style={{
              background: online ? "var(--sys-success)" : "var(--sys-danger)",
              width: 10,
              height: 10,
              borderRadius: "50%",
              display: "inline-block",
              boxShadow: online
                ? "0 0 8px var(--sys-success)"
                : "0 0 8px var(--sys-danger)",
            }}
          />
          <span style={{ color: online ? "var(--sys-success)" : "var(--sys-danger)", fontWeight: 700, fontSize: "0.75rem" }}>
            {online ? "ONLINE" : "OFFLINE"}
          </span>
          {online && health && (
            <>
              <span className="text-muted" style={{ fontSize: "0.65rem" }}>
                MODEL: {health.model_loaded ? "LOADED" : "UNLOADED"}
              </span>
              <span className="text-muted" style={{ fontSize: "0.65rem" }}>
                DEVICE: {health.device?.toUpperCase()}
              </span>
              {stats && (
                <>
                  <span className="text-muted" style={{ fontSize: "0.65rem" }}>
                    UPTIME: {formatUptime(stats.uptime_seconds)}
                  </span>
                  <span className="text-muted" style={{ fontSize: "0.65rem" }}>
                    FILES: {recent_files.length}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "var(--sys-danger)", marginBottom: "0.75rem" }}>
          <span style={{ color: "var(--sys-danger)", fontSize: "0.7rem" }}>ERROR: {error}</span>
        </div>
      )}

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "0.4rem", marginBottom: "0.75rem" }}>
        {statItems.map((item) => (
          <div key={item.label} className="panel">
            <div className="stat-label">{item.label}</div>
            <div className="stat-value" style={{ color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Actions + Recent Files */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
        {/* Actions */}
        <div className="panel">
          <div className="dc-panel-title" style={{ marginBottom: "0.5rem" }}>
            <span className="sys-icon sys-icon-terminal sys-icon-sm" /> ACTIONS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {actionButtons.map((btn) => (
              <button
                key={btn.action}
                className={`btn btn-sm ${btn.variant}`}
                style={{ justifyContent: "flex-start", opacity: actionLoading ? 0.5 : 1 }}
                disabled={!!actionLoading}
                onClick={() => handleAction(btn.action)}
              >
                {actionLoading === btn.action ? (
                  <span className="loader-cyber" style={{ width: 12, height: 12 }} />
                ) : (
                  <span className={`sys-icon ${btn.icon} sys-icon-sm`} />
                )}
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Recent Files */}
        <div className="panel-log" style={{ maxHeight: "280px", overflow: "auto" }}>
          <div className="dc-panel-title" style={{ marginBottom: "0.5rem" }}>
            <span className="sys-icon sys-icon-file sys-icon-sm" /> RECENT GENERATIONS
          </div>
          {recent_files.length === 0 ? (
            <div className="text-muted text-center" style={{ fontSize: "0.65rem", padding: "1rem" }}>
              No files generated yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              {recent_files.map((file) => (
                <div
                  key={file.filename}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.65rem",
                    padding: "0.2rem 0",
                    borderBottom: "1px solid var(--sys-border)",
                  }}
                >
                  <span
                    style={{
                      background: file.type === "avatar" ? "var(--sys-info)" : "var(--sys-warning)",
                      color: "#000",
                      padding: "0 0.3rem",
                      borderRadius: "2px",
                      fontSize: "0.55rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    {file.type}
                  </span>
                  <span className="text-muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.filename}
                  </span>
                  <span className="text-muted">{file.size_kb}kb</span>
                  <span className="text-muted">{timeAgo(file.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Style Generator */}
      <div className="panel" style={{ padding: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: generatedStyles ? "0.5rem" : 0 }}>
          <div className="dc-panel-title">
            <span className="sys-icon sys-icon-terminal sys-icon-sm" /> AI STYLE GENERATOR
          </div>
          <button
            className="btn btn-sm btn-outline-accent"
            onClick={generateNewStyles}
            disabled={generating}
            style={{ opacity: generating ? 0.5 : 1 }}
          >
            {generating ? (
              <>
                <span className="loader-cyber" style={{ width: 12, height: 12 }} />
                GENERATING...
              </>
            ) : (
              "GENERATE NEW STYLES"
            )}
          </button>
        </div>

        {generatedStyles && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.5rem" }}>
              <div>
                <div className="stat-label" style={{ marginBottom: "0.25rem" }}>AVATAR STYLES ({generatedStyles.avatar_styles.length})</div>
                {generatedStyles.avatar_styles.map((s, i) => (
                  <div key={i} style={{ fontSize: "0.6rem", color: "var(--sys-text)", padding: "0.15rem 0", borderBottom: "1px solid var(--sys-border)" }}>
                    <span style={{ color: "var(--sys-info)", marginRight: "0.35rem" }}>{i + 1}.</span>{s}
                  </div>
                ))}
              </div>
              <div>
                <div className="stat-label" style={{ marginBottom: "0.25rem" }}>BANNER STYLES ({generatedStyles.banner_styles.length})</div>
                {generatedStyles.banner_styles.map((s, i) => (
                  <div key={i} style={{ fontSize: "0.6rem", color: "var(--sys-text)", padding: "0.15rem 0", borderBottom: "1px solid var(--sys-border)" }}>
                    <span style={{ color: "var(--sys-warning)", marginRight: "0.35rem" }}>{i + 1}.</span>{s}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button className="btn btn-sm btn-success" onClick={() => applyGeneratedStyles("replace")}>
                <span className="sys-icon sys-icon-check sys-icon-sm" /> REPLACE ALL
              </button>
              <button className="btn btn-sm btn-outline-info" onClick={() => applyGeneratedStyles("append")}>
                APPEND TO EXISTING
              </button>
              <button className="btn btn-sm btn-outline-danger" onClick={clearGeneratedStyles}>
                DISCARD
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Styles Editor */}
      <div className="card" style={{ padding: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <div className="dc-panel-title">
            <span className="sys-icon sys-icon-edit sys-icon-sm" /> PROMPT STYLES
          </div>
          {!editing ? (
            <button
              className="btn btn-sm btn-outline-info"
              onClick={startEdit}
              disabled={!styles}
              style={{ opacity: styles ? 1 : 0.3 }}
            >
              <span className="sys-icon sys-icon-edit sys-icon-sm" /> EDIT
            </button>
          ) : (
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button className="btn btn-sm btn-outline-danger" onClick={cancelEdit}>
                CANCEL
              </button>
              <button className="btn btn-sm btn-success" onClick={saveStyles}>
                <span className="sys-icon sys-icon-check sys-icon-sm" /> SAVE
              </button>
            </div>
          )}
        </div>

        {!editing ? (
          /* Read-only view */
          styles?.avatar_styles && styles?.banner_styles ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <div className="stat-label" style={{ marginBottom: "0.35rem" }}>AVATAR STYLES ({styles.avatar_styles.length})</div>
                {styles.avatar_styles.map((s, i) => (
                  <div key={i} style={{ fontSize: "0.6rem", color: "var(--sys-muted)", padding: "0.15rem 0", borderBottom: "1px solid var(--sys-border)" }}>
                    <span style={{ color: "var(--sys-info)", marginRight: "0.35rem" }}>{i + 1}.</span>{s}
                  </div>
                ))}
              </div>
              <div>
                <div className="stat-label" style={{ marginBottom: "0.35rem" }}>BANNER STYLES ({styles.banner_styles.length})</div>
                {styles.banner_styles.map((s, i) => (
                  <div key={i} style={{ fontSize: "0.6rem", color: "var(--sys-muted)", padding: "0.15rem 0", borderBottom: "1px solid var(--sys-border)" }}>
                    <span style={{ color: "var(--sys-warning)", marginRight: "0.35rem" }}>{i + 1}.</span>{s}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-muted text-center" style={{ fontSize: "0.65rem", padding: "1rem" }}>
              {online ? "Loading styles..." : "Server offline — styles unavailable"}
            </div>
          )
        ) : (
          /* Edit mode */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <div className="stat-label" style={{ marginBottom: "0.35rem" }}>AVATAR STYLES</div>
              {editAvatarStyles.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "0.25rem", marginBottom: "0.25rem" }}>
                  <textarea
                    className="input"
                    value={s}
                    onChange={(e) => updateStyleLine(editAvatarStyles, setEditAvatarStyles, i, e.target.value)}
                    rows={2}
                    style={{ fontSize: "0.6rem", flex: 1, resize: "vertical" }}
                  />
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => removeStyleLine(editAvatarStyles, setEditAvatarStyles, i)}
                    style={{ alignSelf: "flex-start", padding: "0.15rem 0.3rem" }}
                  >
                    <span className="sys-icon sys-icon-x sys-icon-sm" />
                  </button>
                </div>
              ))}
              <button
                className="btn btn-sm btn-outline-info"
                onClick={() => addStyleLine(editAvatarStyles, setEditAvatarStyles)}
                style={{ fontSize: "0.6rem" }}
              >
                <span className="sys-icon sys-icon-plus sys-icon-sm" /> ADD
              </button>
            </div>
            <div>
              <div className="stat-label" style={{ marginBottom: "0.35rem" }}>BANNER STYLES</div>
              {editBannerStyles.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "0.25rem", marginBottom: "0.25rem" }}>
                  <textarea
                    className="input"
                    value={s}
                    onChange={(e) => updateStyleLine(editBannerStyles, setEditBannerStyles, i, e.target.value)}
                    rows={2}
                    style={{ fontSize: "0.6rem", flex: 1, resize: "vertical" }}
                  />
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => removeStyleLine(editBannerStyles, setEditBannerStyles, i)}
                    style={{ alignSelf: "flex-start", padding: "0.15rem 0.3rem" }}
                  >
                    <span className="sys-icon sys-icon-x sys-icon-sm" />
                  </button>
                </div>
              ))}
              <button
                className="btn btn-sm btn-outline-info"
                onClick={() => addStyleLine(editBannerStyles, setEditBannerStyles)}
                style={{ fontSize: "0.6rem" }}
              >
                <span className="sys-icon sys-icon-plus sys-icon-sm" /> ADD
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
