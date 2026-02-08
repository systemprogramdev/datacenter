import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const botId = searchParams.get("bot_id");
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  let query = supabase
    .from("bot_jobs")
    .select("*, bot:bots(name, handle)")
    .in("status", ["completed", "failed"])
    .order("completed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (botId) query = query.eq("bot_id", botId);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: data || [], count });
}
