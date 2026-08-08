import Database from "better-sqlite3";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../../data");
mkdirSync(dataDir, { recursive: true });

export const dbPath = join(dataDir, "fina.sqlite");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export type TxType =
  | "deposit"
  | "withdrawal"
  | "interest"
  | "cashback"
  | "easy_money";

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

export function migrate() {
  db.exec(`
    create table if not exists households (
      id text primary key,
      name text not null,
      pin_hash text not null,
      invite_code text not null unique,
      created_at text not null default (datetime('now'))
    );

    create table if not exists members (
      id text primary key,
      household_id text not null references households(id) on delete cascade,
      name text not null,
      accent text not null default '#2F6F5E',
      unique (household_id, name)
    );

    create table if not exists transactions (
      id text primary key,
      household_id text not null references households(id) on delete cascade,
      member_id text references members(id) on delete set null,
      type text not null check (type in ('deposit','withdrawal','interest','cashback','easy_money')),
      amount_cents integer not null check (amount_cents > 0),
      note text not null default '',
      occurred_at text not null,
      created_by text references members(id) on delete set null,
      created_at text not null default (datetime('now'))
    );

    create index if not exists transactions_household_occurred_idx
      on transactions (household_id, occurred_at desc);

    create table if not exists sessions (
      token text primary key,
      household_id text not null references households(id) on delete cascade,
      member_id text not null references members(id) on delete cascade,
      created_at text not null default (datetime('now')),
      expires_at text not null
    );
  `);
}

export function rublesToCents(value: number): number {
  return Math.round(value * 100);
}

export function centsToRubles(cents: number): number {
  return cents / 100;
}
