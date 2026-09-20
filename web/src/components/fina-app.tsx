"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { TextMorph } from "torph/react";
import { bind } from "cuelume";
import { Eye, EyeOff } from "lucide-react";
import {
  TYPE_LABELS,
  createTransaction,
  deleteTransaction,
  fetchBootstrap,
  formatDate,
  formatDayMonth,
  formatMoney,
  login,
  logout,
  readBootstrapCache,
  recomputeSummary,
  saveBootstrapCache,
  savedMember,
  savedToken,
  setApiBase,
  sortTransactions,
  updateTransaction,
  type Summary,
  type Transaction,
  type TransactionType,
} from "@/lib/api";
import { SFX, sfx } from "@/lib/sounds";
import {
  TxComposer,
  digitsOf,
  type OpType,
  type SpecialType,
} from "@/components/tx-composer";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const NAMES = ["Аня", "Андрей"] as const;
const ALL_TYPES = Object.keys(TYPE_LABELS) as TransactionType[];
const HIDE_BALANCES_KEY = "fina-hide-balances";
const HIDDEN_MONEY = "••••••";

function inviteFromUrl() {
  if (typeof window === "undefined") return "FINA26";
  return new URLSearchParams(window.location.search).get("invite") ?? "FINA26";
}

/** В приватном Safari localStorage кидается исключением — флаг не стоит того. */
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** `?api=https://...` переключает кабинет на запасной адрес API, `?api=` — сбрасывает. */
function applyApiFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("api")) return;
  setApiBase(params.get("api"));
}

/** Внесения, списания и переводы принадлежат участнику; начисления — общие. */
function needsMember(type: TransactionType) {
  return type === "deposit" || type === "withdrawal" || type === "transfer";
}

function otherMemberId(members: { id: string }[], currentId: string) {
  return members.find((m) => m.id !== currentId)?.id ?? "";
}

function memberIdByName(members: { id: string; name: string }[], name: string) {
  return members.find((m) => m.name === name)?.id ?? "";
}

/** Имя и цвет участника: строка рисуется до ответа сервера, подставить надо самим. */
function memberFacts(
  members: { id: string; name: string; accent: string }[],
  id: string | null | undefined,
) {
  const member = members.find((m) => m.id === id);
  return { name: member?.name ?? null, accent: member?.accent ?? null };
}

