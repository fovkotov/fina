"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { TextMorph } from "torph/react";
import { bind, play } from "cuelume";
import {
  TYPE_LABELS,
  createTransaction,
  deleteTransaction,
  fetchShare,
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
  const [txType, setTxType] = useState<TransactionType>("deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [txMemberId, setTxMemberId] = useState("");
  const [shareText, setShareText] = useState("");
  const [tab, setTab] = useState("home");

  useEffect(() => {
    bind();
    setInviteCode(inviteFromUrl());
    const m = savedMember();
    if (m && localStorage.getItem("token")) {
      setMember(m);
      setLoggedIn(true);
    }
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [s, t, share] = await Promise.all([
        fetchSummary(),
        fetchTransactions(),
        fetchShare(),
      ]);
      setSummary(s);
      setTransactions(t);
      setShareText(
        `ФИНА — совместный счёт\nКод: ${share.inviteCode}\nPIN: 1425\nВеб: ${share.webUrl}\nВыбери имя: Аня или Андрей`,
      );
      if (!txMemberId && s.members[0]) setTxMemberId(s.members[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      play("error");
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
    play("press");
    setLoading(true);
    setError(null);
    try {
      const data = await login(inviteCode, pin, selectedName);
      setMember(data.member);
      setSummary(data.summary);
      setLoggedIn(true);
      play("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
      play("error");
    } finally {
      setLoading(false);
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    play("pulse");
    const value = Number(amount.replace(",", ".").replace(/\s/g, ""));
    if (!value || value <= 0) {
      setError("Введи сумму");
      play("error");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const needsMember = txType === "deposit" || txType === "withdrawal";
      await createTransaction({
        type: txType,
        amountCents: Math.round(value * 100),
        note,
        memberId: needsMember ? txMemberId : null,
      });
      setAmount("");
      setNote("");
      play(txType === "withdrawal" ? "droplet" : "success");
      await refresh();
      setTab("ops");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      play("error");
    } finally {
      setLoading(false);
    }
  }

  const needsMember = txType === "deposit" || txType === "withdrawal";
  const totalLabel = useMemo(
    () => formatMoney(summary?.totalCents ?? 0),
    [summary?.totalCents],
  );

  if (!loggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_10%_10%,oklch(0.93_0.04_160),transparent_40%),radial-gradient(circle_at_90%_0%,oklch(0.95_0.04_70),transparent_35%),oklch(0.97_0.01_120)] p-4">
        <Card className="w-full max-w-md border-border/60 bg-background/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="font-heading text-4xl tracking-tight">
              <TextMorph as="span" locale="ru">
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
                      data-cuelume-press="sparkle"
                      data-cuelume-release="tick"
                      onClick={() => {
                        play("sparkle");
                        setSelectedName(name);
                      }}
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
                  data-cuelume-press="tick"
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
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={loading}
                data-cuelume-press="press"
                data-cuelume-release="release"
                className="w-full"
              >
                {loading ? "Входим…" : "Войти"}
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
            data-cuelume-press="whisper"
            onClick={() => {
              play("whisper");
              logout();
              setLoggedIn(false);
            }}
          >
            Выйти
          </Button>
        </header>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Tabs
          value={tab}
          onValueChange={(v) => {
            play("toggle");
            setTab(v);
          }}
        >
          <TabsList data-cuelume-press="scan">
            <TabsTrigger value="home" data-cuelume-press="sparkle">
              Главная
            </TabsTrigger>
            <TabsTrigger value="ops" data-cuelume-press="tick">
              Операции
            </TabsTrigger>
            <TabsTrigger value="stats" data-cuelume-press="chime">
              Статистика
            </TabsTrigger>
            <TabsTrigger value="share" data-cuelume-press="bloom">
              Шаринг
            </TabsTrigger>
          </TabsList>

          <TabsContent value="home" className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader>
                <CardDescription>Всего на счёте</CardDescription>
                <CardTitle className="font-heading text-4xl md:text-5xl">
                  <TextMorph as="span" locale="ru" duration={500}>
                    {totalLabel}
                  </TextMorph>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  {(summary?.members ?? []).map((m) => (
                    <div
                      key={m.id}
                      className="rounded-xl border p-4"
                      style={{ borderColor: m.accent }}
                    >
                      <p className="text-sm text-muted-foreground">{m.name}</p>
                      <p className="text-xl font-semibold">
                        <TextMorph as="span" locale="ru">
                          {formatMoney(m.balanceCents ?? 0)}
                        </TextMorph>
                      </p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-muted-foreground">Проценты</p>
                    <TextMorph as="p" locale="ru" className="font-medium">
                      {formatMoney(summary?.interestCents ?? 0)}
                    </TextMorph>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-muted-foreground">Кэшбэк</p>
                    <TextMorph as="p" locale="ru" className="font-medium">
                      {formatMoney(summary?.cashbackCents ?? 0)}
                    </TextMorph>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-muted-foreground">Изи мани</p>
                    <TextMorph as="p" locale="ru" className="font-medium">
                      {formatMoney(summary?.easyMoneyCents ?? 0)}
                    </TextMorph>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Добавить операцию</CardTitle>
                <CardDescription>Внесение, списание, проценты…</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-3" onSubmit={onAdd}>
                  <div className="grid gap-2">
                    <Label>Тип</Label>
                    <select
                      className="border-input bg-background h-10 rounded-md border px-3 text-sm"
                      value={txType}
                      onChange={(e) => {
                        play("toggle");
                        setTxType(e.target.value as TransactionType);
                      }}
                      data-cuelume-press="toggle"
                    >
                      {Object.entries(TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
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
                    />
                  </div>
                  {needsMember && (
                    <div className="grid gap-2">
                      <Label>Кто</Label>
                      <select
                        className="border-input bg-background h-10 rounded-md border px-3 text-sm"
                        value={txMemberId}
                        onChange={(e) => {
                          play("tick");
                          setTxMemberId(e.target.value);
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
                    <Label>Комментарий</Label>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    data-cuelume-press="pulse"
                    data-cuelume-release="sparkle"
                  >
                    Сохранить
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ops">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Все операции</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  data-cuelume-press="scan"
                  onClick={() => {
                    play("loading");
                    void refresh();
                  }}
                >
                  Обновить
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3">
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-start justify-between gap-3 border-b border-border/60 pb-3 last:border-0"
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
                        <TextMorph as="span" locale="ru">
                          {`${tx.type === "withdrawal" ? "−" : "+"}${formatMoney(tx.amountCents)}`}
                        </TextMorph>
                      </Badge>
                      <Button
                        variant="ghost"
                        size="xs"
                        data-cuelume-press="droplet"
                        onClick={async () => {
                          play("droplet");
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
              <Card key={m.id}>
                <CardHeader>
                  <CardDescription>{m.name}</CardDescription>
                  <CardTitle>
                    <TextMorph as="span" locale="ru">
                      {formatMoney(m.balanceCents ?? 0)}
                    </TextMorph>
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
            <Card>
              <CardHeader>
                <CardDescription>Вклады вместе</CardDescription>
                <CardTitle>
                  <TextMorph as="span" locale="ru">
                    {formatMoney(summary?.contributionsCents ?? 0)}
                  </TextMorph>
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Проценты + кэшбэк</CardDescription>
                <CardTitle>
                  <TextMorph as="span" locale="ru">
                    {formatMoney(summary?.accrualsCents ?? 0)}
                  </TextMorph>
                </CardTitle>
              </CardHeader>
            </Card>
          </TabsContent>

          <TabsContent value="share">
            <Card>
              <CardHeader>
                <CardTitle>Поделиться</CardTitle>
                <CardDescription>
                  Отправь Ане — она откроет веб или приложение и выберет своё имя.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <pre className="bg-muted/50 overflow-x-auto rounded-lg p-4 text-sm whitespace-pre-wrap">
                  {shareText}
                </pre>
                <Button
                  data-cuelume-press="success"
                  onClick={async () => {
                    await navigator.clipboard.writeText(shareText);
                    play("success");
                  }}
                >
                  Скопировать
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
