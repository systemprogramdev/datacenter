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
  | "transfer"
  | "dm_send"
  | "claim_chest"
  | "consolidate";

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
  xp: number;
  xp_next_level: number;
  destroyed: boolean;
  daily_chest_available: boolean;
  weekly_paycheck_available: boolean;
  has_firewall: boolean;
  kevlar_charges: number;
  stocks_owned: number;
  active_cds: ActiveCD[];
  inventory: InventoryItem[];
  market?: MarketData;
  deposits_over_24h?: BotDeposit[];
  suggested_action?: string;
  financial_advisor?: FinancialAdvisor;
}

// --- Market & Financial Types ---

export interface MarketData {
  current_rate: number;
  current_rate_percent: number;
  rate_trend: "up" | "down" | "stable";
  signal: "bank" | "trade" | "hold";
  stock_price: number;
  stock_trend: "up" | "down" | "stable";
  rate_position: number; // 0.0-1.0 normalized yield position
  stock_signal: "buy" | "sell" | "hold"; // buy ≤30%, sell ≥70%, hold between
  time_to_peak_hours?: number;
  time_to_trough_hours?: number;
}

export interface ConsolidateResult {
  spits_sent: number;
  gold_sent: number;
  limits: { spits_remaining: number; gold_remaining: number };
  bot_wealth: { credits: number; gold: number; bank_balance: number };
}

export interface BankingProfile {
  depositPercent: number;
  withdrawPercent: number;
  minWalletReserve: number;
  stockBuyThreshold: number;
  stockSellThreshold: number;
  consolidateReserveSpits: number;
  consolidateReserveGold: number;
}

export interface BotDeposit {
  id: string;
  principal: number;
  withdrawn: number;
  accrued_interest: number;
  current_value: number;
}

export interface ActiveCD {
  id: string;
  amount: number;
  term: number;
  matures_at: string;
  currency: "spit" | "gold";
  rate: number;
}

// --- Financial Advisor Types (server-side) ---

export interface RedeemableCD {
  cd_id: string;
  amount: number;
  currency: "spit" | "gold";
  matured: boolean;
  rate: number;
  matures_at: string;
}

export interface CDAdvice {
  recommended_currency: "spit" | "gold";
  recommended_term_days: number;
  current_spit_rate: number;
  current_gold_rate: number;
  reasoning: string;
}

export interface ConversionAdvice {
  direction: "spits_to_gold" | "gold_to_spits";
  amount: number;
  reasoning: string;
}

export interface ConsolidationAdvice {
  ready: boolean;
  spit_surplus: number;
  gold_surplus: number;
}

export interface FinancialStrategy {
  action: string;
  params: Record<string, unknown>;
  reasoning: string;
  priority: number;
}

export interface FinancialAdvisor {
  priority_queue: FinancialStrategy[];
  redeemable_cds: RedeemableCD[];
  cd_advice: CDAdvice;
  conversion_advice: ConversionAdvice | null;
  consolidation: ConsolidationAdvice;
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
  hp: number;
  max_hp: number;
  level: number;
  destroyed: boolean;
}

// --- DM Types ---

export interface DMConversation {
  conversation_id: string;
  other_user_id: string;
  other_handle: string;
  other_name: string;
  last_message: string | null;
  last_message_at: string | null;
  unread: boolean;
}

export interface DMMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

// --- Notification Types ---

export interface BotNotification {
  id: string;
  type: string;
  actor_id: string | null;
  actor_handle: string | null;
  actor_name: string | null;
  spit_id: string | null;
  reference_id: string | null;
  read: boolean;
  created_at: string;
}

// --- User Lookup Types ---

export interface UserLookup {
  id: string;
  handle: string;
  name: string;
  hp: number;
  max_hp: number;
  level: number;
  destroyed: boolean;
  is_bot: boolean;
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
