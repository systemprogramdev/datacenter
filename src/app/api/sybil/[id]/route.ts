import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get the server
  const { data: server, error } = await supabase
    .from("sybil_servers")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !server) {
    return NextResponse.json(
      { success: false, error: "Sybil server not found" },
      { status: 404 }
    );
  }

  // Get all sybils for this server
  const { data: sybils } = await supabase
    .from("sybil_bots")
    .select("*")
    .eq("server_id", id)
    .order("created_at", { ascending: true });

  // Get recent jobs (last 50)
  const { data: recentJobs } = await supabase
    .from("sybil_jobs")
    .select("*")
    .eq("server_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  // Compute stats
  const allSybils = sybils || [];
  const stats = {
    total: allSybils.length,
    alive: allSybils.filter((s) => s.is_alive).length,
    deployed: allSybils.filter((s) => s.is_deployed).length,
    dead: allSybils.filter((s) => !s.is_alive).length,
    pending_deploy: allSybils.filter((s) => !s.is_deployed && s.is_alive).length,
  };

  // Job stats
  const jobs = recentJobs || [];
  const jobStats = {
    total: jobs.length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    pending: jobs.filter((j) => j.status === "pending").length,
  };

  return NextResponse.json({
    success: true,
    data: {
      server,
      sybils: allSybils,
      recent_jobs: jobs,
      stats,
      job_stats: jobStats,
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Verify server exists
  const { data: server } = await supabase
    .from("sybil_servers")
    .select("id, status")
    .eq("id", id)
    .single();

  if (!server) {
    return NextResponse.json(
      { success: false, error: "Sybil server not found" },
      { status: 404 }
    );
  }

  // Suspend the server
  const { error } = await supabase
    .from("sybil_servers")
    .update({ status: "suspended", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  // Cancel all pending jobs
  await supabase
    .from("sybil_jobs")
    .update({ status: "failed", error: "Server suspended", completed_at: new Date().toISOString() })
    .eq("server_id", id)
    .eq("status", "pending");

  return NextResponse.json({ success: true, data: { status: "suspended" } });
}
