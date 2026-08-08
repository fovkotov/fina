import { NextResponse } from "next/server";
import {
  bearer,
  getSummary,
  loadDb,
  requireSession,
  saveDb,
} from "@/lib/db";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const data = await loadDb();
    const auth = requireSession(data, bearer(req));
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const idx = data.transactions.findIndex(
      (t) => t.id === id && t.household_id === auth.session.household_id,
    );
    if (idx < 0) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    data.transactions.splice(idx, 1);
    await saveDb(data);
    return NextResponse.json({
      ok: true,
      summary: getSummary(data, auth.session.household_id),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
