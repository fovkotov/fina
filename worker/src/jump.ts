import { newId, type DbData, type Session } from "./db.js";
import { JUMP_HZ, verifyJump } from "./jump-engine.js";

const MONTH_ZONE = "Europe/Moscow";
const LIMIT = 3;
const PRIZE_CENTS = 50_000;
const RUN_TTL_MS = 30 * 60 * 1000;

export type JumpRun = {
  id: string;
  requestId: string;
  householdId: string;
  memberId: string;
  month: string;
  seed: number;
  startedAt: number;
  score?: number;
};

function monthOf(now: number) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: MONTH_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(now);
}

function best(runs: JumpRun[], memberId: string) {
  return Math.max(-1, ...runs.filter((run) => run.memberId === memberId).map((run) => run.score ?? -1));
}

export function settleJump(data: DbData, householdId: string, now: number) {
  const month = monthOf(now);
  const members = data.members.filter((m) => m.household_id === householdId);
  if (members.length !== 2) return false;
  const [a, b] = members;
  const old = (data.jumpRuns ?? []).filter((run) => run.householdId === householdId && run.month < month);
  let changed = false;
  for (const period of new Set(old.map((run) => run.month))) {
    const id = `jump-prize:${householdId}:${period}`;
    if (data.jumpSettled?.includes(id) || data.transactions.some((tx) => tx.id === id)) continue;
    const runs = old.filter((run) => run.month === period);
    if (runs.some((run) => run.score == null && now - run.startedAt < RUN_TTL_MS)) continue;
    const sa = best(runs, a.id);
    const sb = best(runs, b.id);
    if (sa >= 0 && sb >= 0 && sa !== sb) {
      const [year, number] = period.split("-").map(Number);
      const occurredAt = new Date(Date.UTC(year, number, 1) - 3 * 3600000);
      data.transactions.push({
        id, household_id: householdId, account: "rocket",
        type: "transfer", member_id: sa > sb ? b.id : a.id, to_member_id: sa > sb ? a.id : b.id,
        amount_cents: PRIZE_CENTS, note: `Приз за Doodle Jump · ${period}`,
        occurred_at: occurredAt.toISOString(), created_at: new Date(now).toISOString(), created_by: null,
      });
    }
    (data.jumpSettled ??= []).push(id);
    changed = true;
  }
  return changed;
}

export function jumpStatus(data: DbData, session: Session, now: number) {
  const month = monthOf(now);
  const runs = (data.jumpRuns ?? []).filter((run) => run.householdId === session.household_id && run.month === month);
  const members = data.members.filter((m) => m.household_id === session.household_id);
  const prizes = data.transactions
    .filter((tx) => tx.household_id === session.household_id && tx.id.startsWith("jump-prize:"))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const prize = prizes[0];
  return {
    month,
    remaining: Math.max(0, LIMIT - runs.filter((run) => run.memberId === session.member_id).length),
    players: members.map((m) => ({ id: m.id, name: m.name, best: Math.max(0, best(runs, m.id)), used: runs.filter((run) => run.memberId === m.id).length })),
    prize: prize ? { winner: members.find((m) => m.id === prize.to_member_id)?.name, month: prize.id.split(":").at(-1) } : null,
  };
}

export function startJump(data: DbData, session: Session, requestId: string, now: number) {
  const month = monthOf(now);
  const runs = (data.jumpRuns ??= []);
  const own = runs.filter((run) => run.householdId === session.household_id && run.memberId === session.member_id && run.month === month);
  const existing = own.find((run) => run.requestId === requestId);
  if (existing) {
    if (existing.score != null || now - existing.startedAt >= RUN_TTL_MS) return null;
    return { run: existing, created: false };
  }
  if (own.length >= LIMIT) return null;
  let seed = 2166136261;
  for (const char of `${session.household_id}/${month}/${own.length}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const run = { id: newId(), requestId, householdId: session.household_id, memberId: session.member_id, month, seed: seed >>> 0, startedAt: now };
  runs.push(run);
  return { run, created: true };
}

export function finishJump(data: DbData, session: Session, id: string, tape: string, now: number) {
  const run = data.jumpRuns?.find((item) => item.id === id && item.householdId === session.household_id && item.memberId === session.member_id);
  if (!run) return null;
  if (run.score != null) return { score: run.score, changed: false };
  if (now - run.startedAt >= RUN_TTL_MS || tape.length * 1000 / JUMP_HZ > now - run.startedAt + 1000) return null;
  const score = verifyJump(run.seed, tape);
  if (score == null) return null;
  run.score = score;
  return { score, changed: true };
}
