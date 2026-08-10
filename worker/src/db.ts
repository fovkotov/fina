export type TxType = "deposit" | "withdrawal" | "interest" | "cashback";

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

export type Env = {
  GITHUB_TOKEN: string;
  FINA_GIST_ID?: string;
  WEB_URL?: string;
  ALLOWED_ORIGINS?: string;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
};

const DEFAULT_GIST_ID = "9ae03be0b8cb1a5a2d1818bd4492c8ea";
const GIST_FILE = "fina-db.json";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPin(pin: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`fina:${pin}`),
  );
  return hex(new Uint8Array(digest));
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  const candidate = await hashPin(pin);
  if (candidate.length !== pinHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ pinHash.charCodeAt(i);
  }
  return diff === 0;
}

function randomHex(size: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(size)));
}

export function newId(): string {
  return randomHex(16);
}

export function newToken(): string {
  return randomHex(24);
}

function githubHeaders(env: Env): HeadersInit {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required for shared DB");
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "fina-worker",
  };
}

function gistUrl(env: Env): string {
  return `https://api.github.com/gists/${env.FINA_GIST_ID ?? DEFAULT_GIST_ID}`;
}

export async function loadDb(env: Env): Promise<DbData> {
  // Читаем всегда свежую ревизию: иначе сразу после записи можно получить старую сессию.
  const res = await fetch(`${gistUrl(env)}?t=${Date.now()}`, {
    headers: { ...githubHeaders(env), "Cache-Control": "no-cache" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!res.ok) throw new Error(`Failed to load DB gist: ${res.status}`);
  const gist = (await res.json()) as {
    files: Record<string, { content?: string; raw_url?: string }>;
  };
  const file = gist.files[GIST_FILE];
  let content = file?.content;
  if (!content && file?.raw_url) {
    const raw = await fetch(file.raw_url, { headers: githubHeaders(env) });
    content = await raw.text();
  }
  if (!content) throw new Error("DB gist file empty");
  return JSON.parse(content) as DbData;
}

export async function saveDb(env: Env, data: DbData): Promise<void> {
  const res = await fetch(gistUrl(env), {
    method: "PATCH",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      files: { [GIST_FILE]: { content: JSON.stringify(data, null, 2) } },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save DB: ${res.status} ${await res.text()}`);
  }
}

export function getSummary(data: DbData, householdId: string) {
  const household = data.households.find((h) => h.id === householdId);
  if (!household) throw new Error("Household not found");

  const txs = data.transactions.filter((t) => t.household_id === householdId);
  let contributions = 0;
  let interest = 0;
  let cashback = 0;
  for (const t of txs) {
    if (t.type === "deposit") contributions += t.amount_cents;
    else if (t.type === "withdrawal") contributions -= t.amount_cents;
    else if (t.type === "interest") interest += t.amount_cents;
    else if (t.type === "cashback") cashback += t.amount_cents;
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
      return { id: m.id, name: m.name, accent: m.accent, balanceCents: balance };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  // «Изи мани» из таблицы — это не отдельный кошелёк, а всё, что накопилось само:
  // проценты плюс кешбэк. Складывать её с начислениями нельзя, будет двойной счёт.
  const accrualsCents = interest + cashback;
  return {
    householdId: household.id,
    name: household.name,
    inviteCode: household.invite_code,
    totalCents: contributions + accrualsCents,
    contributionsCents: contributions,
    interestCents: interest,
    cashbackCents: cashback,
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
