import {
  bearer,
  getSummary,
  loadDb,
  newId,
  newToken,
  requireSession,
  saveDb,
  verifyPin,
  type DbData,
  type Env,
  type TxType,
} from "./db";

const TX_TYPES: TxType[] = ["deposit", "withdrawal", "interest", "cashback"];

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allowOrigin =
    allowed.length === 0 || allowed.includes(origin) ? origin || "*" : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  req: Request,
  env: Env,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(req, env),
    },
  });
}

async function authorize(req: Request, env: Env) {
  const data = await loadDb(env);
  const auth = requireSession(data, bearer(req));
  return { data, auth };
}

function serializeTx(data: DbData, tx: DbData["transactions"][number]) {
  const member = data.members.find((x) => x.id === tx.member_id);
  const createdBy = data.members.find((x) => x.id === tx.created_by);
  return {
    id: tx.id,
    type: tx.type,
    amountCents: tx.amount_cents,
    note: tx.note,
    occurredAt: tx.occurred_at,
    createdAt: tx.created_at,
    memberId: tx.member_id,
    memberName: member?.name ?? null,
    memberAccent: member?.accent ?? null,
    createdByName: createdBy?.name ?? null,
  };
}

async function login(req: Request, env: Env) {
  const body = (await req.json()) as {
    inviteCode?: string;
    pin?: string;
    memberName?: string;
  };
  const inviteCode = (body.inviteCode ?? "").trim().toUpperCase();
  const pin = (body.pin ?? "").trim();
  const memberName = (body.memberName ?? "").trim();
  if (!inviteCode || !pin || !memberName) {
    return json(req, env, { error: "Нужны inviteCode, pin и memberName" }, 400);
  }

  const data = await loadDb(env);
  const household = data.households.find((h) => h.invite_code === inviteCode);
  if (!household || !(await verifyPin(pin, household.pin_hash))) {
    return json(req, env, { error: "Неверный код или PIN" }, 401);
  }
  const member = data.members.find(
    (m) => m.household_id === household.id && m.name === memberName,
  );
  if (!member) {
    return json(req, env, { error: "Участник не найден. Выбери Аня или Андрей" }, 404);
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
  await saveDb(env, data);

  return json(req, env, {
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
}

async function createTransaction(req: Request, env: Env) {
  const { data, auth } = await authorize(req, env);
  if (!auth) return json(req, env, { error: "Unauthorized" }, 401);

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
    return json(req, env, { error: "Некорректный type" }, 400);
  }

  let amountCents = body.amountCents;
  if (amountCents == null && body.amount != null) {
    amountCents = Math.round(Number(body.amount) * 100);
  }
  if (!amountCents || amountCents <= 0) {
    return json(req, env, { error: "Сумма должна быть больше нуля" }, 400);
  }

  const needsMember = type === "deposit" || type === "withdrawal";
  let memberId = body.memberId ?? null;
  if (needsMember) {
    if (!memberId) memberId = auth.session.member_id;
    const member = data.members.find(
      (m) => m.id === memberId && m.household_id === auth.session.household_id,
    );
    if (!member) return json(req, env, { error: "Участник не найден" }, 400);
  } else {
    memberId = null;
  }

  const created = {
    id: newId(),
    household_id: auth.session.household_id,
    member_id: memberId,
    type,
    amount_cents: amountCents,
    note: (body.note ?? "").trim(),
    occurred_at: body.occurredAt
      ? new Date(body.occurredAt).toISOString()
      : new Date().toISOString(),
    created_by: auth.session.member_id,
    created_at: new Date().toISOString(),
  };
  data.transactions.push(created);
  await saveDb(env, data);

  return json(
    req,
    env,
    {
      transaction: serializeTx(data, created),
      summary: getSummary(data, auth.session.household_id),
    },
    201,
  );
}

async function updateTransaction(req: Request, env: Env, id: string) {
  const { data, auth } = await authorize(req, env);
  if (!auth) return json(req, env, { error: "Unauthorized" }, 401);

  const tx = data.transactions.find(
    (t) => t.id === id && t.household_id === auth.session.household_id,
  );
  if (!tx) return json(req, env, { error: "Не найдено" }, 404);

  const body = (await req.json()) as {
    type?: TxType;
    amountCents?: number;
    amount?: number;
    note?: string;
    memberId?: string | null;
    occurredAt?: string;
  };

  if (body.type !== undefined) {
    if (!TX_TYPES.includes(body.type)) {
      return json(req, env, { error: "Некорректный type" }, 400);
    }
    tx.type = body.type;
  }

  let amountCents = body.amountCents;
  if (amountCents == null && body.amount != null) {
    amountCents = Math.round(Number(body.amount) * 100);
  }
  if (amountCents != null) {
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return json(req, env, { error: "Сумма должна быть больше нуля" }, 400);
    }
    tx.amount_cents = Math.round(amountCents);
  }

  if (body.note !== undefined) tx.note = (body.note ?? "").trim();

  if (body.occurredAt !== undefined) {
    const date = new Date(body.occurredAt);
    if (Number.isNaN(date.getTime())) {
      return json(req, env, { error: "Некорректная дата" }, 400);
    }
    tx.occurred_at = date.toISOString();
  }

  // Участник нужен только внесениям и списаниям; у начислений он всегда пустой.
  if (tx.type === "deposit" || tx.type === "withdrawal") {
    const memberId = body.memberId !== undefined ? body.memberId : tx.member_id;
    const member = data.members.find(
      (m) => m.id === memberId && m.household_id === auth.session.household_id,
    );
    if (!member) return json(req, env, { error: "Участник не найден" }, 400);
    tx.member_id = member.id;
  } else {
    tx.member_id = null;
  }

  await saveDb(env, data);

  return json(req, env, {
    transaction: serializeTx(data, tx),
    summary: getSummary(data, auth.session.household_id),
  });
}

async function deleteTransaction(req: Request, env: Env, id: string) {
  const { data, auth } = await authorize(req, env);
  if (!auth) return json(req, env, { error: "Unauthorized" }, 401);

  const idx = data.transactions.findIndex(
    (t) => t.id === id && t.household_id === auth.session.household_id,
  );
  if (idx < 0) return json(req, env, { error: "Не найдено" }, 404);
  data.transactions.splice(idx, 1);
  await saveDb(env, data);

  return json(req, env, {
    ok: true,
    summary: getSummary(data, auth.session.household_id),
  });
}

async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  }

  if (pathname === "/api/health") {
    return json(req, env, { ok: true, service: "fina" });
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    return login(req, env);
  }

  if (pathname === "/api/summary" && method === "GET") {
    const { data, auth } = await authorize(req, env);
    if (!auth) return json(req, env, { error: "Unauthorized" }, 401);
    return json(req, env, getSummary(data, auth.session.household_id));
  }

  if (pathname === "/api/transactions") {
    if (method === "GET") {
      const { data, auth } = await authorize(req, env);
      if (!auth) return json(req, env, { error: "Unauthorized" }, 401);
      const rows = data.transactions
        .filter((t) => t.household_id === auth.session.household_id)
        .sort(
          (a, b) =>
            new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
        )
        .map((t) => serializeTx(data, t));
      return json(req, env, { transactions: rows });
    }
    if (method === "POST") return createTransaction(req, env);
  }

  const txMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (txMatch) {
    const id = decodeURIComponent(txMatch[1]);
    if (method === "PATCH") return updateTransaction(req, env, id);
    if (method === "DELETE") return deleteTransaction(req, env, id);
  }

  if (pathname === "/api/share" && method === "GET") {
    const { data, auth } = await authorize(req, env);
    if (!auth) return json(req, env, { error: "Unauthorized" }, 401);
    const household = data.households.find(
      (h) => h.id === auth.session.household_id,
    );
    if (!household) return json(req, env, { error: "Not found" }, 404);
    const webUrl = env.WEB_URL ?? new URL(req.url).origin;
    return json(req, env, {
      householdName: household.name,
      inviteCode: household.invite_code,
      webUrl: `${webUrl}/?invite=${household.invite_code}`,
      members: ["Аня", "Андрей"],
      hint: "Открой ссылку, введи PIN и выбери своё имя",
    });
  }

  return json(req, env, { error: "Not found" }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      return json(req, env, { error: e instanceof Error ? e.message : "Error" }, 500);
    }
  },
};
