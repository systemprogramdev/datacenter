import { supabase } from "./supabase";
import { spitrApi } from "./spitr-api";
import { emitEvent } from "./scheduler";
import {
  generateName,
  ensureResponseCache,
  getNextCachedResponse,
  cleanupUsedResponses,
} from "./sybil-planner";
import type { SybilBot, SybilServer } from "./types";

const SYBIL_IMAGE_URL = process.env.SYBIL_IMAGE_URL || "http://127.0.0.1:8100";
const SYBIL_TICK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_JOBS_PER_TICK = 20;
const JOB_GAP_MS = 15_000; // 15s between sybil job executions
const REACTION_BASE_DELAY = 30_000; // 30s base delay between sybil reactions
const REACTION_JITTER = 60_000; // 60s random jitter
const HEALTH_CHECK_BATCH = 5; // check this many sybils per tick

class SybilScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private ticking = false;

  start() {
    if (this.running) return;
    this.running = true;

    // First tick after a short delay (don't compete with main scheduler startup)
    setTimeout(() => this.tick(), 10_000);
    this.timer = setInterval(() => this.tick(), SYBIL_TICK_INTERVAL);

    console.log(`[SybilScheduler] Started. Tick every ${SYBIL_TICK_INTERVAL / 1000}s`);
  }

  stop() {
    if (!this.running) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log("[SybilScheduler] Stopped.");
  }

  isRunning(): boolean {
    return this.running;
  }

  private async tick() {
    if (this.ticking) return; // prevent overlapping ticks
    this.ticking = true;

    try {
      emitEvent("sybil:tick", { time: new Date().toISOString() });

      // Get all active sybil servers
      const { data: servers } = await supabase
        .from("sybil_servers")
        .select("*")
        .eq("status", "active");

      if (!servers || servers.length === 0) {
        this.ticking = false;
        return;
      }

      // Run all phases
      await this.dailyProduction(servers as SybilServer[]);
      await this.deployPendingSybils(servers as SybilServer[]);
      await this.checkOwnerPosts(servers as SybilServer[]);
      await this.processSybilJobs();
      await this.healthCheckSybils(servers as SybilServer[]);
      await cleanupUsedResponses();
    } catch (err) {
      console.error("[SybilScheduler] Tick error:", err);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Phase 1: Daily production — create one new sybil per server per day
   * if alive count is below max_sybils.
   */
  private async dailyProduction(servers: SybilServer[]) {
    const today = new Date().toISOString().split("T")[0];

    for (const server of servers) {
      try {
        // Check if we already created a sybil today for this server
        const { count: createdToday } = await supabase
          .from("sybil_bots")
          .select("*", { count: "exact", head: true })
          .eq("server_id", server.id)
          .gte("created_at", `${today}T00:00:00.000Z`);

        if ((createdToday || 0) > 0) continue;

        // Check alive count vs cap
        const { count: aliveCount } = await supabase
          .from("sybil_bots")
          .select("*", { count: "exact", head: true })
          .eq("server_id", server.id)
          .eq("is_alive", true);

        if ((aliveCount || 0) >= server.max_sybils) continue;

        // Generate a name and create the sybil (undeployed)
        const { name, handle } = await generateName();

        await supabase.from("sybil_bots").insert({
          server_id: server.id,
          name,
          handle,
          is_alive: true,
          is_deployed: false,
        });

        console.log(`[SybilScheduler] Created sybil "${name}" (@${handle}) for server ${server.id.slice(0, 8)}`);
      } catch (err) {
        console.error(`[SybilScheduler] Daily production failed for server ${server.id.slice(0, 8)}:`, err);
      }
    }
  }

  /**
   * Phase 2: Deploy pending sybils — generate images, create spitr account.
   * One at a time to avoid overloading the image service.
   */
  private async deployPendingSybils(servers: SybilServer[]) {
    const serverIds = servers.map((s) => s.id);

    // Find the oldest undeployed sybil across all active servers
    const { data: pending } = await supabase
      .from("sybil_bots")
      .select("*, server:sybil_servers(owner_user_id)")
      .in("server_id", serverIds)
      .eq("is_deployed", false)
      .eq("is_alive", true)
      .is("deploy_started_at", null)
      .order("created_at", { ascending: true })
      .limit(1);

    if (!pending || pending.length === 0) return;

    const sybil = pending[0];
    const ownerUserId = (sybil.server as unknown as { owner_user_id: string })?.owner_user_id;
    if (!ownerUserId) return;

    // Mark deploy started
    await supabase
      .from("sybil_bots")
      .update({ deploy_started_at: new Date().toISOString() })
      .eq("id", sybil.id);

    try {
      console.log(`[SybilScheduler] Deploying sybil "${sybil.name}" (@${sybil.handle})...`);

      // Generate avatar
      let avatarUrl: string | null = null;
      let bannerUrl: string | null = null;

      try {
        const avatarRes = await fetch(`${SYBIL_IMAGE_URL}/generate-avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: sybil.name }),
        });
        if (avatarRes.ok) {
          const avatarData = await avatarRes.json();
          const avatarPath = avatarData.path || avatarData.file_path;
          if (avatarPath) {
            // Read the generated file and upload to spitr
            const fs = await import("fs/promises");
            const imageBuffer = await fs.readFile(avatarPath);
            avatarUrl = await spitrApi.uploadSybilImage(
              new Uint8Array(imageBuffer),
              `sybil_avatar_${sybil.id}.png`
            );
          }
        }
      } catch (imgErr) {
        console.warn(`[SybilScheduler] Avatar generation failed for ${sybil.name}, continuing without:`, imgErr);
      }

      try {
        const bannerRes = await fetch(`${SYBIL_IMAGE_URL}/generate-banner`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: sybil.name }),
        });
        if (bannerRes.ok) {
          const bannerData = await bannerRes.json();
          const bannerPath = bannerData.path || bannerData.file_path;
          if (bannerPath) {
            const fs = await import("fs/promises");
            const imageBuffer = await fs.readFile(bannerPath);
            bannerUrl = await spitrApi.uploadSybilImage(
              new Uint8Array(imageBuffer),
              `sybil_banner_${sybil.id}.png`
            );
          }
        }
      } catch (imgErr) {
        console.warn(`[SybilScheduler] Banner generation failed for ${sybil.name}, continuing without:`, imgErr);
      }

      // Create the spitr account
      const result = await spitrApi.createSybilAccount(
        ownerUserId,
        sybil.name,
        sybil.handle,
        avatarUrl,
        bannerUrl
      );

      // Mark as deployed
      await supabase
        .from("sybil_bots")
        .update({
          user_id: result.user_id,
          avatar_url: avatarUrl,
          banner_url: bannerUrl,
          is_deployed: true,
          deployed_at: new Date().toISOString(),
        })
        .eq("id", sybil.id);

      console.log(`[SybilScheduler] Deployed sybil "${sybil.name}" → user_id: ${result.user_id}`);
      emitEvent("sybil:deployed", { sybilId: sybil.id, name: sybil.name, userId: result.user_id });
    } catch (err) {
      console.error(`[SybilScheduler] Deploy failed for sybil ${sybil.name}:`, err);
      // Reset deploy_started_at so it can be retried next tick
      await supabase
        .from("sybil_bots")
        .update({ deploy_started_at: null })
        .eq("id", sybil.id);
    }
  }

  /**
   * Phase 3: Check owner's recent posts for new content to react to.
   */
  private async checkOwnerPosts(servers: SybilServer[]) {
    for (const server of servers) {
      try {
        const spits = await spitrApi.getUserSpits(server.owner_user_id, 5);
        if (spits.length === 0) continue;

        const latestSpit = spits[0];

        // Skip if we already processed this spit
        if (server.last_owner_spit_id === latestSpit.id) continue;

        console.log(`[SybilScheduler] New owner post detected for server ${server.id.slice(0, 8)}: "${latestSpit.content.slice(0, 50)}..."`);

        // Get alive deployed sybils for this server
        const { data: sybils } = await supabase
          .from("sybil_bots")
          .select("*")
          .eq("server_id", server.id)
          .eq("is_alive", true)
          .eq("is_deployed", true);

        if (sybils && sybils.length > 0) {
          await this.scheduleSybilReactions(
            server.id,
            sybils as SybilBot[],
            latestSpit
          );
        }

        // Update last seen spit
        await supabase
          .from("sybil_servers")
          .update({
            last_owner_spit_id: latestSpit.id,
            last_owner_poll_at: new Date().toISOString(),
          })
          .eq("id", server.id);
      } catch (err) {
        console.error(`[SybilScheduler] Owner post check failed for server ${server.id.slice(0, 8)}:`, err);
      }
    }
  }

  /**
   * Schedule reactions from sybil bots to an owner's post.
   * Each sybil: guaranteed like, random reply/respit. Staggered timing.
   */
  private async scheduleSybilReactions(
    serverId: string,
    sybils: SybilBot[],
    spit: { id: string; content: string }
  ) {
    // Pre-generate response cache for replies
    await ensureResponseCache(serverId, spit.id, spit.content);

    const jobs: {
      server_id: string;
      sybil_bot_id: string;
      action_type: string;
      action_payload: Record<string, unknown>;
      status: string;
      scheduled_for: string;
    }[] = [];

    for (let i = 0; i < sybils.length; i++) {
      const sybil = sybils[i];
      const baseDelay = REACTION_BASE_DELAY * i + Math.random() * REACTION_JITTER;
      const scheduledFor = new Date(Date.now() + baseDelay).toISOString();

      // Guaranteed like
      jobs.push({
        server_id: serverId,
        sybil_bot_id: sybil.id,
        action_type: "like",
        action_payload: { spit_id: spit.id },
        status: "pending",
        scheduled_for: scheduledFor,
      });

      // 50% chance of reply
      if (Math.random() < 0.5) {
        const replyDelay = baseDelay + 5000 + Math.random() * 30000;
        jobs.push({
          server_id: serverId,
          sybil_bot_id: sybil.id,
          action_type: "reply",
          action_payload: { spit_id: spit.id },
          status: "pending",
          scheduled_for: new Date(Date.now() + replyDelay).toISOString(),
        });
      }

      // 30% chance of respit
      if (Math.random() < 0.3) {
        const respitDelay = baseDelay + 10000 + Math.random() * 60000;
        jobs.push({
          server_id: serverId,
          sybil_bot_id: sybil.id,
          action_type: "respit",
          action_payload: { spit_id: spit.id },
          status: "pending",
          scheduled_for: new Date(Date.now() + respitDelay).toISOString(),
        });
      }
    }

    if (jobs.length > 0) {
      await supabase.from("sybil_jobs").insert(jobs);
      console.log(`[SybilScheduler] Scheduled ${jobs.length} reaction jobs for spit ${spit.id.slice(0, 8)} across ${sybils.length} sybils`);
      emitEvent("sybil:reaction", { serverId, spitId: spit.id, jobCount: jobs.length, sybilCount: sybils.length });
    }
  }

  /**
   * Phase 5: Process pending sybil jobs. Max 20 per tick, 15s gap.
   */
  private async processSybilJobs() {
    let processed = 0;

    while (processed < MAX_JOBS_PER_TICK) {
      const now = new Date().toISOString();

      const { data: jobs } = await supabase
        .from("sybil_jobs")
        .select("*, sybil_bot:sybil_bots(user_id)")
        .eq("status", "pending")
        .lte("scheduled_for", now)
        .order("scheduled_for", { ascending: true })
        .limit(1);

      if (!jobs || jobs.length === 0) break;

      const job = jobs[0];
      const sybilUserId = (job.sybil_bot as unknown as { user_id: string | null })?.user_id;

      if (!sybilUserId) {
        // Sybil not yet deployed, mark as failed
        await supabase
          .from("sybil_jobs")
          .update({ status: "failed", error: "Sybil bot not deployed", completed_at: new Date().toISOString() })
          .eq("id", job.id);
        processed++;
        continue;
      }

      // Mark as running
      await supabase
        .from("sybil_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", job.id);

      try {
        let result: unknown;
        const spitId = job.action_payload?.spit_id as string;

        switch (job.action_type) {
          case "like":
            result = await spitrApi.like(sybilUserId, spitId);
            break;
          case "reply": {
            // Get cached response
            const responseText = await getNextCachedResponse(job.server_id, spitId);
            const content = responseText || "this";
            result = await spitrApi.reply(sybilUserId, spitId, content);
            break;
          }
          case "respit":
            result = await spitrApi.respit(sybilUserId, spitId);
            break;
          default:
            throw new Error(`Unknown sybil action: ${job.action_type}`);
        }

        await supabase
          .from("sybil_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            result: result as Record<string, unknown>,
          })
          .eq("id", job.id);

        emitEvent("sybil:job_completed", { jobId: job.id, action: job.action_type, sybilUserId });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await supabase
          .from("sybil_jobs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error: errorMsg,
          })
          .eq("id", job.id);

        emitEvent("sybil:job_failed", { jobId: job.id, action: job.action_type, error: errorMsg });
      }

      processed++;

      // Wait between jobs
      if (processed < MAX_JOBS_PER_TICK) {
        await new Promise((resolve) => setTimeout(resolve, JOB_GAP_MS));
      }
    }

    if (processed > 0) {
      console.log(`[SybilScheduler] Processed ${processed} sybil jobs this tick`);
    }
  }

  /**
   * Phase 6: Health check a batch of sybils — mark dead ones.
   */
  private async healthCheckSybils(servers: SybilServer[]) {
    const serverIds = servers.map((s) => s.id);

    const { data: sybils } = await supabase
      .from("sybil_bots")
      .select("id, user_id, server_id, name")
      .in("server_id", serverIds)
      .eq("is_alive", true)
      .eq("is_deployed", true)
      .not("user_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(HEALTH_CHECK_BATCH);

    if (!sybils || sybils.length === 0) return;

    for (const sybil of sybils) {
      try {
        const status = await spitrApi.getStatus(sybil.user_id!);
        const isDead = status.destroyed || status.hp === 0;

        if (isDead) {
          await supabase
            .from("sybil_bots")
            .update({
              is_alive: false,
              hp: 0,
              died_at: new Date().toISOString(),
            })
            .eq("id", sybil.id);

          console.log(`[SybilScheduler] Sybil "${sybil.name}" (${sybil.user_id}) died`);
          emitEvent("sybil:health_check", { sybilId: sybil.id, name: sybil.name, alive: false });
        } else {
          // Update HP
          await supabase
            .from("sybil_bots")
            .update({ hp: status.hp })
            .eq("id", sybil.id);
        }
      } catch (err) {
        console.warn(`[SybilScheduler] Health check failed for sybil ${sybil.name}:`, err);
      }
    }
  }
}

// Singleton
export const sybilScheduler = new SybilScheduler();
