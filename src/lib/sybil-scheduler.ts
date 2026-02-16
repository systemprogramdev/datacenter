import { supabase } from "./supabase";
import { spitrApi } from "./spitr-api";
import { emitEvent } from "./scheduler";
import {
  generateName,
  ensureResponseCache,
  getNextCachedResponse,
  cleanupUsedResponses,
} from "./sybil-planner";
import { getPoolSize, refillPool } from "./sybil-name-pool";
import type { SybilBot, SybilServer } from "./types";

const SYBIL_IMAGE_URL = process.env.SYBIL_IMAGE_URL || "http://127.0.0.1:8100";
const SYBIL_TICK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_JOBS_PER_TICK = 20;
const JOB_GAP_MS = 15_000; // 15s between sybil job executions
const REACTION_BASE_DELAY = 30_000; // 30s base delay between sybil reactions
const REACTION_JITTER = 60_000; // 60s random jitter
const HEALTH_CHECK_BATCH = 5; // check this many sybils per tick
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [30_000, 60_000, 120_000]; // 30s, 60s, 2m

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
      await this.cleanupDeadSybils(servers as SybilServer[]);
      await this.replenishSybils(servers as SybilServer[]);
      await this.deployPendingSybils(servers as SybilServer[]);
      await this.repairMissingImages(servers as SybilServer[]);
      await this.checkOwnerPosts(servers as SybilServer[]);
      await this.processSybilJobs();
      await this.healthCheckSybils(servers as SybilServer[]);
      await cleanupUsedResponses();
      await this.refillNamePool();
    } catch (err) {
      console.error("[SybilScheduler] Tick error:", err);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Phase 0: Delete dead sybils and their failed jobs.
   */
  private async cleanupDeadSybils(servers: SybilServer[]) {
    const serverIds = servers.map((s) => s.id);

    const { data: dead } = await supabase
      .from("sybil_bots")
      .select("id, name, server_id")
      .in("server_id", serverIds)
      .eq("is_alive", false);

    if (!dead || dead.length === 0) return;

    // Delete jobs first (FK constraint), then the bots
    const deadIds = dead.map((d) => d.id);
    await supabase.from("sybil_jobs").delete().in("sybil_bot_id", deadIds);
    await supabase.from("sybil_bots").delete().in("id", deadIds);

    console.log(`[SybilScheduler] Cleaned up ${dead.length} dead sybils`);
  }

  /**
   * Phase 1: Replenish sybils — create one new sybil per server per hour
   * if alive count is below max_sybils.
   */
  private async replenishSybils(servers: SybilServer[]) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    for (const server of servers) {
      try {
        // Check if we already created a sybil in the last hour for this server
        const { count: createdRecently } = await supabase
          .from("sybil_bots")
          .select("*", { count: "exact", head: true })
          .eq("server_id", server.id)
          .gte("created_at", oneHourAgo);

        if ((createdRecently || 0) > 0) continue;

        // Check alive count vs cap
        const { count: aliveCount } = await supabase
          .from("sybil_bots")
          .select("*", { count: "exact", head: true })
          .eq("server_id", server.id)
          .eq("is_alive", true);

        if ((aliveCount || 0) >= server.max_sybils) continue;

        // Generate a name and create the sybil (undeployed)
        let created = false;
        for (let attempt = 0; attempt < 3 && !created; attempt++) {
          const { name, handle } = await generateName();

          const { error: insertErr } = await supabase.from("sybil_bots").insert({
            server_id: server.id,
            name,
            handle,
            is_alive: true,
            is_deployed: false,
          });

          if (insertErr) {
            if (insertErr.code === "23505") {
              console.warn(`[SybilScheduler] Duplicate handle "${handle}", retrying...`);
              continue;
            }
            throw insertErr;
          }

          created = true;
          console.log(`[SybilScheduler] Replenished sybil "${name}" (@${handle}) for server ${server.id.slice(0, 8)} (alive: ${aliveCount}/${server.max_sybils})`);
        }
      } catch (err) {
        console.error(`[SybilScheduler] Replenish failed for server ${server.id.slice(0, 8)}:`, err);
      }
    }
  }

  /**
   * Phase 2: Deploy pending sybils — generate images, create spitr account.
   * One at a time to avoid overloading the image service.
   */
  private async deployPendingSybils(servers: SybilServer[]) {
    const serverIds = servers.map((s) => s.id);

    // Atomic claim: update deploy_started_at and return the row in one query
    // This prevents race conditions where two ticks grab the same sybil
    const now = new Date().toISOString();

    // First find a candidate
    const { data: candidates } = await supabase
      .from("sybil_bots")
      .select("id")
      .in("server_id", serverIds)
      .eq("is_deployed", false)
      .eq("is_alive", true)
      .is("deploy_started_at", null)
      .order("created_at", { ascending: true })
      .limit(1);

    if (!candidates || candidates.length === 0) return;

    // Atomic claim: only succeeds if deploy_started_at is still null
    const { data: claimed } = await supabase
      .from("sybil_bots")
      .update({ deploy_started_at: now })
      .eq("id", candidates[0].id)
      .is("deploy_started_at", null)
      .select("*, server:sybil_servers(owner_user_id)");

    if (!claimed || claimed.length === 0) {
      console.log("[SybilScheduler] Deploy claim race lost, skipping");
      return;
    }

    const sybil = claimed[0];
    const ownerUserId = (sybil.server as unknown as { owner_user_id: string })?.owner_user_id;
    if (!ownerUserId) return;

    try {
      console.log(`[SybilScheduler] Deploying sybil "${sybil.name}" (@${sybil.handle})...`);

      // Step 1: Create the spitr account FIRST (no images yet)
      const result = await spitrApi.createSybilAccount(
        ownerUserId,
        sybil.name,
        sybil.handle,
        null,
        null
      );

      const userId = result.user_id;
      console.log(`[SybilScheduler] Account created: ${userId}`);

      // Step 2: Generate + upload images AFTER account exists, with user_id
      let avatarUrl: string | null = null;
      let bannerUrl: string | null = null;
      const fs = await import("fs/promises");

      try {
        console.log(`[SybilScheduler] Generating avatar for "${sybil.name}"...`);
        const avatarRes = await fetch(`${SYBIL_IMAGE_URL}/generate-avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: sybil.name + "_" + sybil.id }),
        });
        if (avatarRes.ok) {
          const avatarData = await avatarRes.json();
          const avatarPath = avatarData.path || avatarData.file_path;
          if (avatarPath) {
            const imageBuffer = await fs.readFile(avatarPath);
            console.log(`[SybilScheduler] Uploading avatar (${imageBuffer.length} bytes) for user ${userId}...`);
            avatarUrl = await spitrApi.uploadSybilImage(
              new Uint8Array(imageBuffer),
              `sybil_avatar_${sybil.id}.png`,
              userId,
              "avatar"
            );
            console.log(`[SybilScheduler] Avatar uploaded: ${avatarUrl}`);
          }
        } else {
          console.warn(`[SybilScheduler] Avatar generation HTTP ${avatarRes.status}: ${await avatarRes.text()}`);
        }
      } catch (imgErr) {
        console.error(`[SybilScheduler] Avatar failed for ${sybil.name}:`, imgErr);
      }

      try {
        console.log(`[SybilScheduler] Generating banner for "${sybil.name}"...`);
        const bannerRes = await fetch(`${SYBIL_IMAGE_URL}/generate-banner`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: sybil.name + "_" + sybil.id }),
        });
        if (bannerRes.ok) {
          const bannerData = await bannerRes.json();
          const bannerPath = bannerData.path || bannerData.file_path;
          if (bannerPath) {
            const imageBuffer = await fs.readFile(bannerPath);
            console.log(`[SybilScheduler] Uploading banner (${imageBuffer.length} bytes) for user ${userId}...`);
            bannerUrl = await spitrApi.uploadSybilImage(
              new Uint8Array(imageBuffer),
              `sybil_banner_${sybil.id}.png`,
              userId,
              "banner"
            );
            console.log(`[SybilScheduler] Banner uploaded: ${bannerUrl}`);
          }
        } else {
          console.warn(`[SybilScheduler] Banner generation HTTP ${bannerRes.status}: ${await bannerRes.text()}`);
        }
      } catch (imgErr) {
        console.error(`[SybilScheduler] Banner failed for ${sybil.name}:`, imgErr);
      }

      // Step 3: Update spitr profile with image URLs
      if (avatarUrl || bannerUrl) {
        try {
          const profileUpdates: { avatar_url?: string; banner_url?: string } = {};
          if (avatarUrl) profileUpdates.avatar_url = avatarUrl;
          if (bannerUrl) profileUpdates.banner_url = bannerUrl;
          await spitrApi.updateSybilProfile(userId, profileUpdates);
          console.log(`[SybilScheduler] Profile updated for ${userId}: avatar=${!!avatarUrl}, banner=${!!bannerUrl}`);
        } catch (profileErr) {
          console.error(`[SybilScheduler] Profile update failed for ${sybil.name}:`, profileErr);
          // Non-fatal — sybil still gets deployed, just without images on spitr side
        }
      }

      // Mark as deployed
      await supabase
        .from("sybil_bots")
        .update({
          user_id: userId,
          avatar_url: avatarUrl || null,
          banner_url: bannerUrl || null,
          is_deployed: true,
          deployed_at: new Date().toISOString(),
        })
        .eq("id", sybil.id);

      console.log(`[SybilScheduler] Deployed sybil "${sybil.name}" → user_id: ${userId}, avatar: ${!!avatarUrl}, banner: ${!!bannerUrl}`);
      emitEvent("sybil:deployed", { sybilId: sybil.id, name: sybil.name, userId });
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
   * Phase 2b: Repair deployed sybils missing avatar or banner.
   * Retries image generation + upload + spitr profile update.
   * Processes one sybil per tick to avoid overloading the image service.
   */
  private async repairMissingImages(servers: SybilServer[]) {
    const serverIds = servers.map((s) => s.id);

    // Find deployed sybils with missing avatar OR banner
    const { data: broken } = await supabase
      .from("sybil_bots")
      .select("*, server:sybil_servers(owner_user_id)")
      .in("server_id", serverIds)
      .eq("is_deployed", true)
      .eq("is_alive", true)
      .not("user_id", "is", null)
      .or("avatar_url.is.null,banner_url.is.null")
      .order("deployed_at", { ascending: true })
      .limit(1);

    if (!broken || broken.length === 0) return;

    const sybil = broken[0];
    const userId = sybil.user_id!;
    const missingAvatar = !sybil.avatar_url;
    const missingBanner = !sybil.banner_url;

    console.log(
      `[SybilScheduler] Repairing images for "${sybil.name}" (${userId}): avatar=${missingAvatar ? "MISSING" : "ok"}, banner=${missingBanner ? "MISSING" : "ok"}`
    );

    const fs = await import("fs/promises");
    let avatarUrl: string | null = sybil.avatar_url;
    let bannerUrl: string | null = sybil.banner_url;

    // Retry avatar if missing
    if (missingAvatar) {
      try {
        const avatarRes = await fetch(`${SYBIL_IMAGE_URL}/generate-avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: sybil.name + "_" + sybil.id }),
        });
        if (avatarRes.ok) {
          const avatarData = await avatarRes.json();
          const avatarPath = avatarData.path || avatarData.file_path;
          if (avatarPath) {
            const imageBuffer = await fs.readFile(avatarPath);
            avatarUrl = await spitrApi.uploadSybilImage(
              new Uint8Array(imageBuffer),
              `sybil_avatar_${sybil.id}.png`,
              userId,
              "avatar"
            );
            console.log(`[SybilScheduler] Avatar repaired for "${sybil.name}": ${avatarUrl}`);
          }
        } else {
          console.warn(`[SybilScheduler] Avatar repair gen failed HTTP ${avatarRes.status}`);
        }
      } catch (err) {
        console.error(`[SybilScheduler] Avatar repair failed for "${sybil.name}":`, err);
      }
    }

    // Retry banner if missing
    if (missingBanner) {
      try {
        const bannerRes = await fetch(`${SYBIL_IMAGE_URL}/generate-banner`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: sybil.name + "_" + sybil.id }),
        });
        if (bannerRes.ok) {
          const bannerData = await bannerRes.json();
          const bannerPath = bannerData.path || bannerData.file_path;
          if (bannerPath) {
            const imageBuffer = await fs.readFile(bannerPath);
            bannerUrl = await spitrApi.uploadSybilImage(
              new Uint8Array(imageBuffer),
              `sybil_banner_${sybil.id}.png`,
              userId,
              "banner"
            );
            console.log(`[SybilScheduler] Banner repaired for "${sybil.name}": ${bannerUrl}`);
          }
        } else {
          console.warn(`[SybilScheduler] Banner repair gen failed HTTP ${bannerRes.status}`);
        }
      } catch (err) {
        console.error(`[SybilScheduler] Banner repair failed for "${sybil.name}":`, err);
      }
    }

    // Update spitr profile if we got new images
    const newAvatar = missingAvatar && avatarUrl;
    const newBanner = missingBanner && bannerUrl;
    if (newAvatar || newBanner) {
      try {
        const profileUpdates: { avatar_url?: string; banner_url?: string } = {};
        if (newAvatar) profileUpdates.avatar_url = avatarUrl!;
        if (newBanner) profileUpdates.banner_url = bannerUrl!;
        await spitrApi.updateSybilProfile(userId, profileUpdates);
        console.log(`[SybilScheduler] Profile repaired for "${sybil.name}"`);
      } catch (err) {
        console.error(`[SybilScheduler] Profile repair update failed for "${sybil.name}":`, err);
      }
    }

    // Update local DB with whatever we got
    const dbUpdate: Record<string, unknown> = {};
    if (missingAvatar && avatarUrl) dbUpdate.avatar_url = avatarUrl;
    if (missingBanner && bannerUrl) dbUpdate.banner_url = bannerUrl;

    if (Object.keys(dbUpdate).length > 0) {
      await supabase.from("sybil_bots").update(dbUpdate).eq("id", sybil.id);
      emitEvent("sybil:image_repaired", {
        sybilId: sybil.id,
        name: sybil.name,
        repairedAvatar: !!dbUpdate.avatar_url,
        repairedBanner: !!dbUpdate.banner_url,
      });
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

        // Get alive deployed sybils for this server (must have a valid user_id)
        const { data: sybils } = await supabase
          .from("sybil_bots")
          .select("*")
          .eq("server_id", server.id)
          .eq("is_alive", true)
          .eq("is_deployed", true)
          .not("user_id", "is", null);

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
        .select("*, sybil_bot:sybil_bots(user_id, is_alive)")
        .eq("status", "pending")
        .lte("scheduled_for", now)
        .order("scheduled_for", { ascending: true })
        .limit(1);

      if (!jobs || jobs.length === 0) break;

      const job = jobs[0];
      const sybilBot = job.sybil_bot as unknown as { user_id: string | null; is_alive: boolean } | null;
      const sybilUserId = sybilBot?.user_id;
      const retryCount = (job.retry_count as number) || 0;

      // Skip jobs for bots that aren't deployed yet
      if (!sybilUserId) {
        await supabase
          .from("sybil_jobs")
          .update({ status: "failed", error: "Sybil bot not deployed", completed_at: now })
          .eq("id", job.id);
        processed++;
        continue;
      }

      // Skip jobs for dead bots
      if (sybilBot && !sybilBot.is_alive) {
        await supabase
          .from("sybil_jobs")
          .update({ status: "failed", error: "Sybil bot is dead", completed_at: now })
          .eq("id", job.id);
        processed++;
        continue;
      }

      // Mark as running
      await supabase
        .from("sybil_jobs")
        .update({ status: "running", started_at: now })
        .eq("id", job.id);

      try {
        let result: unknown;
        const spitId = job.action_payload?.spit_id as string;

        switch (job.action_type) {
          case "like":
            result = await spitrApi.like(sybilUserId, spitId);
            break;
          case "reply": {
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

        if (retryCount < MAX_RETRIES) {
          // Reschedule with backoff
          const backoff = RETRY_BACKOFF[retryCount] || 120_000;
          const retryAt = new Date(Date.now() + backoff).toISOString();
          await supabase
            .from("sybil_jobs")
            .update({
              status: "pending",
              retry_count: retryCount + 1,
              scheduled_for: retryAt,
              error: `Retry ${retryCount + 1}/${MAX_RETRIES}: ${errorMsg}`,
            })
            .eq("id", job.id);

          console.log(`[SybilScheduler] Job ${job.id.slice(0, 8)} failed (${job.action_type}), retry ${retryCount + 1}/${MAX_RETRIES} in ${backoff / 1000}s: ${errorMsg}`);
        } else {
          // Max retries reached — permanent failure
          await supabase
            .from("sybil_jobs")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              error: `Failed after ${MAX_RETRIES} retries: ${errorMsg}`,
            })
            .eq("id", job.id);

          console.log(`[SybilScheduler] Job ${job.id.slice(0, 8)} permanently failed (${job.action_type}) after ${MAX_RETRIES} retries: ${errorMsg}`);
          emitEvent("sybil:job_failed", { jobId: job.id, action: job.action_type, error: errorMsg });
        }
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
   * Refill the name pool — keep at least 50 names ready at all times.
   */
  private async refillNamePool() {
    try {
      const { available } = await getPoolSize();

      if (available < 50) {
        const needed = 50 - available;
        console.log(`[SybilScheduler] Name pool low (${available}), refilling ${needed}...`);
        const added = await refillPool(needed);
        console.log(`[SybilScheduler] Pool refilled with ${added} names (pool now ~${available + added})`);
      }
    } catch (err) {
      console.warn("[SybilScheduler] Name pool refill failed:", err);
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
          // Cancel any pending jobs for this dead sybil
          await supabase
            .from("sybil_jobs")
            .update({ status: "failed", error: "Sybil died" })
            .eq("sybil_bot_id", sybil.id)
            .eq("status", "pending");

          await supabase
            .from("sybil_bots")
            .update({
              is_alive: false,
              hp: 0,
              died_at: new Date().toISOString(),
            })
            .eq("id", sybil.id);

          console.log(`[SybilScheduler] Sybil "${sybil.name}" (${sybil.user_id}) died — pending jobs cancelled`);
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
