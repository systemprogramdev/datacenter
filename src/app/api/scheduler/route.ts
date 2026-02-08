import { NextResponse } from "next/server";
import { scheduler } from "@/lib/scheduler";
import { spitrApi } from "@/lib/spitr-api";

export async function GET() {
  return NextResponse.json({
    success: true,
    data: { ...scheduler.getState(), dryRun: spitrApi.isDryRun() },
  });
}

export async function POST(req: Request) {
  const { action } = await req.json();

  switch (action) {
    case "start":
      scheduler.start();
      break;
    case "stop":
      scheduler.stop();
      break;
    case "pause":
      scheduler.pause();
      break;
    case "resume":
      scheduler.resume();
      break;
    default:
      return NextResponse.json(
        { success: false, error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }

  return NextResponse.json({ success: true, data: scheduler.getState() });
}
