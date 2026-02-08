import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("bots")
    .select("*, config:bot_configs(*)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Normalize config from array to single object
  const bots = (data || []).map((row) => ({
    ...row,
    config: Array.isArray(row.config) ? row.config[0] || null : row.config,
  }));

  return NextResponse.json({ success: true, data: bots });
}

export async function POST(req: Request) {
  const body = await req.json();

  const { data: bot, error: botError } = await supabase
    .from("bots")
    .insert({
      owner_id: body.owner_id,
      user_id: body.user_id,
      name: body.name,
      handle: body.handle,
      personality: body.personality || "neutral",
      action_frequency: body.action_frequency || 3,
      is_active: body.is_active ?? true,
    })
    .select()
    .single();

  if (botError || !bot) {
    return NextResponse.json(
      { success: false, error: botError?.message || "Failed to create bot" },
      { status: 500 }
    );
  }

  // Create default config
  const { error: configError } = await supabase.from("bot_configs").insert({
    bot_id: bot.id,
    enabled_actions: body.enabled_actions || [
      "post", "reply", "like", "respit", "attack",
      "bank_deposit", "buy_item", "open_chest",
    ],
    target_mode: body.target_mode || "random",
    combat_strategy: body.combat_strategy || "balanced",
    banking_strategy: body.banking_strategy || "conservative",
    auto_heal_threshold: body.auto_heal_threshold || 1000,
    custom_prompt: body.custom_prompt || null,
  });

  if (configError) {
    console.error("Failed to create bot config:", configError);
  }

  // Refetch with config
  const { data: fullBot } = await supabase
    .from("bots")
    .select("*, config:bot_configs(*)")
    .eq("id", bot.id)
    .single();

  return NextResponse.json({ success: true, data: fullBot }, { status: 201 });
}
