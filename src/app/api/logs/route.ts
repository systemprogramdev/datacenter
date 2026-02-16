import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const botId = searchParams.get("bot_id");
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  // Fetch bot_jobs
  let botQuery = supabase
    .from("bot_jobs")
    .select("*, bot:bots(name, handle)")
    .in("status", ["completed", "failed"])
    .order("completed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (botId) botQuery = botQuery.eq("bot_id", botId);

  const { data: botJobs, error: botError } = await botQuery;

  if (botError) {
    return NextResponse.json({ success: false, error: botError.message }, { status: 500 });
  }

  // Fetch sybil_jobs (unless filtering by bot_id — sybils use sybil_bot_id)
  let sybilJobs: Record<string, unknown>[] = [];
  if (!botId) {
    const { data: sybilData } = await supabase
      .from("sybil_jobs")
      .select("*, sybil_bot:sybil_bots(name, handle)")
      .in("status", ["completed", "failed"])
      .order("completed_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (sybilData) {
      // Normalize sybil_jobs to match bot_jobs shape for the UI
      sybilJobs = sybilData.map((j) => ({
        ...j,
        bot_id: j.sybil_bot_id,
        bot: j.sybil_bot,
        _source: "sybil",
      }));
    }
  }

  // Merge and sort by completed_at descending
  const all = [...(botJobs || []), ...sybilJobs]
    .sort((a, b) => {
      const aTime = a.completed_at ? new Date(a.completed_at as string).getTime() : 0;
      const bTime = b.completed_at ? new Date(b.completed_at as string).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);

  return NextResponse.json({ success: true, data: all, count: all.length });
}
