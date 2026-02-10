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
  dm_send: 3,
  bank_convert: 2,
  bank_stock: 1,
  bank_lottery: 1,
  open_chest: 1,
  claim_chest: 1,
  consolidate: 0, // handled by priority chain, not random
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
    // Process jobs ONE AT A TIME with a 60-second gap to avoid flooding
    const JOB_GAP_MS = 60_000; // 1 minute between each job
    const MAX_PER_TICK = 10; // safety cap per tick
    let processed = 0;

    while (processed < MAX_PER_TICK) {
      const now = new Date().toISOString();

      const { data: pendingJobs, error } = await supabase
        .from("bot_jobs")
        .select("*, bot:bots(user_id)")
        .eq("status", "pending")
        .lte("scheduled_for", now)
        .order("scheduled_for", { ascending: true })
        .limit(1);

      if (error || !pendingJobs?.length) break;

      const job = pendingJobs[0];
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

      processed++;

      // Wait 60s before processing the next job (unless this was the last one)
      if (processed < MAX_PER_TICK) {
        const { count } = await supabase
          .from("bot_jobs")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending")
          .lte("scheduled_for", new Date().toISOString());
        if (!count || count <= 0) break;

        await new Promise((resolve) => setTimeout(resolve, JOB_GAP_MS));
      }
    }

    if (processed > 0) {
      console.log(`[Scheduler] Processed ${processed} jobs this tick (1 per minute)`);
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

        // Only schedule if there are no pending jobs (one at a time pacing)
        if (pending > 0) continue;

        // Check if it's time for the next action based on even spacing
        const nextSlot = this.nextActionSlot(actionsUsed, bot.action_frequency);
        const now2 = new Date();
        if (nextSlot > now2) continue; // not time yet

        const toSchedule = 1;

        console.log(
          `[Scheduler] ${bot.name}: ${actionsUsed}/${bot.action_frequency} used today, scheduling next action`
        );

        // Plan and schedule each action
        for (let i = 0; i < toSchedule; i++) {
          const action = await pickAndPlanAction(bot);

          // Skip if bot is destroyed (planner returns _skip flag)
          if ((action as unknown as Record<string, unknown>)._skip) {
            console.log(`[Scheduler] ${bot.name}: destroyed - skipping action`);
            break;
          }

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

  /** When is the next action allowed? Spread remaining actions across remaining time in day */
  private nextActionSlot(actionsUsed: number, maxActions: number): Date {
    const now = new Date();
    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);
    const endOfDay = new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000);

    const remaining = maxActions - actionsUsed;
    if (remaining <= 0) return endOfDay; // done for the day

    const msLeft = endOfDay.getTime() - now.getTime();
    if (msLeft <= 0) return endOfDay; // day is over

    // Space remaining actions evenly across remaining time
    const intervalMs = msLeft / remaining;

    // Next action = now + interval (wait one full interval before next action)
    return new Date(now.getTime() + intervalMs);
  }

  private calculateScheduleTime(_actionIndex: number, _maxActions: number): Date {
    // Schedule for now + small jitter (0-60s) so bots don't all fire simultaneously
    const now = new Date();
    return new Date(now.getTime() + Math.random() * 60000);
  }
}

// Singleton
export const scheduler = new Scheduler();
