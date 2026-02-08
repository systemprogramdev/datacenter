import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { planSpecificAction } from "@/lib/planner";
import { createAndExecuteJob } from "@/lib/executor";
import type { BotWithConfig } from "@/lib/types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const actionType = body.action as string;

  if (!actionType) {
    return NextResponse.json(
      { success: false, error: "Missing 'action' field" },
      { status: 400 }
    );
  }

  // Fetch bot with config
  const { data, error } = await supabase
    .from("bots")
    .select("*, config:bot_configs(*)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: "Bot not found" },
      { status: 404 }
    );
  }

  const bot: BotWithConfig = {
    ...data,
    config: Array.isArray(data.config) ? data.config[0] || null : data.config,
  };

  try {
    const planned = await planSpecificAction(bot, actionType);
    const job = await createAndExecuteJob(bot.id, bot.user_id, planned);

    return NextResponse.json({ success: true, data: { planned, job } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
