"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { TextMorph } from "torph/react";
import { bind } from "cuelume";
import { Eye, EyeOff } from "lucide-react";
import {
  TYPE_LABELS,
  createTransaction,
  deleteTransaction,
  fetchSummary,
  fetchTransactions,
  formatDate,
  formatMoney,
  login,
  logout,
  savedMember,
  savedToken,
  setApiBase,
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

/** Внесения и списания принадлежат участнику, начисления — общие. */
function needsMember(type: TransactionType) {
  return type === "deposit" || type === "withdrawal";
}

function monthLabel(date: Date) {
  const label = date.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1).replace(/\s*г\.$/, "");
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
    group.totalCents += tx.type === "withdrawal" ? -tx.amountCents : tx.amountCents;
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/** Черновик правки одной операции: суммы и даты живут строками, как в полях ввода. */
type EditDraft = {
  id: string;
  type: TransactionType;
  amount: string;
  memberId: string;
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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("FINA26");
  const [pin, setPin] = useState("1425");
  const [selectedName, setSelectedName] = useState<"Аня" | "Андрей">("Андрей");
  const [opType, setOpType] = useState<OpType>("deposit");
  const [opSpecial, setOpSpecial] = useState<SpecialType | null>(null);
  const [opAmount, setOpAmount] = useState("");
  const [opMemberId, setOpMemberId] = useState("");
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
    if (savedMember() && savedToken()) setLoggedIn(true);
    if (readFlag(HIDE_BALANCES_KEY)) setHideBalances(true);
    requestAnimationFrame(() => setMounted(true));
  }, []);

  /** Дефолты композера: участник — тот, кто вошёл; знак — как в его прошлой операции. */
  function seedOpDefaults(s: Summary, t: Transaction[]) {
    const me = savedMember();
    setOpMemberId((prev) => prev || me?.id || s.members[0]?.id || "");
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

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [s, t] = await Promise.all([fetchSummary(), fetchTransactions()]);
      setSummary(s);
      setTransactions(t);
      seedOpDefaults(s, t);
    } catch (e) {
      flashError(e instanceof Error ? e.message : "Ошибка загрузки");
      if (String(e).toLowerCase().includes("unauthorized")) {
        logout();
        setLoggedIn(false);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loggedIn) void refresh();
  }, [loggedIn]);

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

  function onRowPointerDown(e: React.PointerEvent, id: string) {
    if (e.pointerType === "mouse") return;
    cancelLongPress();
    setPressingId(id);
    const timer = window.setTimeout(() => {
      longPress.current = null;
      setPressingId(null);
      setRevealedId(id);
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

  function startEdit(tx: Transaction) {
    setRevealedId(null);
    setEditing({
      id: tx.id,
      type: tx.type,
      amount: String(tx.amountCents / 100),
      memberId: tx.memberId ?? "",
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
    setLoading(true);
    setError(null);
    try {
      await updateTransaction(editing.id, {
        type: editing.type,
        amountCents: Math.round(value * 100),
        note: editing.note,
        memberId: needsMember(editing.type) ? editing.memberId || null : null,
        occurredAt: withDate(editing.occurredAt, editing.date),
      });
      cancelEdit();
      sfx("success");
      await refresh();
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setLoading(false);
    }
  }

  /** Удаление необратимо, поэтому идёт через попап подтверждения. */
  function askRemove(tx: Transaction) {
    setRevealedId(null);
    setPendingDelete(tx);
  }

  async function removeTx(id: string) {
    setLoading(true);
    setError(null);
    setPendingDelete(null);
    try {
      await deleteTransaction(id);
      if (editing?.id === id) cancelEdit();
      await refresh();
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setLoading(false);
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await login(inviteCode, pin, selectedName);
      setSummary(data.summary);
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
    setLoading(true);
    setError(null);
    const type = opSpecial ?? opType;
    try {
      await createTransaction({
        type,
        amountCents: value * 100,
        note: "",
        memberId: needsMember(type) ? opMemberId || null : null,
      });
      setOpAmount("");
      // необычный тип — разовый выбор, следующая операция снова обычная
      setOpSpecial(null);
      sfx(type === "withdrawal" ? "remove" : "success");
      await refresh();
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setLoading(false);
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

  if (!loggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_10%_10%,oklch(0.94_0_0),transparent_40%),radial-gradient(circle_at_90%_0%,oklch(0.96_0_0),transparent_35%),oklch(0.975_0_0)] p-4">
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,oklch(0.94_0_0),transparent_40%),radial-gradient(circle_at_90%_0%,oklch(0.96_0_0),transparent_35%),oklch(0.975_0_0)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-8">
        {error && (
          <div
            key={`banner-${shakeError}`}
            className="shake rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[var(--composer-column)_minmax(0,1fr)]">
          <div className="grid gap-4 lg:sticky lg:top-8 lg:self-start">
            <Card className={loading ? "content-busy" : "content-ready"}>
              <CardHeader>
                <CardDescription>Всего на счёте</CardDescription>
                <CardTitle className="font-heading flex items-center gap-2 text-4xl md:gap-3 md:text-5xl tabular-nums">
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
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  {(summary?.members ?? []).map((m, i) => (
                    <div
                      key={m.id}
                      className="stagger-item bg-muted/60 rounded-xl p-4"
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      <p className="text-sm text-muted-foreground">{m.name}</p>
                      <p className="text-xl font-semibold tabular-nums">
                        <TextMorph as="span" locale="ru" duration={240}>
                          {moneyLabel(m.balanceCents ?? 0)}
                        </TextMorph>
                      </p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="stagger-item rounded-lg bg-muted/60 p-3">
                    <p className="text-muted-foreground">Изи мани</p>
                    <TextMorph as="p" locale="ru" duration={240} className="font-medium tabular-nums">
                      {moneyLabel(summary?.accrualsCents ?? 0)}
                    </TextMorph>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <TxComposer
                  type={opType}
                  onTypeChange={setOpType}
                  special={opSpecial}
                  onSpecialChange={setOpSpecial}
                  members={summary?.members ?? []}
                  memberId={opMemberId}
                  onMemberChange={setOpMemberId}
                  amount={opAmount}
                  onAmountChange={setOpAmount}
                  onSubmit={submitOp}
                  disabled={loading}
                />
              </CardContent>
            </Card>

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

          <div className="grid gap-4">
            <Card className={loading ? "content-busy" : "content-ready"}>
              <CardContent>
                {months.map((month) => (
                  /* Секции идут вплотную, воздух между месяцами даёт верхний
                     отступ заголовка: липкий заголовок держится до последней
                     строки месяца, и следующий выталкивает его без зазора. */
                  <section key={month.key} className="space-y-1">
                    <div className="border-border/70 bg-card sticky top-0 z-10 -mx-5 flex items-baseline justify-between gap-3 border-b px-5 pt-5 pb-1.5 backdrop-blur-sm">
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
                                  setEditing({
                                    ...editing,
                                    type: e.target.value as TransactionType,
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
                                <Label>Участник</Label>
                                <select
                                  className="field border-input bg-background h-10 rounded-md border px-3 text-base md:text-sm"
                                  value={editing.memberId}
                                  onChange={(e) => {
                                    sfx("nav");
                                    setEditing({ ...editing, memberId: e.target.value });
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
                          className="tx-row stagger-item -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2"
                          onPointerDown={(e) => onRowPointerDown(e, tx.id)}
                          onPointerMove={onRowPointerMove}
                          onPointerUp={cancelLongPress}
                          onPointerCancel={cancelLongPress}
                          onPointerLeave={cancelLongPress}
                        >
                          {/* w-0: иначе неразрывный текст строки задаёт min-content всей странице */}
                          <div className="w-0 min-w-0 flex-1">
                            <p className="truncate text-sm leading-tight font-medium">
                              {TYPE_LABELS[tx.type]}
                              {tx.memberName && (
                                <span className="text-muted-foreground font-normal">
                                  {` · ${tx.memberName}`}
                                </span>
                              )}
                            </p>
                            <p className="text-muted-foreground mt-1 truncate text-xs leading-tight">
                              {[
                                noteWithoutMonth(tx.note, tx.occurredAt),
                                formatDate(tx.occurredAt),
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
                                {`${tx.type === "withdrawal" ? "−" : "+"}${formatMoney(tx.amountCents)}`}
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
                  </section>
                ))}
                {!months.length && (
                  <p className="text-muted-foreground py-6 text-center text-sm">
                    Операций пока нет
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
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
