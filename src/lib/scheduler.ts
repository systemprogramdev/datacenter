import { EventEmitter } from "events";
import { supabase } from "./supabase";
import { planAction, planSpecificAction } from "./planner";
import { executeJob } from "./executor";
import type {
  BotWithConfig,
  BotJob,
  SchedulerState,
  SSEEventType,
} from "./types";

// Global event emitter for SSE streaming
const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export function emitEvent(type: SSEEventType, data: unknown) {
  eventBus.emit("sse", {
    type,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function onEvent(handler: (event: { type: SSEEventType; data: unknown; timestamp: string }) => void) {
  eventBus.on("sse", handler);
  return () => eventBus.off("sse", handler);
}

// Weighted action selection — pick a random action type based on weights
// instead of always asking Ollama (which defaults to "post" 90% of the time)
const ACTION_WEIGHTS: Record<string, number> = {
  post: 25,
  reply: 20,
  like: 15,
  respit: 10,
  follow: 10,
  attack: 8,
  buy_item: 4,
  bank_deposit: 3,
  bank_convert: 2,
  bank_stock: 1,
  bank_lottery: 1,
  open_chest: 1,
};

function pickWeightedAction(enabledActions: string[]): string | null {
  const available = enabledActions.filter((a) => a in ACTION_WEIGHTS);
  if (available.length === 0) return null;

  const weights = available.map((a) => ACTION_WEIGHTS[a] || 1);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * totalWeight;

  for (let i = 0; i < available.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return available[i];
  }
  return available[available.length - 1];
}

async function pickAndPlanAction(bot: BotWithConfig) {
  const enabled = bot.config?.enabled_actions || ["post", "reply", "like"];

  // 80% of the time: use weighted random pick + planSpecificAction
  // 20% of the time: let Ollama decide freely (for creative/unexpected actions)
  if (Math.random() < 0.8) {
    const actionType = pickWeightedAction(enabled);
    if (actionType) {
      return planSpecificAction(bot, actionType);
    }
  }

  return planAction(bot);
}

const TICK_INTERVAL = parseInt(process.env.SCHEDULER_TICK_INTERVAL || "600000", 10);
const CONCURRENCY = parseInt(process.env.SCHEDULER_CONCURRENCY || "5", 10);
const MAX_BATCH_PER_BOT = parseInt(process.env.SCHEDULER_MAX_BATCH || "1", 10);

class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: SchedulerState = {
    running: false,
    paused: false,
    lastTick: null,
    activeJobs: 0,
    totalProcessed: 0,
    errors: 0,
  };

  getState(): SchedulerState {
    return { ...this.state };
  }

  start() {
    if (this.state.running) return;

    this.state.running = true;
    this.state.paused = false;
    emitEvent("scheduler:start", {});

    // Run first tick immediately
    this.tick();

    // Then tick on interval
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);

    console.log(`[Scheduler] Started. Tick every ${TICK_INTERVAL / 1000}s, concurrency: ${CONCURRENCY}`);
  }

  stop() {
    if (!this.state.running) return;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.state.running = false;
    this.state.paused = false;
    emitEvent("scheduler:stop", {});

    console.log("[Scheduler] Stopped.");
  }

  pause() {
    this.state.paused = true;
  }

  resume() {
    this.state.paused = false;
  }

  private async tick() {
    if (this.state.paused) return;

    this.state.lastTick = new Date().toISOString();
    emitEvent("scheduler:tick", { time: this.state.lastTick });

    try {
      // 1. Process any existing pending jobs first
      await this.processPendingJobs();

      // 2. Check for bots that need new jobs scheduled
      await this.scheduleNewJobs();
    } catch (error) {
      console.error("[Scheduler] Tick error:", error);
      this.state.errors++;
    }
  }

  private async processPendingJobs() {
    // Process ALL ready pending jobs in waves of CONCURRENCY
    let processed = 0;

    while (true) {
      const now = new Date().toISOString();

      const { data: pendingJobs, error } = await supabase
        .from("bot_jobs")
        .select("*, bot:bots(user_id)")
        .eq("status", "pending")
        .lte("scheduled_for", now)
        .order("scheduled_for", { ascending: true })
        .limit(CONCURRENCY);

      if (error || !pendingJobs?.length) break;

      const promises = pendingJobs.map(async (job) => {
        const botUserId = (job.bot as unknown as { user_id: string })?.user_id || job.bot_id;
        this.state.activeJobs++;
        try {
          await executeJob(job as BotJob, botUserId);
          this.state.totalProcessed++;
        } catch (err) {
          console.error(`[Scheduler] Job ${job.id} failed:`, err);
          this.state.errors++;
        } finally {
          this.state.activeJobs--;
        }
      });

      await Promise.all(promises);
      processed += pendingJobs.length;

      // Safety: if we've processed a ton in one tick, yield
      if (processed >= 100) {
        console.log(`[Scheduler] Processed ${processed} jobs this tick, yielding rest to next tick`);
        break;
      }
    }
  }

  private async scheduleNewJobs() {
    // Get all active bots with configs
    const { data: bots, error } = await supabase
      .from("bots")
      .select("*, config:bot_configs(*)")
      .eq("is_active", true);

    if (error || !bots?.length) return;

    const now = new Date();
    const today = now.toISOString().split("T")[0];

    for (const row of bots) {
      const bot: BotWithConfig = {
        ...row,
        config: Array.isArray(row.config) ? row.config[0] || null : row.config,
      };

      try {
        // Check daily action count
        const { data: daily } = await supabase
          .from("bot_daily_actions")
          .select("actions_used")
          .eq("bot_id", bot.id)
          .eq("action_date", today)
          .single();

        const actionsUsed = daily?.actions_used || 0;
        const actionsRemaining = bot.action_frequency - actionsUsed;
        if (actionsRemaining <= 0) continue;

        // Count existing pending jobs so we don't double-schedule
        const { count: pendingCount } = await supabase
          .from("bot_jobs")
          .select("*", { count: "exact", head: true })
          .eq("bot_id", bot.id)
          .eq("status", "pending");

        const pending = pendingCount || 0;

        // Calculate how many actions should have happened by now
        // based on waking hours (8am-11pm)
        const expectedByNow = this.expectedActionsByNow(bot.action_frequency);
        const deficit = expectedByNow - actionsUsed - pending;

        // Schedule enough to catch up, capped at MAX_BATCH_PER_BOT per tick
        const toSchedule = Math.min(
          Math.max(deficit, pending === 0 ? 1 : 0), // at least 1 if no pending jobs
          MAX_BATCH_PER_BOT,
          actionsRemaining - pending
        );

        if (toSchedule <= 0) continue;

        console.log(
          `[Scheduler] ${bot.name}: ${actionsUsed} used, ${pending} pending, ${expectedByNow} expected by now → scheduling ${toSchedule} actions`
        );

        // Plan and schedule each action
        for (let i = 0; i < toSchedule; i++) {
          const action = await pickAndPlanAction(bot);

          const scheduledFor = this.calculateScheduleTime(
            actionsUsed + pending + i,
            bot.action_frequency
          );

          await supabase.from("bot_jobs").insert({
            bot_id: bot.id,
            action_type: action.action,
            action_payload: action.params,
            status: "pending",
            scheduled_for: scheduledFor.toISOString(),
          });

          emitEvent("job:created", {
            botId: bot.id,
            botName: bot.name,
            action: action.action,
            scheduledFor: scheduledFor.toISOString(),
          });
        }
      } catch (err) {
        console.error(`[Scheduler] Failed to plan for bot ${bot.name}:`, err);
        this.state.errors++;
      }
    }
  }

  /** How many actions should a bot have completed by now, based on full 24h day */
  private expectedActionsByNow(maxActions: number): number {
    const now = new Date();
    // Minutes elapsed since midnight
    const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
    const progress = minutesSinceMidnight / 1440; // 1440 = 24 * 60
    return Math.floor(maxActions * progress);
  }

  private calculateScheduleTime(actionIndex: number, maxActions: number): Date {
    // Spread actions evenly across full 24h day
    // e.g. 50 actions/day = one every 28.8 minutes
    const now = new Date();
    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);

    const intervalMs = (24 * 60 * 60 * 1000) / maxActions;
    const scheduled = new Date(todayMidnight.getTime() + intervalMs * actionIndex);

    // Add jitter (0-60s) so bots don't all fire at the exact same second
    scheduled.setTime(scheduled.getTime() + Math.random() * 60000);

    // If scheduled time is in the past, schedule for now + small random delay
    if (scheduled <= now) {
      scheduled.setTime(now.getTime() + Math.random() * 30000 + 5000);
    }

    return scheduled;
  }
}

// Singleton
export const scheduler = new Scheduler();
