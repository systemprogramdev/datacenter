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

function clampContent(text: unknown): string {
  let s = String(text || "");
  if (s.length > 540) s = s.slice(0, 537) + "...";
  return s;
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
      return spitrApi.useItem(botUserId, params.item_id as string);

    case "bank_deposit":
      return spitrApi.bankDeposit(botUserId, params.amount as number);

    case "bank_withdraw":
      return spitrApi.bankWithdraw(botUserId, params.amount as number);

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
          term: params.term as number,
          cdId: params.cd_id as string,
        }
      );

    default:
      throw new Error(`Unknown action type: ${actionType}`);
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
