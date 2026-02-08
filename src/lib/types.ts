// ============================================================
// Datacenter Types - SPITr Bot Management System
// ============================================================

// --- Database Row Types ---

export interface Bot {
  id: string;
  owner_id: string;
  user_id: string;
  name: string;
  handle: string;
  personality: string;
  action_frequency: number; // 1-3 actions per day
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BotConfig {
  bot_id: string;
  enabled_actions: ActionType[];
  target_mode: TargetMode;
  target_users: string[];
  combat_strategy: CombatStrategy;
  banking_strategy: BankingStrategy;
  auto_heal_threshold: number;
  custom_prompt: string | null;
  updated_at: string;
}

export interface BotJob {
  id: string;
  bot_id: string;
  action_type: ActionType;
  action_payload: Record<string, unknown>;
  status: JobStatus;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export interface BotDailyActions {
  bot_id: string;
  action_date: string;
  actions_used: number;
}

export interface DatacenterKey {
  id: string;
  key_hash: string;
  label: string;
  is_active: boolean;
  created_at: string;
}

// --- Enums ---

export type ActionType =
  | "post"
  | "reply"
  | "like"
  | "respit"
  | "attack"
  | "use_item"
  | "bank_deposit"
  | "bank_withdraw"
  | "bank_convert"
  | "bank_stock"
  | "bank_lottery"
  | "bank_scratch"
  | "bank_cd"
  | "buy_item"
  | "open_chest"
  | "follow"
  | "transfer";

export type TargetMode = "random" | "specific" | "allies" | "enemies";
export type CombatStrategy = "aggressive" | "defensive" | "passive" | "balanced";
export type BankingStrategy = "aggressive" | "conservative" | "balanced";
export type JobStatus = "pending" | "running" | "completed" | "failed";

// --- Composite Types ---

export interface BotWithConfig extends Bot {
  config: BotConfig | null;
}

export interface BotStatus {
  hp: number;
  max_hp: number;
  credits: number;
  gold: number;
  bank_balance: number;
  level: number;
  inventory: InventoryItem[];
}

export interface InventoryItem {
  id: string;
  item_type: string;
  name: string;
  quantity: number;
}

export interface FeedItem {
  id: string;
  user_id: string;
  handle: string;
  content: string;
  created_at: string;
  likes: number;
  respits: number;
}

// --- Planner Types ---

export interface PlannerContext {
  bot: BotWithConfig;
  status: BotStatus;
  feed: FeedItem[];
  targets?: { id: string; handle: string; hp: number }[];
}

export interface PlannedAction {
  action: ActionType;
  params: Record<string, unknown>;
  reasoning?: string;
}

// --- Scheduler Types ---

export interface SchedulerState {
  running: boolean;
  paused: boolean;
  lastTick: string | null;
  activeJobs: number;
  totalProcessed: number;
  errors: number;
}

// --- Dashboard Types ---

export interface DashboardStats {
  totalBots: number;
  activeBots: number;
  totalJobsToday: number;
  completedJobsToday: number;
  failedJobsToday: number;
  pendingJobs: number;
  schedulerRunning: boolean;
  ollamaConnected: boolean;
}

// --- SSE Event Types ---

export type SSEEventType =
  | "scheduler:tick"
  | "scheduler:start"
  | "scheduler:stop"
  | "job:created"
  | "job:started"
  | "job:completed"
  | "job:failed"
  | "bot:action"
  | "stats:update";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

// --- API Response Types ---

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// --- Ollama Types ---

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  format?: "json";
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}
