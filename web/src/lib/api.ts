export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "interest"
  | "cashback"
  | "easy_money";

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
  easyMoneyCents: number;
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
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

function token() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const t = token();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ inviteCode, pin, memberName }),
  });
  localStorage.setItem("token", data.token);
  localStorage.setItem("member", JSON.stringify(data.member));
  return data;
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("member");
}

export function savedMember(): Member | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("member");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Member;
  } catch {
    return null;
  }
}

export const fetchSummary = () => request<Summary>("/api/summary");

export async function fetchTransactions() {
  const data = await request<{ transactions: Transaction[] }>("/api/transactions");
  return data.transactions;
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

export const TYPE_LABELS: Record<TransactionType, string> = {
  deposit: "Внесение",
  withdrawal: "Списание",
  interest: "Проценты",
  cashback: "Кэшбэк",
  easy_money: "Изи мани",
};
