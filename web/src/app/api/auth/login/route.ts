import { NextResponse } from "next/server";
import {
  getSummary,
  loadDb,
  newToken,
  saveDb,
  verifyPin,
} from "@/lib/db";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      inviteCode?: string;
      pin?: string;
      memberName?: string;
    };
    const inviteCode = (body.inviteCode ?? "").trim().toUpperCase();
    const pin = (body.pin ?? "").trim();
    const memberName = (body.memberName ?? "").trim();
    if (!inviteCode || !pin || !memberName) {
      return NextResponse.json(
        { error: "Нужны inviteCode, pin и memberName" },
        { status: 400 },
      );
    }

    const data = await loadDb();
    const household = data.households.find((h) => h.invite_code === inviteCode);
    if (!household || !verifyPin(pin, household.pin_hash)) {
      return NextResponse.json({ error: "Неверный код или PIN" }, { status: 401 });
    }
    const member = data.members.find(
      (m) => m.household_id === household.id && m.name === memberName,
    );
    if (!member) {
      return NextResponse.json(
        { error: "Участник не найден. Выбери Аня или Андрей" },
        { status: 404 },
      );
    }

    const token = newToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString();
    data.sessions = data.sessions.filter(
      (s) => new Date(s.expires_at).getTime() > Date.now(),
    );
    data.sessions.push({
      token,
      household_id: household.id,
      member_id: member.id,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    await saveDb(data);

    return NextResponse.json({
      token,
      expiresAt,
      household: {
        id: household.id,
        name: household.name,
        inviteCode: household.invite_code,
      },
      member: { id: member.id, name: member.name, accent: member.accent },
      summary: getSummary(data, household.id),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Login failed" },
      { status: 500 },
    );
  }
}
