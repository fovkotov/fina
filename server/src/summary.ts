import { db } from "./db.js";

export type MemberBalance = {
  id: string;
  name: string;
  accent: string;
  balanceCents: number;
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
  members: MemberBalance[];
};

export function getSummary(householdId: string): Summary {
  const household = db
    .prepare(`select id, name, invite_code from households where id = ?`)
    .get(householdId) as
    | { id: string; name: string; invite_code: string }
    | undefined;

  if (!household) {
    throw new Error("Household not found");
  }

  const totals = db
    .prepare(
      `
      select
        coalesce(sum(case when type = 'deposit' then amount_cents
                          when type = 'withdrawal' then -amount_cents
                          else 0 end), 0) as contributions,
        coalesce(sum(case when type = 'interest' then amount_cents else 0 end), 0) as interest,
        coalesce(sum(case when type = 'cashback' then amount_cents else 0 end), 0) as cashback,
        coalesce(sum(case when type = 'easy_money' then amount_cents else 0 end), 0) as easy_money
      from transactions
      where household_id = ?
    `,
    )
    .get(householdId) as {
    contributions: number;
    interest: number;
    cashback: number;
    easy_money: number;
  };

  const members = db
    .prepare(
      `
      select
        m.id,
        m.name,
        m.accent,
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
      where m.household_id = ?
      group by m.id
      order by m.name
    `,
    )
    .all(householdId) as Array<{
    id: string;
    name: string;
    accent: string;
    balance_cents: number;
  }>;

  const accrualsCents = totals.interest + totals.cashback;
  const totalCents =
    totals.contributions + accrualsCents + totals.easy_money;

  return {
    householdId: household.id,
    name: household.name,
    inviteCode: household.invite_code,
    totalCents,
    contributionsCents: totals.contributions,
    interestCents: totals.interest,
    cashbackCents: totals.cashback,
    easyMoneyCents: totals.easy_money,
    accrualsCents,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      accent: m.accent,
      balanceCents: m.balance_cents,
    })),
  };
}
