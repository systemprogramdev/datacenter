import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { spitrApi } from "@/lib/spitr-api";
import { generateName } from "@/lib/sybil-planner";

export async function GET() {
  // List all sybil servers with alive/total/deployed counts
  const { data: servers, error } = await supabase
    .from("sybil_servers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Get counts per server
  const result = await Promise.all(
    (servers || []).map(async (server) => {
      const [alive, total, deployed] = await Promise.all([
        supabase
          .from("sybil_bots")
          .select("*", { count: "exact", head: true })
          .eq("server_id", server.id)
          .eq("is_alive", true),
        supabase
          .from("sybil_bots")
          .select("*", { count: "exact", head: true })
          .eq("server_id", server.id),
        supabase
          .from("sybil_bots")
          .select("*", { count: "exact", head: true })
          .eq("server_id", server.id)
          .eq("is_deployed", true),
      ]);

      return {
        ...server,
        alive_count: alive.count || 0,
        total_count: total.count || 0,
        deployed_count: deployed.count || 0,
      };
    })
  );

  return NextResponse.json({ success: true, data: result });
}

export async function POST(req: Request) {
  const body = await req.json();
  const ownerUserId = body.owner_user_id;

  if (!ownerUserId) {
    return NextResponse.json(
      { success: false, error: "owner_user_id is required" },
      { status: 400 }
    );
  }

  // Check if owner already has an active server
  const { data: existing } = await supabase
    .from("sybil_servers")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .in("status", ["provisioning", "active"])
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { success: false, error: "Owner already has an active sybil server" },
      { status: 409 }
    );
  }

  // Attempt to purchase via spitr API (deduct 1000 gold)
  try {
    await spitrApi.purchaseSybilServer(ownerUserId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Purchase failed: ${msg}` },
      { status: 402 }
    );
  }

  // Create the sybil server
  const { data: server, error: serverError } = await supabase
    .from("sybil_servers")
    .insert({
      owner_user_id: ownerUserId,
      status: "provisioning",
      max_sybils: 50,
    })
    .select()
    .single();

  if (serverError || !server) {
    return NextResponse.json(
      { success: false, error: serverError?.message || "Failed to create server" },
      { status: 500 }
    );
  }

  // Generate 10 initial sybil names
  const sybils: { server_id: string; name: string; handle: string }[] = [];
  for (let i = 0; i < 10; i++) {
    try {
      const { name, handle } = await generateName();
      sybils.push({ server_id: server.id, name, handle });
    } catch (err) {
      console.error(`[SybilAPI] Failed to generate sybil name ${i}:`, err);
      // Generate a fallback name
      sybils.push({
        server_id: server.id,
        name: `Sybil ${i + 1}`,
        handle: `sybil_${Date.now()}_${i}`,
      });
    }
  }

  if (sybils.length > 0) {
    await supabase.from("sybil_bots").insert(sybils);
  }

  // Activate the server
  await supabase
    .from("sybil_servers")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", server.id);

  // Refetch with updated status
  const { data: fullServer } = await supabase
    .from("sybil_servers")
    .select("*")
    .eq("id", server.id)
    .single();

  return NextResponse.json(
    { success: true, data: { server: fullServer, sybils_created: sybils.length } },
    { status: 201 }
  );
}