/** Временный id живёт, пока операция едет: по нему же строку и заменим ответом. */
function draftId() {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function txPartiesLabel(tx: Transaction) {
  if (tx.type === "transfer") {
    const from = tx.memberName ?? "участник";
    const to = tx.toMemberName ?? "участник";
    return `${from} → ${to}`;
  }
  return tx.memberName ?? "";
}

function amountPrefix(type: TransactionType) {
  if (type === "withdrawal") return "−";
  if (type === "transfer") return "";
  return "+";
}

/** Год в заголовке не пишем — его отбивает отдельная линия при смене. */
function monthLabel(date: Date) {
  const label = date.toLocaleDateString("ru-RU", { month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Заметка вида «август» или «августа 2025» повторяет заголовок месяца —
 * в строке она пустая трата места. Всё остальное («кэшбэк за июнь») остаётся.
 */
function noteWithoutMonth(note: string | undefined, iso: string) {
  const text = (note ?? "").trim();
  if (!text) return "";
  const date = new Date(iso);
  const nominative = date.toLocaleDateString("ru-RU", { month: "long" });
  const genitive = date
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
    .replace(/^\d+\s+/, "");
  const bare = text
    .toLowerCase()
    .replace(/\s*\d{4}\s*(г\.?)?$/, "")
    .trim();
  return bare === nominative || bare === genitive ? "" : text;
}

function monthKeyOf(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function calendarMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Насколько цифра выросла за текущий календарный месяц — против конца прошлого. */
function monthOverMonth(list: Transaction[], now = new Date()) {
  const currentKey = calendarMonthKey(now);
  const hasPreviousMonth = list.some((tx) => monthKeyOf(tx.occurredAt) < currentKey);
  if (!hasPreviousMonth) return null;

  const members: Record<string, number> = {};
  let accrualsCents = 0;
  for (const tx of list) {
    if (monthKeyOf(tx.occurredAt) !== currentKey) continue;
    if (tx.type === "interest" || tx.type === "cashback") {
      accrualsCents += tx.amountCents;
      continue;
    }
    if (tx.type === "deposit" && tx.memberId) {
      members[tx.memberId] = (members[tx.memberId] ?? 0) + tx.amountCents;
    } else if (tx.type === "withdrawal" && tx.memberId) {
      members[tx.memberId] = (members[tx.memberId] ?? 0) - tx.amountCents;
    } else if (tx.type === "transfer") {
      if (tx.memberId) {
        members[tx.memberId] = (members[tx.memberId] ?? 0) - tx.amountCents;
      }
      if (tx.toMemberId) {
        members[tx.toMemberId] = (members[tx.toMemberId] ?? 0) + tx.amountCents;
      }
    }
  }
  return { members, accrualsCents };
}

function MomDelta({ cents }: { cents: number | null | undefined }) {
  if (cents == null || cents === 0) return null;
  const negative = cents < 0;
  return (
    <p
      className={`mt-px text-xs font-medium tabular-nums ${
        negative
          ? "text-rose-600/70 dark:text-rose-400/60"
          : "text-emerald-600/70 dark:text-emerald-400/60"
      }`}
    >
      {`${negative ? "−" : "+"}${formatMoney(Math.abs(cents))}`}
    </p>
  );
}

/** Операции по месяцам: свежие сверху, внутри месяца — порядок как пришёл из API. */
function groupByMonth(list: Transaction[]) {
  const groups = new Map<
    string,
    { key: string; label: string; totalCents: number; items: Transaction[] }
  >();
  for (const tx of list) {
    const date = new Date(tx.occurredAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: monthLabel(date), totalCents: 0, items: [] };
      groups.set(key, group);
    }
    group.items.push(tx);
    if (tx.type === "withdrawal") group.totalCents -= tx.amountCents;
    else if (tx.type !== "transfer") group.totalCents += tx.amountCents;
  }
  const sorted = [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
  /** Год пишем один раз — на границе, где список уходит в предыдущий. */
  return sorted.map((group, i) => {
    const year = group.key.slice(0, 4);
    return { ...group, year, showYear: i > 0 && year !== sorted[i - 1].key.slice(0, 4) };
  });
}

/** Черновик правки одной операции: суммы и даты живут строками, как в полях ввода. */
type EditDraft = {
  id: string;
  type: TransactionType;
  amount: string;
  memberId: string;
  toMemberId: string;
  note: string;
  date: string;
  occurredAt: string;
};

function dateInputValue(iso: string) {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Меняем в дате только календарный день, время операции остаётся прежним. */
function withDate(iso: string, value: string) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const next = new Date(iso);
  next.setFullYear(y, m - 1, d);
  return next.toISOString();
}

export function FinaApp() {
  const [loggedIn, setLoggedIn] = useState(false);
  /** С сервера берём только неизменяемую часть: кто участники и как зовут кабинет. */
  const [summaryBase, setSummaryBase] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  /** Версия данных на сервере: отставший фоновый ответ не должен затирать свежий. */
  const rev = useRef(0);
  /**
   * Экран больше не блокируется на время записи, так что накликать две операции
   * подряд — обычное дело. Но сохранение в gist это «прочитал-изменил-записал»:
   * уйдя параллельно, второй запрос затрёт первый. Поэтому на сеть — по одной.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.current.then(task, task);
    queue.current = next.catch(() => undefined);
    return next;
  }

  /**
   * Итоги считаем из списка операций, а не берём готовыми из ответа. Иначе
   * оптимистичная строка уже на экране, а сумма над ней ещё старая.
   */
  const summary = useMemo(
    () => (summaryBase ? recomputeSummary(summaryBase, transactions) : null),
    [summaryBase, transactions],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("FINA26");
  const [pin, setPin] = useState("1425");
  const [selectedName, setSelectedName] = useState<"Аня" | "Андрей">("Андрей");
  const [opType, setOpType] = useState<OpType>("deposit");
  const [opSpecial, setOpSpecial] = useState<SpecialType | null>(null);
  const [opAmount, setOpAmount] = useState("");
  const [opMemberId, setOpMemberId] = useState("");
  const [opToMemberId, setOpToMemberId] = useState("");
  const opTypeSeeded = useRef(false);
  const [shakeError, setShakeError] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  /** Операция, для которой открыт попап подтверждения удаления. */
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  /** Строка, у которой открыты действия: на тапскрине — по долгому нажатию. */
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [pressingId, setPressingId] = useState<string | null>(null);
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);

  useEffect(() => {
    bind();
    applyApiFromUrl();
    setInviteCode(inviteFromUrl());
    if (readFlag(HIDE_BALANCES_KEY)) setHideBalances(true);
    requestAnimationFrame(() => setMounted(true));
    // Сессия есть — рисуем кэш мгновенно, свежие данные подтянем фоном.
    if (savedMember() && savedToken()) {
      const cached = readBootstrapCache();
      if (cached) {
        rev.current = cached.rev;
        setSummaryBase(cached.summary);
        setTransactions(cached.transactions);
        seedOpDefaults(cached.summary, cached.transactions);
      }
      setLoggedIn(true);
      void refresh({ background: Boolean(cached), silent: Boolean(cached) });
    }
  }, []);

  /**
   * В кэш кладём только подтверждённое: иначе после перезапуска на экране
   * висела бы операция, которая на сервер так и не доехала.
   */
  useEffect(() => {
    if (!summary) return;
    if (transactions.some((t) => t.pending)) return;
    saveBootstrapCache(summary, transactions, rev.current);
  }, [summary, transactions]);

  /** Дефолты композера: участник — тот, кто вошёл; знак — как в его прошлой операции. */
  function seedOpDefaults(s: Summary, t: Transaction[]) {
    const me = savedMember();
    const fromId = me?.id || s.members[0]?.id || "";
    setOpMemberId((prev) => prev || fromId);
    setOpToMemberId((prev) => prev || otherMemberId(s.members, fromId));
    if (opTypeSeeded.current) return;
    opTypeSeeded.current = true;
    const last = t.find(
      (x) =>
        (x.type === "deposit" || x.type === "withdrawal") &&
        (me ? x.createdByName === me.name : true),
    );
    if (last) setOpType(last.type as OpType);
  }

  function flashError(message: string) {
    setError(message);
    setShakeError((n) => n + 1);
    sfx("error");
  }

  async function refresh(opts?: { background?: boolean; silent?: boolean }) {
    const background = opts?.background ?? false;
    if (!background) setLoading(true);
    if (!opts?.silent) setError(null);
    try {
      const { summary: s, transactions: t, rev: serverRev } = await fetchBootstrap();
      // Ответить мог инстанс с отставшим кэшем — тогда наши данные новее.
      if (serverRev != null && serverRev < rev.current) return;
      if (serverRev != null) rev.current = serverRev;
      setSummaryBase(s);
      // Ещё не долетевшие операции с экрана не убираем.
      setTransactions((prev) =>
        sortTransactions([...t, ...prev.filter((x) => x.pending)]),
      );
      seedOpDefaults(s, t);
    } catch (e) {
      // Кэш уже на экране — сетевой сбой фоном не перекрываем баннером.
      if (!opts?.silent) {
        flashError(e instanceof Error ? e.message : "Ошибка загрузки");
      }
      if (String(e).toLowerCase().includes("unauthorized")) {
        logout();
        setLoggedIn(false);
      }
    } finally {
      if (!background) setLoading(false);
    }
  }

  /**
   * Долгое нажатие на строку открывает её действия — это тапскринный аналог
   * наведения мышью. Уводом пальца жест отменяется, чтобы не мешать скроллу.
   */
  function cancelLongPress() {
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
    setPressingId(null);
  }

  function onRowPointerDown(e: React.PointerEvent, tx: Transaction) {
    if (e.pointerType === "mouse" || tx.pending) return;
    cancelLongPress();
    setPressingId(tx.id);
    const timer = window.setTimeout(() => {
      longPress.current = null;
      setPressingId(null);
      setRevealedId(tx.id);
      navigator.vibrate?.(8);
      sfx("nav");
    }, 420);
    longPress.current = { timer, x: e.clientX, y: e.clientY };
  }

  function onRowPointerMove(e: React.PointerEvent) {
    const press = longPress.current;
    if (!press) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelLongPress();
  }

  /** Открытые действия закрываются касанием мимо строки, скроллом или Esc. */
  useEffect(() => {
    if (!revealedId) return;
    const onPointerDown = (e: PointerEvent) => {
      const row = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-row-id]");
      if (row?.dataset.rowId !== revealedId) setRevealedId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRevealedId(null);
    };
    const onScroll = () => setRevealedId(null);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, [revealedId]);

  /**
   * Пока ответ не пришёл, у строки нет серверного id — править и удалять
   * такую нечего, сервер её ещё не знает.
   */
  function startEdit(tx: Transaction) {
    if (tx.pending) return;
    setRevealedId(null);
    setEditing({
      id: tx.id,
      type: tx.type,
      amount: String(tx.amountCents / 100),
      memberId: tx.memberId ?? "",
      toMemberId:
        tx.toMemberId ?? otherMemberId(summary?.members ?? [], tx.memberId ?? ""),
      note: tx.note ?? "",
      date: dateInputValue(tx.occurredAt),
      occurredAt: tx.occurredAt,
    });
    sfx("nav");
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const value = Number(editing.amount.replace(",", ".").replace(/\s/g, ""));
    if (!value || value <= 0) {
      flashError("Введи сумму");
      return;
    }
    if (
      editing.type === "transfer" &&
      (!editing.memberId || editing.memberId === editing.toMemberId)
    ) {
      flashError("Выбери разных участников");
      return;
    }
    const id = editing.id;
    const patch = {
      type: editing.type,
      amountCents: Math.round(value * 100),
      note: editing.note,
      memberId: needsMember(editing.type) ? editing.memberId || null : null,
      toMemberId: editing.type === "transfer" ? editing.toMemberId || null : null,
      occurredAt: withDate(editing.occurredAt, editing.date),
    };
    const members = summary?.members ?? [];
    const from = memberFacts(members, patch.memberId);
    const to = memberFacts(members, patch.toMemberId);
    const previous = transactions.find((t) => t.id === id);

    setTransactions((prev) =>
      sortTransactions(
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                memberName: from.name,
                memberAccent: from.accent,
                toMemberName: to.name,
                pending: true,
              }
            : t,
        ),
      ),
    );
    cancelEdit();
    setError(null);
    sfx("success");

    try {
      const res = await enqueue(() => updateTransaction(id, patch));
      rev.current = Math.max(rev.current, res.rev ?? 0);
      setSummaryBase(res.summary);
      setTransactions((prev) =>
        sortTransactions(prev.map((t) => (t.id === id ? res.transaction : t))),
      );
    } catch (err) {
      if (previous) {
        setTransactions((prev) =>
          sortTransactions(prev.map((t) => (t.id === id ? previous : t))),
        );
      }
      flashError(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  }

  /** Удаление необратимо, поэтому идёт через попап подтверждения. */
  function askRemove(tx: Transaction) {
    if (tx.pending) return;
    setRevealedId(null);
    setPendingDelete(tx);
  }

  async function removeTx(id: string) {
    const previous = transactions.find((t) => t.id === id);
    if (!previous) return;
    setError(null);
    setPendingDelete(null);
    if (editing?.id === id) cancelEdit();
    setTransactions((prev) => prev.filter((t) => t.id !== id));

    try {
      const res = await enqueue(() => deleteTransaction(id));
      rev.current = Math.max(rev.current, res.rev ?? 0);
      setSummaryBase(res.summary);
    } catch (err) {
      setTransactions((prev) => sortTransactions([...prev, previous]));
      flashError(err instanceof Error ? err.message : "Не удалось удалить");
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await login(inviteCode, pin, selectedName);
      rev.current = data.rev ?? 0;
      setSummaryBase(data.summary);
      if (data.transactions) {
        setTransactions(sortTransactions(data.transactions));
        seedOpDefaults(data.summary, data.transactions);
      } else {
        // Старый воркер без transactions в login — догрузим bootstrap/парой запросов.
        await refresh();
      }
      setLoggedIn(true);
      sfx("success");
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }

  async function submitOp() {
    const value = Number(digitsOf(opAmount));
    if (!value) {
      flashError("Введи сумму");
      return;
    }
    const type = opSpecial ?? opType;
    if (type === "transfer" && (!opMemberId || opMemberId === opToMemberId)) {
      flashError("Выбери разных участников");
      return;
    }
    const body = {
      type,
      amountCents: value * 100,
      note: "",
      memberId: needsMember(type) ? opMemberId || null : null,
      toMemberId: type === "transfer" ? opToMemberId || null : null,
    };
    const members = summary?.members ?? [];
    const from = memberFacts(members, body.memberId);
    const to = memberFacts(members, body.toMemberId);
    const id = draftId();
    const draft: Transaction = {
      id,
      type,
      amountCents: body.amountCents,
      note: "",
      occurredAt: new Date().toISOString(),
      memberId: body.memberId,
      memberName: from.name,
      memberAccent: from.accent,
      toMemberId: body.toMemberId,
      toMemberName: to.name,
      createdByName: savedMember()?.name ?? null,
      pending: true,
    };

    // Экран не ждёт сеть: по мобильному запись в gist — это секунды, и всё это
    // время раньше висел неотзывчивый интерфейс со старыми цифрами.
    setTransactions((prev) => sortTransactions([draft, ...prev]));
    setError(null);
    setOpAmount("");
    // необычный тип — разовый выбор, следующая операция снова обычная
    setOpSpecial(null);
    sfx(type === "withdrawal" ? "remove" : "success");

    try {
      const res = await enqueue(() => createTransaction(body));
      rev.current = Math.max(rev.current, res.rev ?? 0);
      setSummaryBase(res.summary);
      setTransactions((prev) =>
        sortTransactions(prev.map((t) => (t.id === id ? res.transaction : t))),
      );
    } catch (err) {
      setTransactions((prev) => prev.filter((t) => t.id !== id));
      flashError(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  }

  const totalLabel = useMemo(
    () =>
      hideBalances ? HIDDEN_MONEY : formatMoney(summary?.totalCents ?? 0),
    [hideBalances, summary?.totalCents],
  );

  function toggleHideBalances() {
    setHideBalances((prev) => {
      const next = !prev;
      writeFlag(HIDE_BALANCES_KEY, next);
      return next;
    });
    sfx("nav");
  }

  function moneyLabel(cents: number) {
    return hideBalances ? HIDDEN_MONEY : formatMoney(cents);
  }

  const months = useMemo(() => groupByMonth(transactions), [transactions]);
  const mom = useMemo(() => monthOverMonth(transactions), [transactions]);

  if (!loggedIn) {
    return (
      <div className="auth-bg flex min-h-screen items-center justify-center p-4">
        <Card
          data-mounted={mounted ? "true" : "false"}
          className={`w-full max-w-md border-border/60 bg-background/80 backdrop-blur ${error ? "shake" : ""}`}
        >
          <CardHeader>
            <CardTitle className="font-heading text-4xl tracking-tight">
              <TextMorph as="span" locale="ru" duration={280}>
                ФИНА
              </TextMorph>
            </CardTitle>
            <CardDescription>Совместный счёт · веб-кабинет</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={onLogin}>
              <div className="grid gap-2">
                <Label>Кто ты?</Label>
                <div className="grid grid-cols-2 gap-2">
                  {NAMES.map((name) => (
                    <Button
                      key={name}
                      type="button"
                      variant={selectedName === name ? "default" : "outline"}
                      className="segment"
                      data-cuelume-press={SFX.nav}
                      onClick={() => setSelectedName(name)}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite">Код приглашения</Label>
                <Input
                  id="invite"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pin">PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" key={`err-${shakeError}`}>
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={loading}
                data-cuelume-press={SFX.primaryPress}
                className="w-full"
              >
                <span className={loading ? "content-busy" : "content-ready"}>
                  {loading ? "Входим…" : "Войти"}
                </span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    /* Фон кабинета ровный: карточек нет, зато липкий заголовок месяца может
       перекрывать строки непрозрачной подложкой того же цвета. */
    <div className="bg-background min-h-screen">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-4 md:p-8">
        {error && (
          <div
            key={`banner-${shakeError}`}
            className="shake rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[var(--composer-field)_480px] lg:gap-x-12">
          <div className="grid gap-4 lg:sticky lg:top-8 lg:self-start">
            <section
              className={`surface-enter grid gap-4 ${loading ? "content-busy" : "content-ready"}`}
            >
              <div className="grid gap-1.5">
                <p className="text-muted-foreground text-sm">Всего на счёте</p>
                <div className="font-heading flex items-center gap-2 text-4xl leading-none font-semibold md:gap-3 md:text-5xl tabular-nums">
                  <TextMorph as="span" locale="ru" duration={280}>
                    {totalLabel}
                  </TextMorph>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground -mt-0.5"
                    aria-label={hideBalances ? "Показать суммы" : "Скрыть суммы"}
                    aria-pressed={hideBalances}
                    data-cuelume-press={SFX.nav}
                    onClick={toggleHideBalances}
                  >
                    {hideBalances ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
              {/* 24px до крупной суммы: 16 из gap секции плюс свои 8. */}
              <div className="mt-2 grid grid-cols-2 gap-4">
                {(summary?.members ?? []).map((m, i) => (
                  <div
                    key={m.id}
                    className="stagger-item"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <p className="text-muted-foreground text-xs sm:text-sm">{m.name}</p>
                    {/* Баланс длинный, а плитка на телефоне — половина экрана:
                        кегль тянется за шириной вьюпорта и упирается в 20px. */}
                    <p className="text-[clamp(0.75rem,4vw,1.25rem)] font-semibold tabular-nums">
                      <TextMorph as="span" locale="ru" duration={240}>
                        {moneyLabel(m.balanceCents ?? 0)}
                      </TextMorph>
                    </p>
                    {!hideBalances && <MomDelta cents={mom?.members[m.id]} />}
                  </div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[clamp(0.75rem,3.4vw,0.875rem)]">
                <div className="stagger-item">
                  <p className="text-muted-foreground">Изи мани</p>
                  <TextMorph as="p" locale="ru" duration={240} className="font-medium tabular-nums">
                    {moneyLabel(summary?.accrualsCents ?? 0)}
                  </TextMorph>
                  {!hideBalances && <MomDelta cents={mom?.accrualsCents} />}
                </div>
              </div>
            </section>

            {/* Карточек больше нет — блоки делит линия: по 32px воздуха с каждой
                стороны (сверху 16 из gap колонки плюс mt-4). */}
            <section className="border-border/70 mt-4 border-t pt-8">
              <TxComposer
                type={opType}
                onTypeChange={setOpType}
                special={opSpecial}
                onSpecialChange={(next) => {
                  setOpSpecial(next);
                  if (next === "transfer") {
                    const members = summary?.members ?? [];
                    const fromId = memberIdByName(members, NAMES[0]);
                    const toId = memberIdByName(members, NAMES[1]);
                    if (fromId && toId) {
                      setOpMemberId(fromId);
                      setOpToMemberId(toId);
                      return;
                    }
                    setOpToMemberId((to) =>
                      to && to !== opMemberId
                        ? to
                        : otherMemberId(members, opMemberId),
                    );
                  }
                }}
                members={summary?.members ?? []}
                memberId={opMemberId}
                onMemberChange={setOpMemberId}
                toMemberId={opToMemberId}
                onToMemberChange={setOpToMemberId}
                amount={opAmount}
                onAmountChange={setOpAmount}
                onSubmit={submitOp}
                disabled={loading}
              />
            </section>
          </div>

          {/* На мобилке список сразу под композером, без второй линейки:
              черта остаётся только между цифрами и полем. */}
          <div
            className={`mt-8 lg:mt-0 ${loading ? "content-busy" : "content-ready"}`}
          >
            {months.map((month, i) => (
              /* Секции идут вплотную, воздух между месяцами даёт верхний
                 отступ заголовка: липкий заголовок держится до последней
                 строки месяца, и следующий выталкивает его без зазора. */
              <section key={month.key} className="space-y-1">
                {month.showYear && (
                  <div className="text-muted-foreground flex items-center gap-3 pt-12 text-xs font-medium tabular-nums">
                    <span className="border-border/70 flex-1 border-t" />
                    {month.year}
                    <span className="border-border/70 flex-1 border-t" />
                  </div>
                )}
                {/* Воздух между месяцами — на нелипкой обёртке вместе со
                    строками, чтобы sticky мог держаться до конца месяца,
                    а pt-10 уезжал. -mx-2/px-2 как у строк — колонки совпадают. */}
                <div
                  className={`space-y-1 ${i === 0 ? "pt-0" : month.showYear ? "pt-4" : "pt-10"}`}
                >
                  <div className="bg-background sticky top-0 z-10 -mx-2">
                    <div className="bg-muted flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5">
                      <h3 className="text-muted-foreground text-xs font-medium">
                        {month.label}
                      </h3>
                      <p
                        className={`text-xs font-medium tabular-nums ${month.totalCents < 0 ? "text-destructive/80" : "text-muted-foreground"}`}
                      >
                        <TextMorph as="span" locale="ru" duration={200}>
                          {`${month.totalCents < 0 ? "−" : "+"}${formatMoney(Math.abs(month.totalCents))}`}
                        </TextMorph>
                      </p>
                    </div>
                  </div>

                  {month.items.map((tx) =>
                  editing?.id === tx.id ? (
                    <form
                      key={tx.id}
                      className="bg-muted/30 my-1 grid gap-3 rounded-xl border p-3"
                      onSubmit={saveEdit}
                    >
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label>Тип</Label>
                          <select
                            className="field border-input bg-background h-10 rounded-md border px-3 text-base md:text-sm"
                            value={editing.type}
                            onChange={(e) => {
                              sfx("nav");
                              const nextType = e.target.value as TransactionType;
                              const toMemberId =
                                nextType === "transfer" &&
                                (!editing.toMemberId ||
                                  editing.toMemberId === editing.memberId)
                                  ? otherMemberId(
                                      summary?.members ?? [],
                                      editing.memberId,
                                    )
                                  : editing.toMemberId;
                              setEditing({
                                ...editing,
                                type: nextType,
                                toMemberId,
                              });
                            }}
                          >
                            {ALL_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-2">
                          <Label>Сумма</Label>
                          <Input
                            value={editing.amount}
                            onChange={(e) =>
                              setEditing({ ...editing, amount: e.target.value })
                            }
                            inputMode="decimal"
                            className="tabular-nums"
                            autoFocus
                          />
                        </div>
                        {needsMember(editing.type) && (
                          <div className="grid gap-2">
                            <Label>
                              {editing.type === "transfer" ? "От кого" : "Участник"}
                            </Label>
                            <select
                              className="field border-input bg-background h-10 rounded-md border px-3 text-base md:text-sm"
                              value={editing.memberId}
                              onChange={(e) => {
                                sfx("nav");
                                const memberId = e.target.value;
                                const toMemberId =
                                  editing.type === "transfer" &&
                                  memberId === editing.toMemberId
                                    ? otherMemberId(
                                        summary?.members ?? [],
                                        memberId,
                                      )
                                    : editing.toMemberId;
                                setEditing({ ...editing, memberId, toMemberId });
                              }}
                            >
                              {(summary?.members ?? []).map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {editing.type === "transfer" && (
                          <div className="grid gap-2">
                            <Label>Кому</Label>
                            <select
                              className="field border-input bg-background h-10 rounded-md border px-3 text-base md:text-sm"
                              value={editing.toMemberId}
                              onChange={(e) => {
                                sfx("nav");
                                const toMemberId = e.target.value;
                                const memberId =
                                  toMemberId === editing.memberId
                                    ? otherMemberId(
                                        summary?.members ?? [],
                                        toMemberId,
                                      )
                                    : editing.memberId;
                                setEditing({ ...editing, memberId, toMemberId });
                              }}
                            >
                              {(summary?.members ?? []).map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="grid gap-2">
                          <Label>Дата</Label>
                          <Input
                            type="date"
                            value={editing.date}
                            onChange={(e) =>
                              setEditing({ ...editing, date: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label>Комментарий</Label>
                        <Input
                          value={editing.note}
                          onChange={(e) =>
                            setEditing({ ...editing, note: e.target.value })
                          }
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-cuelume-press={SFX.secondary}
                          onClick={cancelEdit}
                        >
                          Отмена
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={loading}
                          data-cuelume-press={SFX.primaryPress}
                        >
                          Сохранить
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div
                      key={tx.id}
                      data-row-id={tx.id}
                      data-revealed={revealedId === tx.id ? "true" : "false"}
                      data-pressing={pressingId === tx.id ? "true" : "false"}
                      data-pending={tx.pending ? "true" : "false"}
                      className="tx-row stagger-item -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2"
                      onPointerDown={(e) => onRowPointerDown(e, tx)}
                      onPointerMove={onRowPointerMove}
                      onPointerUp={cancelLongPress}
                      onPointerCancel={cancelLongPress}
                      onPointerLeave={cancelLongPress}
                    >
                      {/* w-0: иначе неразрывный текст строки задаёт min-content всей странице */}
                      <div className="w-0 min-w-0 flex-1">
                        <p className="truncate text-sm leading-tight font-medium">
                          {TYPE_LABELS[tx.type]}
                          {txPartiesLabel(tx) && (
                            <span className="text-muted-foreground font-normal">
                              {` · ${txPartiesLabel(tx)}`}
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground mt-1 truncate text-xs leading-tight">
                          {[
                            noteWithoutMonth(tx.note, tx.occurredAt),
                            formatDayMonth(tx.occurredAt),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="row-swap shrink-0">
                        <span
                          className={`row-amount text-sm font-semibold tabular-nums ${tx.type === "withdrawal" ? "text-destructive" : "text-foreground"}`}
                        >
                          <TextMorph as="span" locale="ru" duration={200}>
                            {`${amountPrefix(tx.type)}${formatMoney(tx.amountCents)}`}
                          </TextMorph>
                        </span>
                        <div className="row-actions flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="xs"
                            data-cuelume-press={SFX.secondary}
                            onClick={() => startEdit(tx)}
                          >
                            Изменить
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            data-cuelume-press={SFX.secondary}
                            onClick={() => askRemove(tx)}
                          >
                            Удалить
                          </Button>
                        </div>
                      </div>
                    </div>
                  ),
                )}
                </div>
              </section>
            ))}
            {!months.length && (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Операций пока нет
              </p>
            )}
          </div>
        </div>

        {/* Выход — последнее, что есть на странице: под обеими колонками. */}
        <div className="flex">
          <Button
            variant="ghost"
            data-cuelume-press={SFX.logout}
            onClick={() => {
              logout();
              setLoggedIn(false);
            }}
          >
            Выйти
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogPopup>
          <div className="grid gap-1.5">
            <AlertDialogTitle>Удалить операцию?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${TYPE_LABELS[pendingDelete.type]} · ${formatMoney(pendingDelete.amountCents)} · ${formatDate(pendingDelete.occurredAt)}`
                : ""}
            </AlertDialogDescription>
            <p className="text-muted-foreground text-sm">Отменить не получится.</p>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialogClose
              render={<Button variant="ghost" data-cuelume-press={SFX.secondary} />}
            >
              Отмена
            </AlertDialogClose>
            <Button
              data-cuelume-press={SFX.remove}
              onClick={() => {
                if (pendingDelete) void removeTx(pendingDelete.id);
              }}
            >
              Удалить
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
