import { NextResponse } from "next/server";
import { getPoolSize, refillPool } from "@/lib/sybil-name-pool";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const { total, available } = await getPoolSize();
    return NextResponse.json({
      success: true,
      data: { total, available, claimed: total - available },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body.count) || 20, 1), 100);

    const added = await refillPool(count);
    return NextResponse.json({ success: true, data: { added } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const { data } = await supabase
      .from("sybil_name_pool")
      .delete()
      .is("claimed_by", null)
      .select("id");

    const deleted = data?.length || 0;
    return NextResponse.json({ success: true, data: { deleted } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
