"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { TextMorph } from "torph/react";
import { bind } from "cuelume";
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
  type Member,
  type Summary,
  type Transaction,
  type TransactionType,
} from "@/lib/api";
import { SFX, sfx } from "@/lib/sounds";
import { TxComposer, digitsOf, type OpType } from "@/components/tx-composer";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

const NAMES = ["Аня", "Андрей"] as const;
const ACCRUAL_TYPES: TransactionType[] = ["interest", "cashback", "easy_money"];

function inviteFromUrl() {
  if (typeof window === "undefined") return "FINA26";
  return new URLSearchParams(window.location.search).get("invite") ?? "FINA26";
}

export function FinaApp() {
  const [member, setMember] = useState<Member | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("FINA26");
  const [pin, setPin] = useState("1425");
  const [selectedName, setSelectedName] = useState<"Аня" | "Андрей">("Андрей");
  const [accrualType, setAccrualType] = useState<TransactionType>("interest");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [opType, setOpType] = useState<OpType>("deposit");
  const [opAmount, setOpAmount] = useState("");
  const [opMemberId, setOpMemberId] = useState("");
  const opTypeSeeded = useRef(false);
  const [tab, setTab] = useState("home");
  const [shakeError, setShakeError] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    bind();
    setInviteCode(inviteFromUrl());
    const m = savedMember();
    if (m && localStorage.getItem("token")) {
      setMember(m);
      setLoggedIn(true);
    }
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

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await login(inviteCode, pin, selectedName);
      setMember(data.member);
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
    try {
      await createTransaction({
        type: opType,
        amountCents: value * 100,
        note: "",
        memberId: opMemberId || null,
      });
      setOpAmount("");
      sfx(opType === "withdrawal" ? "remove" : "success");
      await refresh();
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setLoading(false);
    }
  }

  async function onAddAccrual(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(",", ".").replace(/\s/g, ""));
    if (!value || value <= 0) {
      flashError("Введи сумму");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await createTransaction({
        type: accrualType,
        amountCents: Math.round(value * 100),
        note,
        memberId: null,
      });
      setAmount("");
      setNote("");
      sfx("success");
      await refresh();
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setLoading(false);
    }
  }

  const totalLabel = useMemo(
    () => formatMoney(summary?.totalCents ?? 0),
    [summary?.totalCents],
  );

  if (!loggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_10%_10%,oklch(0.93_0.04_160),transparent_40%),radial-gradient(circle_at_90%_0%,oklch(0.95_0.04_70),transparent_35%),oklch(0.97_0.01_120)] p-4">
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,oklch(0.93_0.04_160),transparent_40%),radial-gradient(circle_at_90%_0%,oklch(0.95_0.04_70),transparent_35%),oklch(0.97_0.01_120)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              <TextMorph as="span" locale="ru">
                ФИНА
              </TextMorph>
            </h1>
            <p className="text-muted-foreground text-sm">Ты: {member?.name}</p>
          </div>
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
        </header>

        {error && (
          <div
            key={`banner-${shakeError}`}
            className="shake rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="home" data-cuelume-press={SFX.nav}>
              Главная
            </TabsTrigger>
            <TabsTrigger value="ops" data-cuelume-press={SFX.nav}>
              Операции
            </TabsTrigger>
            <TabsTrigger value="stats" data-cuelume-press={SFX.nav}>
              Статистика
            </TabsTrigger>
          </TabsList>

          <TabsContent value="home" className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Card className={loading ? "content-busy" : "content-ready"}>
              <CardHeader>
                <CardDescription>Всего на счёте</CardDescription>
                <CardTitle className="font-heading text-4xl md:text-5xl tabular-nums">
                  <TextMorph as="span" locale="ru" duration={280}>
                    {totalLabel}
                  </TextMorph>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  {(summary?.members ?? []).map((m, i) => (
                    <div
                      key={m.id}
                      className="stagger-item rounded-xl border p-4"
                      style={{
                        borderColor: m.accent,
                        animationDelay: `${i * 40}ms`,
                      }}
                    >
                      <p className="text-sm text-muted-foreground">{m.name}</p>
                      <p className="text-xl font-semibold tabular-nums">
                        <TextMorph as="span" locale="ru" duration={240}>
                          {formatMoney(m.balanceCents ?? 0)}
                        </TextMorph>
                      </p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="stagger-item rounded-lg bg-muted/60 p-3">
                    <p className="text-muted-foreground">Проценты</p>
                    <TextMorph as="p" locale="ru" duration={240} className="font-medium tabular-nums">
                      {formatMoney(summary?.interestCents ?? 0)}
                    </TextMorph>
                  </div>
                  <div className="stagger-item rounded-lg bg-muted/60 p-3">
                    <p className="text-muted-foreground">Кэшбэк</p>
                    <TextMorph as="p" locale="ru" duration={240} className="font-medium tabular-nums">
                      {formatMoney(summary?.cashbackCents ?? 0)}
                    </TextMorph>
                  </div>
                  <div className="stagger-item rounded-lg bg-muted/60 p-3">
                    <p className="text-muted-foreground">Изи мани</p>
                    <TextMorph as="p" locale="ru" duration={240} className="font-medium tabular-nums">
                      {formatMoney(summary?.easyMoneyCents ?? 0)}
                    </TextMorph>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="self-start">
              <CardContent>
                <TxComposer
                  type={opType}
                  onTypeChange={setOpType}
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
          </TabsContent>

          <TabsContent value="ops" className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Начисления</CardTitle>
                <CardDescription>Проценты, кэшбэк, изи мани</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-3 sm:max-w-sm" onSubmit={onAddAccrual}>
                  <div className="grid gap-2">
                    <Label>Тип</Label>
                    <select
                      className="field border-input bg-background h-10 rounded-md border px-3 text-sm"
                      value={accrualType}
                      onChange={(e) => {
                        sfx("nav");
                        setAccrualType(e.target.value as TransactionType);
                      }}
                    >
                      {ACCRUAL_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Сумма</Label>
                    <Input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="1000"
                      inputMode="decimal"
                      className="tabular-nums"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Комментарий</Label>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    data-cuelume-press={SFX.primaryPress}
                  >
                    <span className={loading ? "content-busy" : "content-ready"}>
                      Сохранить
                    </span>
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className={loading ? "content-busy" : "content-ready"}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Все операции</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  data-cuelume-press={SFX.secondary}
                  onClick={() => void refresh()}
                >
                  Обновить
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3">
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="stagger-item flex items-start justify-between gap-3 border-b border-border/60 pb-3 last:border-0"
                  >
                    <div>
                      <p className="font-medium">
                        {tx.memberName ? `${tx.memberName} · ` : ""}
                        {TYPE_LABELS[tx.type]}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {tx.note || "—"} · {formatDate(tx.occurredAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={tx.type === "withdrawal" ? "destructive" : "secondary"}>
                        <TextMorph as="span" locale="ru" duration={200}>
                          {`${tx.type === "withdrawal" ? "−" : "+"}${formatMoney(tx.amountCents)}`}
                        </TextMorph>
                      </Badge>
                      <Button
                        variant="ghost"
                        size="xs"
                        data-cuelume-press={SFX.remove}
                        onClick={async () => {
                          await deleteTransaction(tx.id);
                          await refresh();
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stats" className="grid gap-4 sm:grid-cols-2">
            {(summary?.members ?? []).map((m) => (
              <Card key={m.id} className="stagger-item">
                <CardHeader>
                  <CardDescription>{m.name}</CardDescription>
                  <CardTitle className="tabular-nums">
                    <TextMorph as="span" locale="ru" duration={240}>
                      {formatMoney(m.balanceCents ?? 0)}
                    </TextMorph>
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
            <Card className="stagger-item">
              <CardHeader>
                <CardDescription>Вклады вместе</CardDescription>
                <CardTitle className="tabular-nums">
                  <TextMorph as="span" locale="ru" duration={240}>
                    {formatMoney(summary?.contributionsCents ?? 0)}
                  </TextMorph>
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="stagger-item">
              <CardHeader>
                <CardDescription>Проценты + кэшбэк</CardDescription>
                <CardTitle className="tabular-nums">
                  <TextMorph as="span" locale="ru" duration={240}>
                    {formatMoney(summary?.accrualsCents ?? 0)}
                  </TextMorph>
                </CardTitle>
              </CardHeader>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
