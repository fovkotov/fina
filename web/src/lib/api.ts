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

/** Насколько отодвинуть строку, если она встаёт выше самой свежей или ниже самой старой. */
const REORDER_EDGE_MS = 60_000;

/**
 * Новая occurredAt, чтобы строка осталась в слоте index после sortTransactions.
 * Соседи — даты остальных операций, свежие сверху, без перетаскиваемой.
 * 0 — новее верхней, length — старше нижней, иначе строго между двумя соседними.
 * Отдельного поля порядка нет: место в списке и есть эта метка, в том числе чужой месяц.
 */
export function reorderOccurredAt(
  neighborIsos: readonly string[],
  index: number,
  now = Date.now(),
): string {
  const times = neighborIsos.map((iso) => new Date(iso).getTime());
  const taken = new Set(times.filter((t) => Number.isFinite(t)));
  const slot = Math.max(0, Math.min(index, times.length));

  let ms: number;
  if (times.length === 0 || !Number.isFinite(times[0])) {
    ms = now;
  } else if (slot === 0) {
    ms = newerThan(times[0], taken, now);
  } else if (slot === times.length) {
    ms = olderThan(times[times.length - 1], taken);
  } else {
    ms = betweenNeighbors(times[slot - 1], times[slot], taken);
  }
  if (!Number.isFinite(ms)) ms = now;
  return new Date(ms).toISOString();
}

/** Чуть новее верхней. Минута в будущее не уезжает: если сосед уже «сейчас», хватает 1 мс. */
function newerThan(top: number, taken: Set<number>, now: number) {
  let ms = top + REORDER_EDGE_MS;
  if (ms > now) ms = now > top ? now : top + 1;
  if (ms <= top) ms = top + 1;
  if (!taken.has(ms)) return ms;
  for (let t = ms; t > top; t -= 1) {
    if (!taken.has(t)) return t;
  }
  let t = top + 1;
  while (taken.has(t)) t += 1;
  return t;
}

function olderThan(bottom: number, taken: Set<number>) {
  let ms = bottom - REORDER_EDGE_MS;
  if (ms >= bottom) ms = bottom - 1;
  while (taken.has(ms)) ms -= 1;
  return ms;
}

/** Середина интервала. Если она занята или не строго между — сдвиг на 1 мс внутри зазора. */
function betweenNeighbors(newer: number, older: number, taken: Set<number>) {
  if (Number.isFinite(newer) && Number.isFinite(older) && newer > older) {
    let ms = Math.round((newer + older) / 2);
    if (ms <= older) ms = older + 1;
    if (ms >= newer) ms = newer - 1;
    const free = nearestFreeMs(ms, older, newer, taken);
    if (free != null) return free;
  }
  // Разрыв в 0–1 мс: целой метки строго между нет. Берём свободную сразу под верхней.
  let fallback = Number.isFinite(newer) ? newer - 1 : older - 1;
  while (taken.has(fallback)) fallback -= 1;
  return fallback;
}

