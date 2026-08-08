import {
  db,
  hashPin,
  migrate,
  newId,
  rublesToCents,
  type TxType,
} from "./db.js";

/** Default shared PIN — change in Settings later if needed */
export const DEFAULT_PIN = "1425";
export const DEFAULT_INVITE = "FINA26";

type SeedTx = {
  type: TxType;
  amount: number;
  note: string;
  memberName?: "Аня" | "Андрей";
  occurredAt: string;
};

/** Snapshot from Google Sheet «ФИНА» / накопления */
const SHEET_TRANSACTIONS: SeedTx[] = [
  {
    type: "deposit",
    amount: 1_102_513.52,
    note: "Стартовый вклад",
    memberName: "Аня",
    occurredAt: "2024-12-01T12:00:00.000Z",
  },
  {
    type: "deposit",
    amount: 926_185.37,
    note: "Стартовый вклад",
    memberName: "Андрей",
    occurredAt: "2024-12-01T12:00:00.000Z",
  },
  {
    type: "easy_money",
    amount: 143_524.4,
    note: "Изи мани",
    occurredAt: "2024-12-01T12:05:00.000Z",
  },
  {
    type: "interest",
    amount: 5_648.43,
    note: "декабрь",
    occurredAt: "2024-12-31T12:00:00.000Z",
  },
  {
    type: "interest",
    amount: 10_815.04,
    note: "январь",
    occurredAt: "2025-01-31T12:00:00.000Z",
  },
  {
    type: "interest",
    amount: 13_708.74,
    note: "февраль",
    occurredAt: "2025-02-28T12:00:00.000Z",
  },
  {
    type: "interest",
    amount: 12_873.44,
    note: "март",
    occurredAt: "2025-03-31T12:00:00.000Z",
  },
  {
    type: "interest",
    amount: 15_484.86,
    note: "апрель",
    occurredAt: "2025-04-30T12:00:00.000Z",
  },
  {
    type: "cashback",
    amount: 11_347.37,
    note: "кешбек за апрель",
    occurredAt: "2025-05-01T12:00:00.000Z",
  },
  {
    type: "interest",
    amount: 15_424.81,
    note: "май",
    occurredAt: "2025-05-31T12:00:00.000Z",
  },
  {
    type: "interest",
    amount: 15_401.41,
    note: "июнь",
    occurredAt: "2025-06-30T12:00:00.000Z",
  },
  {
    type: "cashback",
    amount: 6_743.03,
    note: "кешбек за май",
    occurredAt: "2025-06-05T12:00:00.000Z",
  },
  {
    type: "interest",
    amount: 13_360.32,
    note: "июль",
    occurredAt: "2025-07-31T12:00:00.000Z",
  },
  {
    type: "cashback",
    amount: 9_175.67,
    note: "кэшбэк за июнь",
    occurredAt: "2025-07-05T12:00:00.000Z",
  },
  {
    type: "interest",
    amount: 13_541.28,
    note: "август",
    occurredAt: "2025-08-08T12:00:00.000Z",
  },
];

export function seed(force = false) {
  migrate();

  const existing = db
    .prepare("select id from households where invite_code = ?")
    .get(DEFAULT_INVITE) as { id: string } | undefined;

  if (existing && !force) {
    console.log("Household already seeded:", existing.id);
    return existing.id;
  }

  if (existing && force) {
    db.prepare("delete from households where id = ?").run(existing.id);
  }

  const householdId = newId();
  const anyaId = newId();
  const andreyId = newId();

  db.prepare(
    `insert into households (id, name, pin_hash, invite_code)
     values (?, ?, ?, ?)`,
  ).run(householdId, "ФИНА", hashPin(DEFAULT_PIN), DEFAULT_INVITE);

  db.prepare(
    `insert into members (id, household_id, name, accent) values (?, ?, ?, ?)`,
  ).run(anyaId, householdId, "Аня", "#C45C26");
  db.prepare(
    `insert into members (id, household_id, name, accent) values (?, ?, ?, ?)`,
  ).run(andreyId, householdId, "Андрей", "#2F6F5E");

  const insertTx = db.prepare(
    `insert into transactions
      (id, household_id, member_id, type, amount_cents, note, occurred_at, created_by)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const memberIds: Record<string, string> = {
    Аня: anyaId,
    Андрей: andreyId,
  };

  const insertMany = db.transaction(() => {
    for (const row of SHEET_TRANSACTIONS) {
      const memberId = row.memberName ? memberIds[row.memberName] : null;
      insertTx.run(
        newId(),
        householdId,
        memberId,
        row.type,
        rublesToCents(row.amount),
        row.note,
        row.occurredAt,
        memberId,
      );
    }
  });
  insertMany();

  console.log("Seeded household", householdId);
  console.log(`Invite: ${DEFAULT_INVITE}  PIN: ${DEFAULT_PIN}`);
  console.log("Members: Аня, Андрей");
  return householdId;
}

const isDirect =
  process.argv[1]?.includes("seed.ts") || process.argv[1]?.includes("seed.js");
if (isDirect) {
  seed(process.argv.includes("--force"));
}
