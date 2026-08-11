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
};

const DEFAULT_GIST_ID = "9ae03be0b8cb1a5a2d1818bd4492c8ea";
const GIST_FILE = "fina-db.json";
const MEMORY_TTL_MS = 30_000;
const SESSION_DAYS = 180;

type MemoryCache = {
  gistId: string;
  data: DbData;
  loadedAt: number;
};

let memoryCache: MemoryCache | null = null;
let inflightLoad: Promise<DbData> | null = null;

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

function githubHeaders(env: Env): HeadersInit {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required for shared DB");
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "fina-server",
  };
}

function gistIdOf(env: Env): string {
  return env.FINA_GIST_ID ?? DEFAULT_GIST_ID;
}

function gistUrl(env: Env): string {
  return `https://api.github.com/gists/${gistIdOf(env)}`;
}

function cloneDb(data: DbData): DbData {
  return JSON.parse(JSON.stringify(data)) as DbData;
}

function remember(env: Env, data: DbData) {
  memoryCache = { gistId: gistIdOf(env), data: cloneDb(data), loadedAt: Date.now() };
}

async function fetchGistDb(env: Env): Promise<DbData> {
  const res = await fetch(gistUrl(env), {
    headers: { ...githubHeaders(env), "Cache-Control": "no-cache" },
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

export async function loadDb(env: Env): Promise<DbData> {
  const gistId = gistIdOf(env);
  if (
    memoryCache &&
    memoryCache.gistId === gistId &&
    Date.now() - memoryCache.loadedAt < MEMORY_TTL_MS
  ) {
    return cloneDb(memoryCache.data);
  }

  if (inflightLoad) return cloneDb(await inflightLoad);

  inflightLoad = (async () => {
    const fresh = await fetchGistDb(env);
    remember(env, fresh);
    return fresh;
  })();

  try {
    return cloneDb(await inflightLoad);
  } finally {
    inflightLoad = null;
  }
}

export async function saveDb(env: Env, data: DbData): Promise<void> {
  const now = Date.now();
  data.sessions = data.sessions.filter((s) => new Date(s.expires_at).getTime() > now);

  const res = await fetch(gistUrl(env), {
    method: "PATCH",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      files: { [GIST_FILE]: { content: JSON.stringify(data, null, 2) } },
    }),
  });
  if (!res.ok) {
    memoryCache = null;
    throw new Error(`Failed to save DB: ${res.status} ${await res.text()}`);
  }
  remember(env, data);
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required for sessions");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`fina-session:${env.GITHUB_TOKEN}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

type SessionClaims = {
  h: string;
  m: string;
  e: number;
};

export async function issueSessionToken(
  env: Env,
  householdId: string,
  memberId: string,
): Promise<{ token: string; expiresAt: string }> {
  const expiresAtMs = Date.now() + 1000 * 60 * 60 * 24 * SESSION_DAYS;
  const claims: SessionClaims = { h: householdId, m: memberId, e: expiresAtMs };
  const body = b64urlJson(claims);
  const key = await hmacKey(env);
  const sig = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return { token: `v1.${body}.${sig}`, expiresAt: new Date(expiresAtMs).toISOString() };
}

async function verifySignedToken(
  env: Env,
  token: string,
): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, body, sig] = parts;
  const key = await hmacKey(env);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    fromB64url(sig),
    new TextEncoder().encode(body),
  );
  if (!ok) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionClaims;
    if (!claims?.h || !claims?.m || !claims?.e) return null;
    if (claims.e < Date.now()) return null;
    return claims;
  } catch {
    return null;
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

export function listTransactions(data: DbData, householdId: string) {
  return data.transactions
    .filter((t) => t.household_id === householdId)
    .sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
    );
}

export async function requireSession(env: Env, data: DbData, token: string | null) {
  if (!token) return null;

  const signed = await verifySignedToken(env, token);
  if (signed) {
    const member = data.members.find((m) => m.id === signed.m);
    if (!member || member.household_id !== signed.h) return null;
    return {
      session: {
        token,
        household_id: signed.h,
        member_id: signed.m,
        created_at: new Date().toISOString(),
        expires_at: new Date(signed.e).toISOString(),
      } satisfies Session,
      member,
    };
  }

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
