import { NextResponse } from "next/server";
import { ollama } from "@/lib/ollama";

export async function GET() {
  try {
    const connected = await ollama.isConnected();
    const models = connected ? await ollama.listModels() : [];

    return NextResponse.json({
      success: true,
      data: {
        connected,
        url: ollama.getBaseUrl(),
        model: ollama.getModel(),
        availableModels: models.map((m) => ({
          name: m.name,
          size: m.size,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: true,
      data: {
        connected: false,
        url: ollama.getBaseUrl(),
        model: ollama.getModel(),
        availableModels: [],
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
