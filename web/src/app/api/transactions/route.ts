import { NextResponse } from "next/server";
import {
  bearer,
  getSummary,
  loadDb,
  newId,
  requireSession,
  saveDb,
  type TxType,
} from "@/lib/db";

const TX_TYPES: TxType[] = [
  "deposit",
  "withdrawal",
  "interest",
  "cashback",
  "easy_money",
];

export async function GET(req: Request) {
  try {
    const data = await loadDb();
    const auth = requireSession(data, bearer(req));
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = data.transactions
      .filter((t) => t.household_id === auth.session.household_id)
      .sort(
        (a, b) =>
          new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
      )
      .map((t) => {
        const m = data.members.find((x) => x.id === t.member_id);
        const cb = data.members.find((x) => x.id === t.created_by);
        return {
          id: t.id,
          type: t.type,
          amountCents: t.amount_cents,
          note: t.note,
          occurredAt: t.occurred_at,
          createdAt: t.created_at,
          memberId: t.member_id,
          memberName: m?.name ?? null,
          memberAccent: m?.accent ?? null,
          createdByName: cb?.name ?? null,
        };
      });

    return NextResponse.json({ transactions: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const data = await loadDb();
    const auth = requireSession(data, bearer(req));
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as {
      type?: TxType;
      amountCents?: number;
      amount?: number;
      note?: string;
      memberId?: string | null;
      occurredAt?: string;
    };

    const type = body.type;
    if (!type || !TX_TYPES.includes(type)) {
      return NextResponse.json({ error: "Некорректный type" }, { status: 400 });
    }

    let amountCents = body.amountCents;
    if (amountCents == null && body.amount != null) {
      amountCents = Math.round(Number(body.amount) * 100);
    }
    if (!amountCents || amountCents <= 0) {
      return NextResponse.json(
        { error: "Сумма должна быть больше нуля" },
        { status: 400 },
      );
    }

    const needsMember = type === "deposit" || type === "withdrawal";
    let memberId = body.memberId ?? null;
    if (needsMember) {
      if (!memberId) memberId = auth.session.member_id;
      const member = data.members.find(
        (m) => m.id === memberId && m.household_id === auth.session.household_id,
      );
      if (!member) {
        return NextResponse.json({ error: "Участник не найден" }, { status: 400 });
      }
    } else {
      memberId = null;
    }

    const id = newId();
    const occurredAt = body.occurredAt
      ? new Date(body.occurredAt).toISOString()
      : new Date().toISOString();
    const created = {
      id,
      household_id: auth.session.household_id,
      member_id: memberId,
      type,
      amount_cents: amountCents,
      note: (body.note ?? "").trim(),
      occurred_at: occurredAt,
      created_by: auth.session.member_id,
      created_at: new Date().toISOString(),
    };
    data.transactions.push(created);
    await saveDb(data);

    const m = data.members.find((x) => x.id === created.member_id);
    const cb = data.members.find((x) => x.id === created.created_by);

    return NextResponse.json(
      {
        transaction: {
          id: created.id,
          type: created.type,
          amountCents: created.amount_cents,
          note: created.note,
          occurredAt: created.occurred_at,
          createdAt: created.created_at,
          memberId: created.member_id,
          memberName: m?.name ?? null,
          memberAccent: m?.accent ?? null,
          createdByName: cb?.name ?? null,
        },
        summary: getSummary(data, auth.session.household_id),
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
