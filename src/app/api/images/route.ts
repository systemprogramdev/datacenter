import { NextResponse } from "next/server";
import { exec } from "child_process";
import { spawn } from "child_process";

const IMAGE_SERVER = "http://localhost:8100";

async function proxyGet(path: string) {
  const res = await fetch(`${IMAGE_SERVER}${path}`, { cache: "no-store" });
  return res.json();
}

export async function GET() {
  try {
    const [health, stats, recent] = await Promise.all([
      proxyGet("/health"),
      proxyGet("/stats"),
      proxyGet("/recent?limit=20"),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        online: true,
        health,
        stats,
        recent_files: recent.files || [],
      },
    });
  } catch {
    return NextResponse.json({
      success: true,
      data: {
        online: false,
        health: null,
        stats: null,
        recent_files: [],
      },
    });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const action = body.action as string;

  try {
    switch (action) {
      case "unload": {
        const res = await fetch(`${IMAGE_SERVER}/unload`, { method: "POST" });
        const data = await res.json();
        return NextResponse.json({ success: true, data });
      }

      case "generate-test-avatar": {
        const res = await fetch(`${IMAGE_SERVER}/generate-avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test" }),
        });
        const data = await res.json();
        return NextResponse.json({ success: true, data });
      }

      case "generate-test-banner": {
        const res = await fetch(`${IMAGE_SERVER}/generate-banner`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test" }),
        });
        const data = await res.json();
        return NextResponse.json({ success: true, data });
      }

      case "clear-output": {
        const res = await fetch(`${IMAGE_SERVER}/clear-output`, { method: "POST" });
        const data = await res.json();
        return NextResponse.json({ success: true, data });
      }

      case "restart": {
        // Kill existing process on port 8100
        await new Promise<void>((resolve) => {
          exec("lsof -ti:8100 | xargs kill -9 2>/dev/null", () => resolve());
        });

        // Spawn new server detached
        const serverDir = process.cwd() + "/sybil-images";
        const child = spawn("python3", ["server.py"], {
          cwd: serverDir,
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        // Wait for server to come up
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Probe health
        try {
          const res = await fetch(`${IMAGE_SERVER}/health`, { cache: "no-store" });
          const health = await res.json();
          return NextResponse.json({ success: true, data: { restarted: true, health } });
        } catch {
          return NextResponse.json({ success: true, data: { restarted: true, health: null } });
        }
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
