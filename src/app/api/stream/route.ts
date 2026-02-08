import { onEvent } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: { type: string; data: unknown; timestamp: string }) => {
        try {
          const payload = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream closed
        }
      };

      // Send initial heartbeat
      send({ type: "connected", data: {}, timestamp: new Date().toISOString() });

      // Subscribe to events
      const unsub = onEvent(send);

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", data: {}, timestamp: new Date().toISOString() });
      }, 30000);

      // Cleanup on close - using a polling approach since ReadableStream
      // cancel may not always fire immediately
      const checkClosed = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(""));
        } catch {
          clearInterval(checkClosed);
          clearInterval(heartbeat);
          unsub();
        }
      }, 60000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