function nearestFreeMs(
  start: number,
  older: number,
  newer: number,
  taken: Set<number>,
) {
  const span = newer - older;
  for (let step = 0; step < span; step += 1) {
    const up = start + step;
    if (up > older && up < newer && !taken.has(up)) return up;
    if (step === 0) continue;
    const down = start - step;
    if (down > older && down < newer && !taken.has(down)) return down;
  }
  return null;
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

/**
 * Список ещё не приехал, а операция уже на экране. Серверные цифры не обнуляем —
 * прибавляем только то, что ушло в сеть и ещё не попало в сводку.
 */
export function applyPending(base: Summary, pending: Transaction[]): Summary {
  if (pending.length === 0) return base;

  let contributions = base.contributionsCents;
  let interest = base.interestCents;
  let cashback = base.cashbackCents;
  const balances = new Map(base.members.map((m) => [m.id, m.balanceCents ?? 0]));

  for (const t of pending) {
    if (t.type === "deposit") contributions += t.amountCents;
    else if (t.type === "withdrawal") contributions -= t.amountCents;
    else if (t.type === "interest") interest += t.amountCents;
    else if (t.type === "cashback") cashback += t.amountCents;

    if (t.type === "deposit" && t.memberId) {
      balances.set(t.memberId, (balances.get(t.memberId) ?? 0) + t.amountCents);
    } else if (t.type === "withdrawal" && t.memberId) {
      balances.set(t.memberId, (balances.get(t.memberId) ?? 0) - t.amountCents);
    } else if (t.type === "transfer") {
      if (t.memberId) {
        balances.set(t.memberId, (balances.get(t.memberId) ?? 0) - t.amountCents);
      }
      if (t.toMemberId) {
        balances.set(t.toMemberId, (balances.get(t.toMemberId) ?? 0) + t.amountCents);
      }
    }
  }

  const accrualsCents = interest + cashback;
  return {
    ...base,
    totalCents: contributions + accrualsCents,
    contributionsCents: contributions,
    interestCents: interest,
    cashbackCents: cashback,
    accrualsCents,
    members: base.members.map((m) => ({
      ...m,
      balanceCents: balances.get(m.id) ?? 0,
    })),
  };
}

/** Базовый URL API. Пусто — значит тот же origin. */
const DEFAULT_API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
const API_BASE_KEY = "fina-api-base";
/**
 * Копия на Layero: телефон говорит только со своим адресом. Чужие двери не
 * опрашиваем — с мобильного они молчат до таймаута. Холодный старт там до ~20 с,
 * поэтому и проверка, и сам запрос ждут дольше.
 */
const SAME_ORIGIN = process.env.NEXT_PUBLIC_SAME_ORIGIN === "1";
const REQUEST_TIMEOUT_MS = SAME_ORIGIN ? 35_000 : 12_000;
const PROBE_TIMEOUT_MS = SAME_ORIGIN ? 35_000 : 4_000;
const LIVE_BASE_MS = 30_000;

/**
 * Куда реально можно стучаться.
 *
 * `fovkotov.lol` истёк у REG.RU, поэтому api.fovkotov.lol и api-cf — парковка
 * регистратора, не наш сервер. Мобильные операторы отдельно не пускают к
 * Cloudflare (workers.dev). Vercel с части сетей просто не отвечает.
 * Дверь на Netlify жива с мобильного интернета: телефон говорит с ней, а она
 * уже зовёт воркер. Порядок не важен — берём первый ответ /api/health.
 */
const API_BASES = SAME_ORIGIN
  ? [""]
  : [
      "https://fina-api-door.netlify.app",
      DEFAULT_API_BASE,
      "https://fina-api-orpin.vercel.app",
      "https://api-cf.fovkotov.lol",
      "https://fina-api.fovkotov.workers.dev",
    ].filter((base, i, all) => Boolean(base) && all.indexOf(base) === i);

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

/** Победитель прошлого замера. Пока он свежий, сохранение не ждёт новый перебор. */
let liveBase: { url: string; until: number } | null = null;

function rememberBase(url: string) {
  liveBase = { url, until: Date.now() + LIVE_BASE_MS };
  setApiBase(url);
}

function forgetBase(url: string) {
  if (liveBase?.url === url) liveBase = null;
  const saved = store.get(API_BASE_KEY)?.replace(/\/$/, "");
  if (saved === url) setApiBase(null);
}

function basesToProbe(skip?: string) {
  const saved = store.get(API_BASE_KEY)?.replace(/\/$/, "") ?? "";
  const list = SAME_ORIGIN ? [""] : [...new Set(saved ? [saved, ...API_BASES] : API_BASES)];
  return list.filter((base) => base !== skip);
}

function isTransportError(err: unknown) {
  if (err instanceof TypeError) return true;
  return err instanceof Error && err.name === "AbortError";
}

/** Пингуем всех разом: ждать их по очереди — это минуты на мёртвой сети. */
async function probeApiBase(skip?: string): Promise<string> {
  const bases = basesToProbe(skip);
  const attempts = bases.map(async (base) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/api/health`, {
        signal: abort.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${hostOf(base)}: ${res.status}`);
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        service?: string;
      } | null;
      // Парковка домена и заглушки оператора тоже умеют ответить «200».
      if (!body?.ok || body.service !== "fina") {
        throw new Error(`${hostOf(base)}: not fina`);
      }
      return base;
    } finally {
      clearTimeout(timer);
    }
  });
  try {
    return await Promise.any(attempts);
  } catch {
    const hosts = bases.map(hostOf).join(", ");
    throw new Error(
      `Ни один сервер не ответил (${hosts}). Дело не в коде или PIN — эта сеть ` +
        `не пускает ни к одному из них.`,
    );
  }
}

/**
 * Запомненный адрес не используем вслепую: на мобильном это часто Cloudflare,
 * который молчит до таймаута. Берём того, кто прямо сейчас ответил на health.
 */
