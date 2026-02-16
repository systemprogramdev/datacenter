import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const botId = searchParams.get("bot_id");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  // Fetch bot_jobs
  let botQuery = supabase
    .from("bot_jobs")
    .select("*, bot:bots(name, handle)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) botQuery = botQuery.eq("status", status);
  if (botId) botQuery = botQuery.eq("bot_id", botId);

  const { data: botJobs, error } = await botQuery;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Fetch sybil_jobs (unless filtering by bot_id)
  let sybilJobs: Record<string, unknown>[] = [];
  if (!botId) {
    let sybilQuery = supabase
      .from("sybil_jobs")
      .select("*, sybil_bot:sybil_bots(name, handle)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) sybilQuery = sybilQuery.eq("status", status);

    const { data: sybilData } = await sybilQuery;
    if (sybilData) {
      sybilJobs = sybilData.map((j) => ({
        ...j,
        bot_id: j.sybil_bot_id,
        bot: j.sybil_bot,
        _source: "sybil",
      }));
    }
  }

  // Merge and sort by created_at descending
  const all = [...(botJobs || []), ...sybilJobs]
    .sort((a, b) => {
      const aTime = new Date(a.created_at as string).getTime();
      const bTime = new Date(b.created_at as string).getTime();
      return bTime - aTime;
    })
    .slice(0, limit);

  return NextResponse.json({ success: true, data: all });
}

export async function POST(req: Request) {
  const body = await req.json();

  const { data, error } = await supabase
    .from("bot_jobs")
    .insert({
      bot_id: body.bot_id,
      action_type: body.action_type,
      action_payload: body.action_payload || {},
      status: "pending",
      scheduled_for: body.scheduled_for || new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data }, { status: 201 });
}
