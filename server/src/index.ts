import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  db,
  migrate,
  newId,
  newToken,
  verifyPin,
  type TxType,
} from "./db.js";
import { seed } from "./seed.js";
import { getSummary } from "./summary.js";

migrate();
seed(false);

type SessionRow = {
  token: string;
  household_id: string;
  member_id: string;
  expires_at: string;
  member_name: string;
};

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, service: "fina" }));

function getBearer(c: { req: { header: (name: string) => string | undefined } }) {
  const header = c.req.header("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function requireSession(c: {
  req: { header: (name: string) => string | undefined };
}): SessionRow | null {
  const token = getBearer(c);
  if (!token) return null;

  const row = db
    .prepare(
      `
      select s.token, s.household_id, s.member_id, s.expires_at, m.name as member_name
      from sessions s
      join members m on m.id = s.member_id
      where s.token = ?
    `,
    )
    .get(token) as SessionRow | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("delete from sessions where token = ?").run(token);
    return null;
  }
  return row;
}

const TX_TYPES: TxType[] = [
  "deposit",
  "withdrawal",
  "interest",
  "cashback",
  "easy_money",
];

app.post("/auth/login", async (c) => {
  const body = await c.req.json<{
    inviteCode?: string;
    pin?: string;
    memberName?: string;
  }>();

  const inviteCode = (body.inviteCode ?? "").trim().toUpperCase();
  const pin = (body.pin ?? "").trim();
  const memberName = (body.memberName ?? "").trim();

  if (!inviteCode || !pin || !memberName) {
    return c.json({ error: "Нужны inviteCode, pin и memberName" }, 400);
  }

  const household = db
    .prepare(`select id, pin_hash, name, invite_code from households where invite_code = ?`)
    .get(inviteCode) as
    | { id: string; pin_hash: string; name: string; invite_code: string }
    | undefined;

  if (!household || !verifyPin(pin, household.pin_hash)) {
    return c.json({ error: "Неверный код или PIN" }, 401);
  }

  const member = db
    .prepare(
      `select id, name, accent from members where household_id = ? and name = ?`,
    )
    .get(household.id, memberName) as
    | { id: string; name: string; accent: string }
    | undefined;

  if (!member) {
    return c.json({ error: "Участник не найден. Выбери Аня или Андрей" }, 404);
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString();
  db.prepare(
    `insert into sessions (token, household_id, member_id, expires_at)
     values (?, ?, ?, ?)`,
  ).run(token, household.id, member.id, expiresAt);

  return c.json({
    token,
    expiresAt,
    household: {
      id: household.id,
      name: household.name,
      inviteCode: household.invite_code,
    },
    member,
    summary: getSummary(household.id),
  });
});

app.get("/auth/me", (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const member = db
    .prepare(`select id, name, accent from members where id = ?`)
    .get(session.member_id);

  return c.json({
    member,
    summary: getSummary(session.household_id),
  });
});

app.post("/auth/logout", (c) => {
  const token = getBearer(c);
  if (token) db.prepare("delete from sessions where token = ?").run(token);
  return c.json({ ok: true });
});

app.get("/summary", (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json(getSummary(session.household_id));
});

app.get("/members", (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const members = db
    .prepare(
      `select id, name, accent from members where household_id = ? order by name`,
    )
    .all(session.household_id);
  return c.json({ members });
});

app.get("/transactions", (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const rows = db
    .prepare(
      `
      select
        t.id,
        t.type,
        t.amount_cents as amountCents,
        t.note,
        t.occurred_at as occurredAt,
        t.created_at as createdAt,
        t.member_id as memberId,
        m.name as memberName,
        m.accent as memberAccent,
        cb.name as createdByName
      from transactions t
      left join members m on m.id = t.member_id
      left join members cb on cb.id = t.created_by
      where t.household_id = ?
      order by t.occurred_at desc, t.created_at desc
    `,
    )
    .all(session.household_id);

  return c.json({ transactions: rows });
});

app.post("/transactions", async (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    type?: TxType;
    amountCents?: number;
    amount?: number;
    note?: string;
    memberId?: string | null;
    occurredAt?: string;
  }>();

  const type = body.type;
  if (!type || !TX_TYPES.includes(type)) {
    return c.json({ error: "Некорректный type" }, 400);
  }

  let amountCents = body.amountCents;
  if (amountCents == null && body.amount != null) {
    amountCents = Math.round(Number(body.amount) * 100);
  }
  if (!amountCents || amountCents <= 0) {
    return c.json({ error: "Сумма должна быть больше нуля" }, 400);
  }

  const needsMember = type === "deposit" || type === "withdrawal";
  let memberId = body.memberId ?? null;

  if (needsMember) {
    if (!memberId) memberId = session.member_id;
    const member = db
      .prepare(`select id from members where id = ? and household_id = ?`)
      .get(memberId, session.household_id);
    if (!member) return c.json({ error: "Участник не найден" }, 400);
  } else {
    memberId = null;
  }

  const id = newId();
  const occurredAt = body.occurredAt
    ? new Date(body.occurredAt).toISOString()
    : new Date().toISOString();
  const note = (body.note ?? "").trim();

  db.prepare(
    `insert into transactions
      (id, household_id, member_id, type, amount_cents, note, occurred_at, created_by)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    session.household_id,
    memberId,
    type,
    amountCents,
    note,
    occurredAt,
    session.member_id,
  );

  const created = db
    .prepare(
      `
      select
        t.id,
        t.type,
        t.amount_cents as amountCents,
        t.note,
        t.occurred_at as occurredAt,
        t.created_at as createdAt,
        t.member_id as memberId,
        m.name as memberName,
        m.accent as memberAccent,
        cb.name as createdByName
      from transactions t
      left join members m on m.id = t.member_id
      left join members cb on cb.id = t.created_by
      where t.id = ?
    `,
    )
    .get(id);

  return c.json(
    {
      transaction: created,
      summary: getSummary(session.household_id),
    },
    201,
  );
});

app.delete("/transactions/:id", (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const existing = db
    .prepare(
      `select id from transactions where id = ? and household_id = ?`,
    )
    .get(id, session.household_id);

  if (!existing) return c.json({ error: "Не найдено" }, 404);

  db.prepare(`delete from transactions where id = ?`).run(id);
  return c.json({ ok: true, summary: getSummary(session.household_id) });
});

app.get("/share", (c) => {
  const session = requireSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const household = db
    .prepare(`select name, invite_code from households where id = ?`)
    .get(session.household_id) as { name: string; invite_code: string };

  const origin = c.req.header("origin") || c.req.header("referer") || "";
  const inferred =
    origin.replace(/\/$/, "").replace(/\/$/, "") ||
    process.env.WEB_BASE_URL ||
    "http://localhost:5173";
  const webBase = process.env.WEB_BASE_URL || inferred;

  return c.json({
    householdName: household.name,
    inviteCode: household.invite_code,
    webUrl: `${webBase}/?invite=${household.invite_code}`,
    members: ["Аня", "Андрей"],
    hint: "Открой ссылку, введи PIN и выбери своё имя",
  });
});

const webDist =
  process.env.WEB_DIST ?? join(process.cwd(), "../web/dist");
if (existsSync(webDist)) {
  app.use(
    "/*",
    serveStatic({
      root: webDist,
      rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
    }),
  );
  console.log(`Serving web from ${webDist}`);
}

const port = Number(process.env.PORT ?? 8787);
console.log(`Fina API listening on http://localhost:${port}`);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
