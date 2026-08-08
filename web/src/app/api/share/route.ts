import { NextResponse } from "next/server";
import { bearer, loadDb, requireSession } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const data = await loadDb();
    const auth = requireSession(data, bearer(req));
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const household = data.households.find(
      (h) => h.id === auth.session.household_id,
    );
    if (!household) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const origin = new URL(req.url).origin;
    return NextResponse.json({
      householdName: household.name,
      inviteCode: household.invite_code,
      webUrl: `${origin}/?invite=${household.invite_code}`,
      members: ["Аня", "Андрей"],
      hint: "Открой ссылку, введи PIN и выбери своё имя",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
