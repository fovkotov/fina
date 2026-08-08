-- Fina schema (Postgres / Supabase-compatible)
-- Also mirrored in server SQLite for the deployable Node API.

create extension if not exists pgcrypto;

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin_hash text not null,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  accent text not null default '#2F6F5E',
  unique (household_id, name)
);

create type transaction_type as enum (
  'deposit',
  'withdrawal',
  'interest',
  'cashback',
  'easy_money'
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  type transaction_type not null,
  amount_cents bigint not null check (amount_cents > 0),
  note text not null default '',
  occurred_at timestamptz not null default now(),
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists transactions_household_occurred_idx
  on transactions (household_id, occurred_at desc);

create table if not exists sessions (
  token text primary key,
  household_id uuid not null references households(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Helper views for balances
create or replace view member_balances as
select
  m.id as member_id,
  m.household_id,
  m.name,
  coalesce(sum(
    case
      when t.type = 'deposit' then t.amount_cents
      when t.type = 'withdrawal' then -t.amount_cents
      else 0
    end
  ), 0) as balance_cents
from members m
left join transactions t
  on t.member_id = m.id
  and t.type in ('deposit', 'withdrawal')
group by m.id, m.household_id, m.name;

create or replace view household_summary as
select
  h.id as household_id,
  h.name,
  coalesce(sum(
    case
      when t.type = 'deposit' then t.amount_cents
      when t.type = 'withdrawal' then -t.amount_cents
      when t.type in ('interest', 'cashback', 'easy_money') then t.amount_cents
      else 0
    end
  ), 0) as total_cents,
  coalesce(sum(case when t.type = 'interest' then t.amount_cents else 0 end), 0) as interest_cents,
  coalesce(sum(case when t.type = 'cashback' then t.amount_cents else 0 end), 0) as cashback_cents,
  coalesce(sum(case when t.type = 'easy_money' then t.amount_cents else 0 end), 0) as easy_money_cents,
  coalesce(sum(
    case
      when t.type = 'deposit' then t.amount_cents
      when t.type = 'withdrawal' then -t.amount_cents
      else 0
    end
  ), 0) as contributions_cents
from households h
left join transactions t on t.household_id = h.id
group by h.id, h.name;
