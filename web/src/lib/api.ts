export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "interest"
  | "cashback";

export type Member = {
  id: string;
  name: string;
  accent: string;
  balanceCents?: number;
};

export type Summary = {
  householdId: string;
  name: string;
  inviteCode: string;
  totalCents: number;
  contributionsCents: number;
  interestCents: number;
  cashbackCents: number;
  accrualsCents: number;
  members: Member[];
};

export type Transaction = {
  id: string;
  type: TransactionType;
  amountCents: number;
  note: string;
  occurredAt: string;
  createdAt?: string;
  memberId?: string | null;
  memberName?: string | null;
  memberAccent?: string | null;
  createdByName?: string | null;
};

/** Базовый URL API (Cloudflare Worker). Пусто — значит тот же origin. */
const DEFAULT_API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
const API_BASE_KEY = "fina-api-base";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Приватный режим Safari умеет ронять localStorage — тогда живём в памяти:
 * сессия не переживёт перезагрузку, но вход не сломается.
 */
const memory = new Map<string, string>();
const store = {
  get(key: string) {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Домен воркера у части операторов недоступен, поэтому запасной адрес можно
 * подставить через `?api=https://...` — он запоминается в localStorage.
 */
export function apiBase() {
  return store.get(API_BASE_KEY)?.replace(/\/$/, "") || DEFAULT_API_BASE;
}

export function setApiBase(url: string | null) {
  if (url) store.set(API_BASE_KEY, url.replace(/\/$/, ""));
  else store.remove(API_BASE_KEY);
}

function token() {
  return store.get("token");
}

function hostOf(base: string) {
  try {
    return new URL(base || window.location.origin).host;
  } catch {
    return base;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const t = token();
  if (t) headers.set("Authorization", `Bearer ${t}`);

  const base = apiBase();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      cache: "no-store",
      ...init,
      headers,
      signal: abort.signal,
    });
  } catch (e) {
    // Сюда попадают только сетевые сбои: DNS, разрыв TLS, блокировка провайдером.
    const reason =
      e instanceof Error && e.name === "AbortError"
        ? "не ответил за 15 секунд"
        : "недоступен";
    throw new Error(
      `Сервер ${hostOf(base)} ${reason}. Дело не в коде или PIN — эта сеть до него не достучалась. Попробуй другой Wi-Fi, мобильный интернет или VPN.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function login(inviteCode: string, pin: string, memberName: string) {
  const data = await request<{
    token: string;
    member: Member;
    summary: Summary;
    transactions?: Transaction[];
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ inviteCode, pin, memberName }),
  });
  store.set("token", data.token);
  store.set("member", JSON.stringify(data.member));
  return data;
}

export function logout() {
  store.remove("token");
  store.remove("member");
  store.remove("bootstrap");
}

export function savedToken() {
  return store.get("token");
}

export function savedMember(): Member | null {
  const raw = store.get("member");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Member;
  } catch {
    return null;
  }
}

const BOOTSTRAP_KEY = "bootstrap";

/** Последний удачный кабинет — чтобы открыть UI сразу, не дожидаясь сети. */
export function saveBootstrapCache(summary: Summary, transactions: Transaction[]) {
  store.set(BOOTSTRAP_KEY, JSON.stringify({ summary, transactions }));
}

export function readBootstrapCache(): {
  summary: Summary;
  transactions: Transaction[];
} | null {
  const raw = store.get(BOOTSTRAP_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      summary?: Summary;
      transactions?: Transaction[];
    };
    if (!data?.summary || !Array.isArray(data.transactions)) return null;
    return { summary: data.summary, transactions: data.transactions };
  } catch {
    return null;
  }
}

export const fetchSummary = () => request<Summary>("/api/summary");

export async function fetchTransactions() {
  const data = await request<{ transactions: Transaction[] }>("/api/transactions");
  return data.transactions;
}

/** Старт кабинета одним запросом — без параллельных loadDb на воркере. */
export async function fetchBootstrap() {
  try {
    return await request<{ summary: Summary; transactions: Transaction[] }>(
      "/api/bootstrap",
    );
  } catch (e) {
    // Пока новый воркер не выкатили — собираем теми же двумя эндпоинтами.
    const message = e instanceof Error ? e.message : "";
    if (!/not found|404/i.test(message)) throw e;
    const [summary, transactions] = await Promise.all([
      fetchSummary(),
      fetchTransactions(),
    ]);
    return { summary, transactions };
  }
}

export function createTransaction(body: {
  type: TransactionType;
  amountCents: number;
  note: string;
  memberId?: string | null;
}) {
  return request<{ transaction: Transaction; summary: Summary }>(
    "/api/transactions",
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function updateTransaction(
  id: string,
  body: {
    type?: TransactionType;
    amountCents?: number;
    note?: string;
    memberId?: string | null;
    occurredAt?: string;
  },
) {
  return request<{ transaction: Transaction; summary: Summary }>(
    `/api/transactions/${id}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function deleteTransaction(id: string) {
  return request<{ ok: boolean; summary: Summary }>(`/api/transactions/${id}`, {
    method: "DELETE",
  });
}

export function fetchShare() {
  return request<{
    householdName: string;
    inviteCode: string;
    webUrl: string;
    members: string[];
    hint: string;
  }>("/api/share");
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Для списка операций: год там задают заголовки, в строке он лишний. */
export function formatDayMonth(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

export const TYPE_LABELS: Record<TransactionType, string> = {
  deposit: "Внесение",
  withdrawal: "Списание",
  interest: "Проценты",
  cashback: "Кэшбэк",
};
