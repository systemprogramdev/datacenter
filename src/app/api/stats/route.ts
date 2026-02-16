import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const today = new Date().toISOString().split("T")[0];

  const [botsRes, pendingRes, todayRes, sybilServersRes, sybilAliveRes, sybilJobsTodayRes] = await Promise.all([
    supabase.from("bots").select("id, is_active", { count: "exact", head: true }),
    supabase.from("bot_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("bot_jobs").select("id, status").gte("created_at", `${today}T00:00:00`),
    supabase.from("sybil_servers").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("sybil_bots").select("id", { count: "exact", head: true }).eq("is_alive", true),
    supabase.from("sybil_jobs").select("id, status").gte("created_at", `${today}T00:00:00`),
  ]);

  const totalBots = botsRes.count || 0;

  // Count active bots separately (head-only doesn't let us filter after)
  const { count: activeBots } = await supabase
    .from("bots")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  const todayJobs = todayRes.data || [];
  const sybilJobsToday = sybilJobsTodayRes.data || [];

  return NextResponse.json({
    success: true,
    data: {
      totalBots,
      activeBots: activeBots || 0,
      totalJobsToday: todayJobs.length,
      completedJobsToday: todayJobs.filter((j) => j.status === "completed").length,
      failedJobsToday: todayJobs.filter((j) => j.status === "failed").length,
      pendingJobs: pendingRes.count || 0,
      sybilServers: sybilServersRes.count || 0,
      sybilBotsAlive: sybilAliveRes.count || 0,
      sybilJobsToday: sybilJobsToday.filter((j) => j.status === "completed").length,
      sybilJobsFailed: sybilJobsToday.filter((j) => j.status === "failed").length,
    },
  });
}
