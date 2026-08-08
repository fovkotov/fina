import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type TxType =
  | "deposit"
  | "withdrawal"
  | "interest"
  | "cashback"
  | "easy_money";

export type Household = {
  id: string;
  name: string;
  pin_hash: string;
  invite_code: string;
  created_at: string;
};

export type Member = {
  id: string;
  household_id: string;
  name: string;
  accent: string;
};

export type Transaction = {
  id: string;
  household_id: string;
  member_id: string | null;
  type: TxType;
  amount_cents: number;
  note: string;
  occurred_at: string;
  created_by: string | null;
  created_at: string;
};

export type Session = {
  token: string;
  household_id: string;
  member_id: string;
  created_at: string;
  expires_at: string;
};

export type DbData = {
  households: Household[];
  members: Member[];
  transactions: Transaction[];
  sessions: Session[];
};

const GIST_ID = process.env.FINA_GIST_ID ?? "9ae03be0b8cb1a5a2d1818bd4492c8ea";
const GIST_FILE = "fina-db.json";

export function hashPin(pin: string): string {
  return createHash("sha256").update(`fina:${pin}`).digest("hex");
}

export function verifyPin(pin: string, pinHash: string): boolean {
  const a = Buffer.from(hashPin(pin));
  const b = Buffer.from(pinHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newId(): string {
  return randomBytes(16).toString("hex");
}

export function newToken(): string {
  return randomBytes(24).toString("hex");
}

function githubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required for shared DB");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "fina-app",
  };
}

async function githubFetch(url: string, init: RequestInit = {}) {
  // Local corporate/MITM proxies sometimes break Node's CA store.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && process.env.VERCEL !== "1") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return fetch(url, { ...init, cache: "no-store" });
}

export async function loadDb(): Promise<DbData> {
  const res = await githubFetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: githubHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load DB gist: ${res.status}`);
  }
  const gist = (await res.json()) as {
    files: Record<string, { content?: string; truncated?: boolean; raw_url?: string }>;
  };
  const file = gist.files[GIST_FILE];
  let content = file?.content;
  if (!content && file?.raw_url) {
    const raw = await githubFetch(file.raw_url, {
      headers: githubHeaders(),
    });
    content = await raw.text();
  }
  if (!content) throw new Error("DB gist file empty");
  return JSON.parse(content) as DbData;
}

export async function saveDb(data: DbData): Promise<void> {
  const res = await githubFetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: "PATCH",
    headers: {
      ...githubHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: {
        [GIST_FILE]: { content: JSON.stringify(data, null, 2) },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to save DB: ${res.status} ${text}`);
  }
}

export async function withDb<T>(
  fn: (data: DbData) => T | Promise<T>,
): Promise<T> {
  // simple retry for concurrent writes
  let lastError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const data = await loadDb();
      const result = await fn(data);
      await saveDb(data);
      return result;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw lastError;
}

export function getSummary(data: DbData, householdId: string) {
  const household = data.households.find((h) => h.id === householdId);
  if (!household) throw new Error("Household not found");

  const txs = data.transactions.filter((t) => t.household_id === householdId);
  let contributions = 0;
  let interest = 0;
  let cashback = 0;
  let easy = 0;
  for (const t of txs) {
    if (t.type === "deposit") contributions += t.amount_cents;
    else if (t.type === "withdrawal") contributions -= t.amount_cents;
    else if (t.type === "interest") interest += t.amount_cents;
    else if (t.type === "cashback") cashback += t.amount_cents;
    else if (t.type === "easy_money") easy += t.amount_cents;
  }

  const members = data.members
    .filter((m) => m.household_id === householdId)
    .map((m) => {
      let balance = 0;
      for (const t of txs) {
        if (t.member_id !== m.id) continue;
        if (t.type === "deposit") balance += t.amount_cents;
        if (t.type === "withdrawal") balance -= t.amount_cents;
      }
      return {
        id: m.id,
        name: m.name,
        accent: m.accent,
        balanceCents: balance,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const accrualsCents = interest + cashback;
  return {
    householdId: household.id,
    name: household.name,
    inviteCode: household.invite_code,
    totalCents: contributions + accrualsCents + easy,
    contributionsCents: contributions,
    interestCents: interest,
    cashbackCents: cashback,
    easyMoneyCents: easy,
    accrualsCents,
    members,
  };
}

export function requireSession(data: DbData, token: string | null) {
  if (!token) return null;
  const session = data.sessions.find((s) => s.token === token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  const member = data.members.find((m) => m.id === session.member_id);
  if (!member) return null;
  return { session, member };
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}
