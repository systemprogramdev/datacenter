import { supabase } from "./supabase";
import { spitrApi } from "./spitr-api";
import type { BotJob, ActionType, PlannedAction } from "./types";
import { emitEvent } from "./scheduler";

export async function executeJob(job: BotJob, botUserId: string): Promise<void> {
  // Mark job as running
  await supabase
    .from("bot_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", job.id);

  emitEvent("job:started", { jobId: job.id, botId: job.bot_id, action: job.action_type });

  try {
    const result = await executeAction(
      botUserId,
      job.action_type,
      job.action_payload
    );

    // Mark completed
    await supabase
      .from("bot_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        result: result as Record<string, unknown>,
      })
      .eq("id", job.id);

    // Update daily action count
    const today = new Date().toISOString().split("T")[0];
    await supabase.rpc("increment_daily_actions", {
      p_bot_id: job.bot_id,
      p_date: today,
    });

    // Notify owner on successful consolidation
    if (job.action_type === "consolidate" && result) {
      await notifyConsolidation(job.bot_id, botUserId, result as Record<string, unknown>);
    }

    emitEvent("job:completed", {
      jobId: job.id,
      botId: job.bot_id,
      action: job.action_type,
      result,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await supabase
      .from("bot_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: errorMsg,
      })
      .eq("id", job.id);

    emitEvent("job:failed", {
      jobId: job.id,
      botId: job.bot_id,
      action: job.action_type,
      error: errorMsg,
    });
  }
}

function clampDMContent(text: unknown): string {
  const s = String(text || "");
  if (s.length <= 2000) return s;
  const cut = s.slice(0, 2000);
  const lastSentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastSentence > 200) return cut.slice(0, lastSentence + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 200) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

function clampContent(text: unknown): string {
  let s = String(text || "");
  if (s.length <= 540) return s;
  // Cut to 540, then trim back to last sentence boundary
  const cut = s.slice(0, 540);
  const lastSentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf(".\n"), cut.lastIndexOf(".\""));
  if (lastSentence > 100) return cut.slice(0, lastSentence + 1).trim();
  // No sentence boundary — trim to last word boundary
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 100) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

async function executeAction(
  botUserId: string,
  actionType: ActionType,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (actionType) {
    case "post":
      return spitrApi.post(botUserId, clampContent(params.content));

    case "reply":
      return spitrApi.reply(
        botUserId,
        params.spit_id as string,
        clampContent(params.content)
      );

    case "like":
      return spitrApi.like(botUserId, params.spit_id as string);

    case "respit":
      return spitrApi.respit(botUserId, params.spit_id as string);

    case "attack":
      return spitrApi.attack(botUserId, params.target_id as string);

    case "use_item":
      return spitrApi.useItem(botUserId, params.item_type as string);

    case "bank_deposit":
      return spitrApi.bankDeposit(botUserId, params.amount as number);

    case "bank_withdraw":
      return spitrApi.bankWithdraw(botUserId, params.amount as number, (params.currency as "spit" | "gold") || "spit");

    case "buy_item":
      return spitrApi.buyItem(botUserId, params.item_type as string);

    case "open_chest":
      return spitrApi.openChest(botUserId);

    case "follow":
      return spitrApi.follow(botUserId, params.target_id as string);

    case "transfer":
      return spitrApi.transfer(
        botUserId,
        params.target_id as string,
        params.amount as number
      );

    case "bank_convert":
      return spitrApi.bankConvert(
        botUserId,
        params.direction as "spits_to_gold" | "gold_to_spits",
        params.amount as number
      );

    case "bank_stock":
      return spitrApi.bankStock(
        botUserId,
        params.action as "buy" | "sell",
        params.amount as number
      );

    case "bank_lottery": {
      const lotteryResult = await spitrApi.bankLottery(botUserId, params.ticket_type as string);
      // Auto-scratch the ticket immediately
      const ticketId = (lotteryResult as Record<string, unknown>)?.ticketId as string;
      if (ticketId) {
        const scratchResult = await spitrApi.bankScratch(botUserId, ticketId);
        return { lottery: lotteryResult, scratch: scratchResult };
      }
      return lotteryResult;
    }

    case "bank_scratch":
      return spitrApi.bankScratch(botUserId, params.ticket_id as string);

    case "bank_cd":
      return spitrApi.bankCd(
        botUserId,
        params.action as "buy" | "redeem",
        {
          amount: params.amount as number,
          termDays: params.term_days as number,
          currency: (params.currency as "spit" | "gold") || "spit",
          cdId: params.cd_id as string,
        }
      );

    case "dm_send":
      return spitrApi.sendDM(
        botUserId,
        params.target_user_id as string,
        clampDMContent(params.content)
      );

    case "claim_chest":
      return spitrApi.claimChest(botUserId);

    case "consolidate":
      return spitrApi.consolidate(botUserId, {
        spit_reserve: params.spit_reserve as number | undefined,
        gold_reserve: params.gold_reserve as number | undefined,
      });

    case "use_powerup":
      return spitrApi.usePowerup(botUserId, params.item_type as string);

    case "use_smoke_bomb":
      return spitrApi.useSmokeBomb(botUserId);

    case "use_fake_death":
      return spitrApi.useFakeDeath(botUserId);

    case "use_name_tag":
      return spitrApi.useNameTag(
        botUserId,
        params.target_user_id as string,
        params.custom_title as string
      );

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}

async function notifyConsolidation(botDbId: string, botUserId: string, result: Record<string, unknown>) {
  try {
    const spitsSent = Number(result.spits_sent) || 0;
    const goldSent = Number(result.gold_sent) || 0;
    if (spitsSent === 0 && goldSent === 0) {
      console.log(`[Executor] Consolidation returned zero transfers for bot ${botDbId} — owner likely hit receive limits`);
      return;
    }

    // Look up the bot's owner
    const { data: bot } = await supabase
      .from("bots")
      .select("name, owner_id")
      .eq("id", botDbId)
      .single();

    if (!bot?.owner_id || bot.owner_id === botUserId) return;

    const parts: string[] = [];
    if (spitsSent > 0) parts.push(`${spitsSent} spits`);
    if (goldSent > 0) parts.push(`${goldSent} gold`);

    const msg = `[consolidation] sent you ${parts.join(" + ")}`;

    await spitrApi.sendDM(botUserId, bot.owner_id, msg);
    console.log(`[Executor] ${bot.name} notified owner of consolidation: ${parts.join(" + ")}`);
  } catch (err) {
    console.error("[Executor] Failed to notify owner of consolidation:", err);
  }
}

// botId = bots.id (for DB), botUserId = bots.user_id (for spitr API)
export async function createAndExecuteJob(
  botId: string,
  botUserId: string,
  action: PlannedAction
): Promise<BotJob> {
  const { data: job, error } = await supabase
    .from("bot_jobs")
    .insert({
      bot_id: botId,
      action_type: action.action,
      action_payload: action.params,
      status: "pending",
      scheduled_for: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !job) {
    throw new Error(`Failed to create job: ${error?.message}`);
  }

  emitEvent("job:created", {
    jobId: job.id,
    botId,
    action: action.action,
  });

  await executeJob(job as BotJob, botUserId);
  return job as BotJob;
}
