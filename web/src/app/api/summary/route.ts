import { NextResponse } from "next/server";
import { bearer, getSummary, loadDb, requireSession } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const data = await loadDb();
    const auth = requireSession(data, bearer(req));
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(getSummary(data, auth.session.household_id));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
