import { NextResponse } from "next/server";

const IMAGE_SERVER = "http://localhost:8100";

export async function GET() {
  try {
    const res = await fetch(`${IMAGE_SERVER}/styles`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ success: false, error: "Styles endpoint not available" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json(
      { success: false, error: "Image server unreachable" },
      { status: 502 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const res = await fetch(`${IMAGE_SERVER}/styles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: data.detail || "Failed to update styles" },
        { status: res.status }
      );
    }
    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json(
      { success: false, error: "Image server unreachable" },
      { status: 502 }
    );
  }
}
