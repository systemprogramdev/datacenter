"use client";

import { useEffect, useState } from "react";
import OllamaStatus from "@/components/OllamaStatus";

interface ConfigState {
  supabaseUrl: string;
  ollamaUrl: string;
  ollamaModel: string;
  spitrApiUrl: string;
  schedulerInterval: string;
  schedulerConcurrency: string;
  dryRun: boolean;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigState>({
    supabaseUrl: "",
    ollamaUrl: "",
    ollamaModel: "",
    spitrApiUrl: "",
    schedulerInterval: "",
    schedulerConcurrency: "",
    dryRun: true,
  });

  useEffect(() => {
    // Check dry run status from the scheduler endpoint
    fetch("/api/scheduler")
      .then((r) => r.json())
      .then((data) => {
        setConfig({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "Not configured",
          ollamaUrl: "http://localhost:11434",
          ollamaModel: "llama3.1:8b",
          spitrApiUrl: "https://spitr.wtf",
          schedulerInterval: "600000",
          schedulerConcurrency: "5",
          dryRun: data.data?.dryRun ?? true,
        });
      })
      .catch(() => {
        setConfig((c) => ({ ...c, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "Not configured" }));
      });
  }, []);

  const configItems = [
    { label: "Supabase URL", value: config.supabaseUrl, key: "NEXT_PUBLIC_SUPABASE_URL" },
    { label: "Ollama URL", value: config.ollamaUrl, key: "OLLAMA_URL" },
    { label: "Ollama Model", value: config.ollamaModel, key: "OLLAMA_MODEL" },
    { label: "SPITr API URL", value: config.spitrApiUrl, key: "SPITR_API_URL" },
    { label: "Scheduler Interval (ms)", value: config.schedulerInterval, key: "SCHEDULER_TICK_INTERVAL" },
    { label: "Scheduler Concurrency", value: config.schedulerConcurrency, key: "SCHEDULER_CONCURRENCY" },
  ];

  return (
    <div className="dc-page">
      <div>
        <h1 className="text-glow dc-page-title">
          <span className="sys-icon sys-icon-settings sys-icon-lg" /> SETTINGS
        </h1>
        <p className="dc-page-subtitle">Datacenter configuration (read from .env.local)</p>
      </div>

      <OllamaStatus />

      <div className="card">
        <div className="card-header">
          <span className="sys-icon sys-icon-code sys-icon-sm" /> ENVIRONMENT CONFIG
        </div>
        <div className="card-body" style={{ padding: "0.6rem 0.75rem" }}>
          <p className="text-xs text-muted" style={{ marginBottom: "0.6rem" }}>
            These values are configured in .env.local. Restart the server after changes.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {configItems.map((item) => (
              <div key={item.key} className="dc-config-row">
                <div className="dc-config-label">{item.label}</div>
                <div className="input" style={{ flex: 1, padding: "0.2rem 0.5rem", fontSize: "0.7rem" }}>
                  {item.value}
                </div>
                <div className="dc-config-key">{item.key}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {config.dryRun ? (
        <div className="alert alert-warning">
          <span className="sys-icon sys-icon-shield sys-icon-sm" />
          <div>
            <strong>DRY RUN MODE</strong>
            <div className="text-xs" style={{ marginTop: "0.15rem" }}>
              Bot actions will be logged but not sent to the SPITr API.
              Set a valid <code>DATACENTER_API_KEY</code> in .env.local to enable live mode.
            </div>
          </div>
        </div>
      ) : (
        <div className="alert alert-success">
          <span className="sys-icon sys-icon-check sys-icon-sm" />
          <div>
            <strong>LIVE MODE</strong>
            <div className="text-xs" style={{ marginTop: "0.15rem" }}>
              Datacenter API key is configured. Bot actions will be sent to the SPITr API.
            </div>
          </div>
        </div>
      )}

      <div className="panel-terminal">
        <div className="dc-panel-body">
          <h3 className="dc-panel-title" style={{ color: "var(--sys-primary)" }}>
            <span className="sys-icon sys-icon-code sys-icon-sm" /> SETUP GUIDE
          </h3>
          <ol className="text-xs text-secondary" style={{ listStyleType: "decimal", paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <li>Run SQL migrations on your Supabase project (see /sql directory)</li>
            <li>Set Supabase URL and keys in .env.local</li>
            <li>Install and start Ollama: <code style={{ color: "var(--sys-success)" }}>ollama serve</code></li>
            <li>Pull a model: <code style={{ color: "var(--sys-success)" }}>ollama pull llama3.1:8b</code></li>
            <li>Implement bot API endpoints on spitr.wtf (see API spec)</li>
            <li>Set <code style={{ color: "var(--sys-success)" }}>DATACENTER_API_KEY</code> to switch out of dry run</li>
            <li>Create bots via the BOTS page and start the scheduler</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
