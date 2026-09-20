export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "interest"
  | "cashback"
  | "transfer";

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
  toMemberId?: string | null;
  toMemberName?: string | null;
  createdByName?: string | null;
  /** Операция уже на экране, но ещё едет на сервер. Только на клиенте. */
  pending?: boolean;
};

/** Порядок как в API: свежие сверху. Локальные вставки должны его повторять. */
export function sortTransactions(list: Transaction[]) {
  return [...list].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

/**
 * Повтор серверного getSummary: пока ответ едет, цифры считает клиент по тому же
 * правилу. Любое расхождение формул сразу увидят как прыжок суммы после сохранения.
 */
export function recomputeSummary(base: Summary, list: Transaction[]): Summary {
  let contributions = 0;
  let interest = 0;
  let cashback = 0;
  for (const t of list) {
    if (t.type === "deposit") contributions += t.amountCents;
    else if (t.type === "withdrawal") contributions -= t.amountCents;
    else if (t.type === "interest") interest += t.amountCents;
    else if (t.type === "cashback") cashback += t.amountCents;
  }

  const members = base.members.map((m) => {
    let balance = 0;
    for (const t of list) {
      if (t.type === "deposit" && t.memberId === m.id) balance += t.amountCents;
      else if (t.type === "withdrawal" && t.memberId === m.id) balance -= t.amountCents;
      else if (t.type === "transfer") {
        if (t.memberId === m.id) balance -= t.amountCents;
        if (t.toMemberId === m.id) balance += t.amountCents;
      }
    }
    return { ...m, balanceCents: balance };
  });

  const accrualsCents = interest + cashback;
  return {
    ...base,
    totalCents: contributions + accrualsCents,
    contributionsCents: contributions,
    interestCents: interest,
    cashbackCents: cashback,
    accrualsCents,
    members,
  };
}

/** Базовый URL API. Пусто — значит тот же origin. */
const DEFAULT_API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
const API_BASE_KEY = "fina-api-base";
const REQUEST_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 6_000;

/**
 * Один и тот же кабинет живёт сразу на четырёх адресах, потому что российские
 * операторы режут то Cloudflare, то кастомные домены Vercel — и у каждой сети
 * свой набор живых. Порядок тут ни на что не влияет: побеждает первый, кто
 * ответит на /api/health, а победитель запоминается до первого сбоя.
 */
const API_BASES = [
  DEFAULT_API_BASE,
  "https://fina-api-orpin.vercel.app",
  "https://api-cf.fovkotov.lol",
  "https://fina-api.fovkotov.workers.dev",
].filter((base, i, all) => base && all.indexOf(base) === i);

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
 * Адрес, выбранный перебором или руками через `?api=https://...`; он же лежит
 * в localStorage, чтобы следующий запуск не тратил время на проверку заново.
 */
export function apiBase() {
  return store.get(API_BASE_KEY)?.replace(/\/$/, "") || DEFAULT_API_BASE;
}

export function setApiBase(url: string | null) {
  if (url) store.set(API_BASE_KEY, url.replace(/\/$/, ""));
  else store.remove(API_BASE_KEY);
}

/** Пингуем всех разом: ждать их по очереди — это минуты на мёртвой сети. */
async function probeApiBase(): Promise<string> {
  const attempts = API_BASES.map(async (base) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/api/health`, { signal: abort.signal });
      if (!res.ok) throw new Error(`${hostOf(base)}: ${res.status}`);
      return base;
    } finally {
      clearTimeout(timer);
    }
  });
  try {
    return await Promise.any(attempts);
  } catch {
    const hosts = API_BASES.map(hostOf).join(", ");
    throw new Error(
      `Ни один сервер не ответил (${hosts}). Дело не в коде или PIN — эта сеть ` +
        `не пускает ни к одному из них. Попробуй другой Wi-Fi или VPN.`,
    );
  }
}

let probing: Promise<string> | null = null;

/** Запомненный адрес важнее перебора, иначе каждый старт стоил бы лишних запросов. */
async function currentBase(): Promise<string> {
  const saved = store.get(API_BASE_KEY)?.replace(/\/$/, "");
  if (saved) return saved;
  probing ??= probeApiBase()
    .then((base) => {
      setApiBase(base);
      return base;
    })
    .finally(() => {
      probing = null;
    });
  return probing;
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

async function send(path: string, init: RequestInit, base: string) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, { ...init, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const t = token();
  if (t) headers.set("Authorization", `Bearer ${t}`);

  // Поиск живого адреса кидает своё сообщение — второй заход тут не нужен.
  const base = await currentBase();
  let res: Response;
  try {
    res = await send(path, { ...init, headers }, base);
  } catch {
    // Сетевой сбой: DNS, разрыв TLS, блокировка провайдером. Адрес мог быть
    // жив вчера и умереть сегодня, поэтому забываем его и ищем заново.
    setApiBase(null);
    res = await send(path, { ...init, headers }, await currentBase());
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
    rev?: number;
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
export function saveBootstrapCache(
  summary: Summary,
  transactions: Transaction[],
  rev: number,
) {
  store.set(BOOTSTRAP_KEY, JSON.stringify({ summary, transactions, rev }));
}

export function readBootstrapCache(): {
  summary: Summary;
  transactions: Transaction[];
  rev: number;
} | null {
  const raw = store.get(BOOTSTRAP_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      summary?: Summary;
      transactions?: Transaction[];
      rev?: number;
    };
    if (!data?.summary || !Array.isArray(data.transactions)) return null;
    return {
      summary: data.summary,
      transactions: data.transactions,
      rev: data.rev ?? 0,
    };
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
    return await request<{
      summary: Summary;
      transactions: Transaction[];
      rev?: number;
    }>("/api/bootstrap");
  } catch (e) {
    // Пока новый воркер не выкатили — собираем теми же двумя эндпоинтами.
    const message = e instanceof Error ? e.message : "";
    if (!/not found|404/i.test(message)) throw e;
    const [summary, transactions] = await Promise.all([
      fetchSummary(),
      fetchTransactions(),
    ]);
    return { summary, transactions, rev: undefined };
  }
}

export function createTransaction(body: {
  type: TransactionType;
  amountCents: number;
  note: string;
  memberId?: string | null;
  toMemberId?: string | null;
}) {
  return request<{ transaction: Transaction; summary: Summary; rev?: number }>(
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
    toMemberId?: string | null;
    occurredAt?: string;
  },
) {
  return request<{ transaction: Transaction; summary: Summary; rev?: number }>(
    `/api/transactions/${id}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function deleteTransaction(id: string) {
  return request<{ ok: boolean; summary: Summary; rev?: number }>(
    `/api/transactions/${id}`,
    { method: "DELETE" },
  );
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
  transfer: "Перевод",
};
