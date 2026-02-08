import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const botId = searchParams.get("bot_id");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  let query = supabase
    .from("bot_jobs")
    .select("*, bot:bots(name, handle)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (botId) query = query.eq("bot_id", botId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: data || [] });
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