async function currentBase(): Promise<string> {
  if (liveBase && liveBase.until > Date.now()) return liveBase.url;
  const base = await probeApiBase();
  rememberBase(base);
  return base;
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

async function readBody<T>(res: Response): Promise<T> {
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const t = token();
  if (t) headers.set("Authorization", `Bearer ${t}`);

  let base = await currentBase();
  try {
    const res = await send(path, { ...init, headers }, base);
    rememberBase(base);
    return await readBody<T>(res);
  } catch (err) {
    // Сетевой сбой: DNS, разрыв TLS, блокировка провайдером. Ответ сервера
    // (неверный PIN, 400) сюда не попадает — повтор такой записи сделал бы дубль.
    if (!isTransportError(err)) throw err;
    forgetBase(base);
    base = await probeApiBase(base);
    rememberBase(base);
    const res = await send(path, { ...init, headers }, base);
    rememberBase(base);
    return await readBody<T>(res);
  }
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

const BOOTSTRAP_KEY = "bootstrap";
const SUMMARY_CACHE_KEY = "bootstrap-summary";
const TX_CACHE_KEY = "bootstrap-tx";

export function logout() {
  store.remove("token");
  store.remove("member");
  store.remove(BOOTSTRAP_KEY);
  store.remove(SUMMARY_CACHE_KEY);
  store.remove(TX_CACHE_KEY);
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

type LegacyBundle = {
  summary: Summary;
  transactions: Transaction[];
  rev: number;
};

/** Старый кэш был одним JSON: парсим его один раз и сразу раскладываем на два ключа. */
let legacyBundle: LegacyBundle | null | undefined;

function readLegacyBundle(): LegacyBundle | null {
  if (legacyBundle !== undefined) return legacyBundle;
  legacyBundle = null;
  const raw = store.get(BOOTSTRAP_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      summary?: Summary;
      transactions?: Transaction[];
      rev?: number;
    };
    if (!data?.summary || !Array.isArray(data.transactions)) return null;
    legacyBundle = {
      summary: data.summary,
      transactions: data.transactions,
      rev: data.rev ?? 0,
    };
    return legacyBundle;
  } catch {
    return null;
  }
}

export function saveSummaryCache(summary: Summary, rev: number) {
  store.set(SUMMARY_CACHE_KEY, JSON.stringify({ summary, rev }));
}

export function saveTxCache(transactions: Transaction[], rev: number) {
  store.set(TX_CACHE_KEY, JSON.stringify({ transactions, rev }));
}

/** Маленький ключ: шапка рисуется, не дожидаясь разбора списка. */
export function readSummaryCache(): { summary: Summary; rev: number } | null {
  const raw = store.get(SUMMARY_CACHE_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw) as { summary?: Summary; rev?: number };
      if (!data?.summary) return null;
      return { summary: data.summary, rev: data.rev ?? 0 };
    } catch {
      return null;
    }
  }
  const legacy = readLegacyBundle();
  if (!legacy) return null;
  saveSummaryCache(legacy.summary, legacy.rev);
  saveTxCache(legacy.transactions, legacy.rev);
  store.remove(BOOTSTRAP_KEY);
  return { summary: legacy.summary, rev: legacy.rev };
}

export function readTransactionsCache(): {
  transactions: Transaction[];
  rev: number;
} | null {
  const raw = store.get(TX_CACHE_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw) as {
        transactions?: Transaction[];
        rev?: number;
      };
      if (!Array.isArray(data?.transactions)) return null;
      return { transactions: data.transactions, rev: data.rev ?? 0 };
    } catch {
      return null;
    }
  }
  const legacy = readLegacyBundle();
  if (!legacy) return null;
  return { transactions: legacy.transactions, rev: legacy.rev };
}

export async function fetchSummary() {
  const data = await request<Summary & { rev?: number }>("/api/summary");
  const { rev, ...summary } = data;
  return { summary, rev };
}

export async function fetchTransactions() {
  const data = await request<{ transactions: Transaction[]; rev?: number }>(
    "/api/transactions",
  );
  return { transactions: data.transactions, rev: data.rev };
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

/** Для списка операций: год задают заголовки, рядом с днём — время. */
export function formatDayMonth(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const TYPE_LABELS: Record<TransactionType, string> = {
  deposit: "Внесение",
  withdrawal: "Списание",
  interest: "Проценты",
  cashback: "Кэшбэк",
  transfer: "Перевод",
};
