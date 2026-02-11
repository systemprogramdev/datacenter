import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("bots")
    .select("*, config:bot_configs(*)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: error?.message || "Bot not found" },
      { status: 404 }
    );
  }

  const bot = {
    ...data,
    config: Array.isArray(data.config) ? data.config[0] || null : data.config,
  };

  return NextResponse.json({ success: true, data: bot });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  // Separate bot fields from config fields
  const botFields: Record<string, unknown> = {};
  const configFields: Record<string, unknown> = {};

  const botKeys = ["name", "handle", "personality", "action_frequency", "is_active"];
  const configKeys = [
    "enabled_actions", "target_mode", "target_users", "combat_strategy",
    "banking_strategy", "auto_heal_threshold", "custom_prompt",
  ];

  for (const [key, value] of Object.entries(body)) {
    if (botKeys.includes(key)) botFields[key] = value;
    if (configKeys.includes(key)) configFields[key] = value;
  }

  if (Object.keys(botFields).length > 0) {
    botFields.updated_at = new Date().toISOString();
    const { error } = await supabase.from("bots").update(botFields).eq("id", id);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  }

  if (Object.keys(configFields).length > 0) {
    configFields.updated_at = new Date().toISOString();
    // Use upsert to handle bots that may not have a config row yet
    const { error } = await supabase
      .from("bot_configs")
      .upsert({ bot_id: id, ...configFields }, { onConflict: "bot_id" });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  }

  // Refetch
  const { data } = await supabase
    .from("bots")
    .select("*, config:bot_configs(*)")
    .eq("id", id)
    .single();

  return NextResponse.json({
    success: true,
    data: data
      ? { ...data, config: Array.isArray(data.config) ? data.config[0] || null : data.config }
      : null,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { error } = await supabase.from("bots").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
