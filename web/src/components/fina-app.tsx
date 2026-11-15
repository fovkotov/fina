"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { TextMorph } from "torph/react";
import { bind } from "cuelume";
import { Eye, EyeOff } from "lucide-react";
import {
  MONEY_GROUP_SEPARATOR,
  TYPE_LABELS,
  applyPending,
  createTransaction,
  deleteTransaction,
  fetchSummary,
  fetchTransactions,
  formatDate,
  formatDayMonth,
  formatMoney,
  login,
  logout,
  readSummaryCache,
  readTransactionsCache,
  recomputeSummary,
  reorderOccurredAt,
  saveSummaryCache,
  saveTxCache,
  savedMember,
  savedToken,
  setApiBase,
  sortTransactions,
  transactionTypeLabel,
  updateTransaction,
  type Account,
  type Summary,
  type Transaction,
  type TransactionType,
} from "@/lib/api";
import { CREDIT_IMAGES } from "@/lib/assets";
import { SFX, sfx } from "@/lib/sounds";
import {
  TxComposer,
  amountToCents,
  formatAmountInput,
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
const ACCOUNTS = [
  { id: "rocket", label: "Рокет" },
  { id: "yandex", label: "Яндекс" },
] as const;
const NAMES = ["Аня", "Андрей"] as const;
const ALL_TYPES = Object.keys(TYPE_LABELS) as TransactionType[];
const HIDE_BALANCES_KEY = "fina-hide-balances";
const HIDDEN_MONEY = "••••••";

function moneyParts(cents: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).formatToParts(cents / 100);
}

function formatRollingMoney(cents: number) {
  return moneyParts(cents)
    .map((part) => (part.type === "group" ? MONEY_GROUP_SEPARATOR : part.value))
    .join("");
}

/**
 * Крупная сумма: группы разрядов отдельно, между ними неразрывный пробел.
 * Ключи справа, чтобы новый разряд слева не перезапускал анимацию младших разрядов.
 */
function wideMoneyPieces(cents: number) {
  const pieces: { gap: boolean; text: string }[] = [];
  let buf = "";
  for (const part of moneyParts(Math.abs(cents))) {
    if (part.type === "group") {
      if (buf) pieces.push({ gap: false, text: buf });
      buf = "";
      pieces.push({ gap: true, text: MONEY_GROUP_SEPARATOR });
    } else {
      buf += part.value;
    }
  }
  if (buf) pieces.push({ gap: false, text: buf });
  return pieces;
}

const moneyMorph = {
  as: "span" as const,
  locale: "ru",
  numbers: true,
  duration: 400,
  ease: "cubic-bezier(0.23, 1, 0.32, 1)",
};

/** Разряды крутятся, ₽ стоит рядом. `sign` — для дельты, где плюс тоже явный. */
function RollingMoney({
  cents,
  hidden = false,
  sign,
  wideGroups = false,
}: {
  cents: number;
  hidden?: boolean;
  sign?: "+" | "−";
  /** Крупная сумма анимирует группы разрядов отдельно. */
  wideGroups?: boolean;
}) {
  if (!hidden && wideGroups) {
    const pieces = wideMoneyPieces(cents);
    const fromEnd = pieces.length;
    return (
      <>
        {pieces.map((piece, i) =>
          piece.gap ? (
            <span key={`gap-${fromEnd - i}`} className="group-gap" aria-hidden="true">
              {piece.text}
            </span>
          ) : (
            <TextMorph key={`num-${fromEnd - i}`} {...moneyMorph}>
              {piece.text}
            </TextMorph>
          ),
        )}
        {"\u00A0₽"}
      </>
    );
  }

  const text = hidden
    ? HIDDEN_MONEY
    : `${sign ?? ""}${formatRollingMoney(sign ? Math.abs(cents) : cents)}`;
  return (
    <>
      <TextMorph {...moneyMorph}>{text}</TextMorph>
      {!hidden && "\u00A0₽"}
    </>
  );
}

/** Соседние цифры не должны выпадать в один и тот же оттенок. */
let lastDigitHue = -1;

function brightDigitColor() {
  let hue = Math.random() * 360;
  if (lastDigitHue >= 0) {
    for (let i = 0; i < 8; i++) {
      const delta = Math.abs(hue - lastDigitHue);
      const apart = Math.min(delta, 360 - delta);
      if (apart >= 48) break;
      hue = Math.random() * 360;
    }
  }
  lastDigitHue = hue;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? `oklch(0.82 0.16 ${hue})` : `oklch(0.55 0.2 ${hue})`;
}

function onTotalDigitOver(event: MouseEvent<HTMLElement>) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const el = event.target;
  if (!(el instanceof HTMLElement) || !el.hasAttribute("torph-item")) return;
  if (!/\d/.test(el.textContent ?? "")) return;
  el.style.color = brightDigitColor();
}

function onTotalDigitOut(event: MouseEvent<HTMLElement>) {
  const el = event.target;
  if (!(el instanceof HTMLElement) || !el.hasAttribute("torph-item")) return;
  el.style.color = "";
}

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

/** Пополнение, проценты и кэшбэк приходят на счёт — цифра зелёная. */
function amountTone(type: TransactionType) {
  if (type === "withdrawal") return "text-destructive";
  if (type === "deposit" || type === "interest" || type === "cashback") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  return "text-foreground";
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

/**
 * Насколько цифра выросла за текущий календарный месяц — против конца прошлого.
 * `totalCents` — весь капитал: внесения, списания и начисления. Перевод внутри
 * семьи сумму не двигает.
 */
function monthOverMonth(list: Transaction[], now = new Date()) {
  const currentKey = calendarMonthKey(now);
  const hasPreviousMonth = list.some((tx) => monthKeyOf(tx.occurredAt) < currentKey);
  if (!hasPreviousMonth) return null;

  let accrualsCents = 0;
  let totalCents = 0;
  for (const tx of list) {
    if (monthKeyOf(tx.occurredAt) !== currentKey) continue;
    if (tx.type === "interest" || tx.type === "cashback") {
      accrualsCents += tx.amountCents;
      totalCents += tx.amountCents;
    } else if (tx.type === "deposit") {
      totalCents += tx.amountCents;
    } else if (tx.type === "withdrawal") {
      totalCents -= tx.amountCents;
    }
  }
  return { accrualsCents, totalCents };
}

function MomDelta({ cents }: { cents: number | null | undefined }) {
  if (cents == null || cents === 0) return null;
  const negative = cents < 0;
  return (
    <p
      className={`mt-[3px] text-xs font-medium tabular-nums ${
        negative
          ? "text-muted-foreground"
          : "text-emerald-600/70 dark:text-emerald-400/60"
      }`}
    >
      <RollingMoney cents={cents} sign={negative ? "−" : "+"} />
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

/** Долгое нажатие: палец почти не сдвинулся. Дальше — либо действия, либо перетаскивание. */
const HOLD_MS = 420;
const HOLD_SLOP_PX = 10;

/** Куда встанет строка среди остальных: палец ниже середины чужой строки — слот после неё. */
function dropIndexAt(clientY: number, draggedId: string) {
  const rows = document.querySelectorAll<HTMLElement>("[data-row-id]");
  let index = 0;
  for (const row of rows) {
    if (row.dataset.dragging === "true" || row.dataset.rowId === draggedId) continue;
    const rect = row.getBoundingClientRect();
    if (rect.height === 0) continue;
    if (clientY > rect.top + rect.height / 2) index += 1;
    else break;
  }
  return index;
}

type RowDrag = {
  id: string;
  /** Слот среди остальных строк, свежие сверху. Совпадает с исходным — порядок не менялся. */
  index: number;
  originIndex: number;
  height: number;
  left: number;
  width: number;
  grabOffset: number;
  grabX: number;
};

function TxRowBody({
  tx,
  onEdit,
  onRemove,
}: {
  tx: Transaction;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const note = noteWithoutMonth(tx.note, tx.occurredAt);
  return (
    <>
      {/* w-0: иначе неразрывный текст строки задаёт min-content всей странице */}
      <div className="w-0 min-w-0 flex-1">
        <p className="truncate text-sm leading-tight font-medium">
          {transactionTypeLabel(tx.type, tx.account)}
          {txPartiesLabel(tx) && (
            <span className="text-muted-foreground font-normal">
              {` · ${txPartiesLabel(tx)}`}
            </span>
          )}
        </p>
        <p className="text-muted-foreground mt-1 flex min-w-0 text-xs leading-tight">
          {note ? (
            <>
              <span className="min-w-0 truncate">{note}</span>
              <span className="shrink-0">{" · "}</span>
            </>
          ) : null}
          <span className="shrink-0 tabular-nums">
            {formatDayMonth(tx.occurredAt)}
          </span>
        </p>
      </div>
      <div className="row-swap shrink-0">
        {/* Историческая сумма не меняется. TextMorph на каждой строке — это
            тысячи torph-item и лаг скролла на телефоне. Крутим только черновик,
            который только что появился. */}
        <span
          className={`row-amount text-sm font-semibold tabular-nums ${amountTone(tx.type)}`}
        >
          {tx.pending ? (
            <TextMorph as="span" locale="ru" duration={200}>
              {`${amountPrefix(tx.type)}${formatMoney(tx.amountCents)}`}
            </TextMorph>
          ) : (
            `${amountPrefix(tx.type)}${formatMoney(tx.amountCents)}`
          )}
        </span>
        <div className="row-actions flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            data-cuelume-press={SFX.secondary}
            onClick={onEdit}
          >
            Изменить
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            data-cuelume-press={SFX.secondary}
            onClick={onRemove}
          >
            Удалить
          </Button>
        </div>
      </div>
    </>
  );
}

const CREDIT_PARTICLE_COUNT = 32;
const CREDIT_PARTICLES = Array.from({ length: CREDIT_PARTICLE_COUNT }, (_, index) => {
  const angle = (index / CREDIT_PARTICLE_COUNT) * Math.PI * 2;
  const distance = 12 + (index % 4) * 5;
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  return {
    "--credit-x": `${x}vmin`,
    "--credit-y": `${y - 8}vmin`,
    "--credit-drop": `${y + 18}vmin`,
    "--credit-spin": `${index % 2 ? 180 : -180}deg`,
    animationDelay: `${(index % 4) * 35}ms`,
  } as CSSProperties;
});

function CreditCelebration({ onEnd }: { onEnd: () => void }) {
  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-hidden">
      <Image
        src={CREDIT_IMAGES.portrait}
        alt=""
        width={512}
        height={512}
        loading="eager"
        unoptimized
        className="credit-portrait col-start-1 row-start-1 h-auto max-h-[65dvh] w-auto max-w-[68vw] object-contain"
        onAnimationEnd={onEnd}
      />
      {CREDIT_PARTICLES.map((style, index) => (
        <Image
          key={index}
          src={CREDIT_IMAGES.particle}
          alt=""
          width={160}
          height={107}
          loading="eager"
          unoptimized
          className="credit-particle col-start-1 row-start-1 h-auto w-[clamp(30px,8vmin,66px)]"
          style={style}
        />
      ))}
    </div>,
    document.body,
  );
}

export function FinaApp() {
  const [celebrations, setCelebrations] = useState<string[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  /** С сервера берём только неизменяемую часть: кто участники и как зовут кабинет. */
  const [summaryBase, setSummaryBase] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [account, setAccount] = useState<Account>("rocket");
  const accountTransactions = useMemo(
    () => transactions.filter((tx) => (tx.account ?? "rocket") === account),
    [transactions, account],
  );
  /** Версия сводки и версия списка живут отдельно: список может отстать, цифры — нет. */
  const [ledgerRev, setLedgerRev] = useState(0);
  const [txRev, setTxRev] = useState(-1);
  /** Кэш списка читаем после первого кадра шапки, чтобы не разбирать его до отрисовки. */
  const [txHydrated, setTxHydrated] = useState(false);
  const [txFailed, setTxFailed] = useState(false);
  /** Версия данных на сервере: отставший фоновый ответ не должен затирать свежий. */
  const rev = useRef(0);
  const txRevRef = useRef(-1);
  const loadErrorShown = useRef(false);
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
   * Пока список не догнал сводку, цифры берём из неё: пересчёт по пустому или
   * старому списку обнулил бы шапку. Когда список тот же версии — считаем сами,
   * чтобы оптимистичная строка сразу двигала сумму.
   */
  const summaries = useMemo(() => {
    if (!summaryBase) return null;
    const { yandex, ...rocket } = summaryBase;
    const summarize = (base: Summary, account: Account) => {
      const list = transactions.filter((tx) => (tx.account ?? "rocket") === account);
      if (txRev >= 0 && txRev >= ledgerRev) return recomputeSummary(base, list);
      return applyPending(base, list.filter((tx) => tx.pending));
    };
    return {
      ...summarize(rocket, "rocket"),
      yandex: yandex && summarize(yandex, "yandex"),
    };
  }, [summaryBase, transactions, txRev, ledgerRev]);
  const summary = account === "rocket" ? summaries : summaries?.yandex;
  const overallTotal = (summaries?.totalCents ?? 0) + (summaries?.yandex?.totalCents ?? 0);
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
  const [mountScreen, setMountScreen] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  /** Операция, для которой открыт попап подтверждения удаления. */
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  /** Строка, у которой открыты действия: на тапскрине — по долгому нажатию. */
  const [revealedId, setRevealedId] = useState<string | null>(null);
  /** Утапливание строки без setState: иначе каждый скролл перерисовывает весь список. */
  const pressRow = useRef<HTMLElement | null>(null);
  /** Жесты списка читаем в момент события: сам список не собирается заново на каждый символ суммы. */
  const gestureLive = useRef({
    onRowPointerDown: (_e: React.PointerEvent, _tx: Transaction) => {},
    startEdit: (_tx: Transaction) => {},
    askRemove: (_tx: Transaction) => {},
    saveEdit: (_e: FormEvent) => {},
    cancelEdit: () => {},
  });
  /** Поднятая строка. Пока палец не отпущен в другом слоте, сервер не трогаем. */
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const longPress = useRef<{ timer: number; pointerId: number } | null>(null);
  const dragRef = useRef<(RowDrag & { pointerId: number; y: number }) | null>(null);
  const liftRef = useRef<HTMLDivElement | null>(null);
  const transactionsRef = useRef(accountTransactions);
  transactionsRef.current = accountTransactions;
  /** Слушатели жеста живут на window: строка уезжает в портал и теряет capture. */
  const gestureCleanup = useRef<(() => void) | null>(null);
  /** Отпускание после перетаскивания не должно кликнуть то, что оказалось под пальцем. */
  const suppressClick = useRef(false);

  // Появление заново на каждом экране. Сброс прямо в рендере, иначе Safari
  // успевает нарисовать кабинет уже в конечном состоянии и анимацию пропускает.
  if (mountScreen !== loggedIn) {
    setMountScreen(loggedIn);
    setMounted(false);
  }

  useEffect(() => {
    bind();
    applyApiFromUrl();
    setInviteCode(inviteFromUrl());
    if (readFlag(HIDE_BALANCES_KEY)) setHideBalances(true);
    // Сессия есть — шапку рисуем из маленького кэша сразу, список читаем следующим кадром.
    if (savedMember() && savedToken()) {
      const cached = readSummaryCache();
      if (cached) {
        rev.current = cached.rev;
        setLedgerRev(cached.rev);
        setSummaryBase(cached.summary);
        seedMembers(cached.summary);
      }
      setLoggedIn(true);
      requestAnimationFrame(() => {
        const cachedTx = readTransactionsCache();
        startTransition(() => {
          // Сеть могла успеть раньше кадра — старый кэш её не затирает.
          if (cachedTx && txRevRef.current < 0) {
            txRevRef.current = cachedTx.rev;
            setTxRev(cachedTx.rev);
            setTransactions(cachedTx.transactions);
            seedOpType(cachedTx.transactions);
          }
          setTxHydrated(true);
        });
      });
      void refresh({ background: Boolean(cached), silent: Boolean(cached) });
    }
  }, []);

  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      void document.documentElement.offsetHeight;
      inner = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [loggedIn]);

  /**
   * В кэш кладём только подтверждённое: иначе после перезапуска на экране
   * висела бы операция, которая на сервер так и не доехала. Список пишем
   * отдельно и только когда он той же версии, что и цифры.
   */
  useEffect(() => {
    if (!summaries || !summaryBase) return;
    if (transactions.some((t) => t.pending)) return;
    if (txRev >= 0 && txRev >= ledgerRev) {
      saveSummaryCache(summaries, txRev);
      saveTxCache(transactions, txRev);
      return;
    }
    if (ledgerRev > 0) saveSummaryCache(summaryBase, ledgerRev);
  }, [summaries, summaryBase, transactions, txRev, ledgerRev]);

  /** Участник композера известен из сводки — список для этого не нужен. */
  function seedMembers(s: Summary) {
    const me = savedMember();
    const fromId = me?.id || s.members[0]?.id || "";
    setOpMemberId((prev) => prev || fromId);
    setOpToMemberId((prev) => prev || otherMemberId(s.members, fromId));
  }

  /** Знак — как в прошлой операции вошедшего. Ставим один раз, когда список уже есть. */
  function seedOpType(t: Transaction[]) {
    if (opTypeSeeded.current) return;
    opTypeSeeded.current = true;
    const me = savedMember();
    const last = t.find(
      (x) =>
        (x.account ?? "rocket") === "rocket" &&
        (x.type === "deposit" || x.type === "withdrawal") &&
        (me ? x.createdByName === me.name : true),
    );
    if (last) setOpType(last.type as OpType);
  }

  /** Запись сдвинула версию. Список считаем свежим, только если он уже был целиком. */
  function noteWrite(serverRev: number | undefined) {
    if (serverRev == null) return;
    rev.current = Math.max(rev.current, serverRev);
    setLedgerRev((prev) => Math.max(prev, serverRev));
    if (txRevRef.current >= 0) {
      txRevRef.current = Math.max(txRevRef.current, serverRev);
      setTxRev(txRevRef.current);
    }
  }

  function flashError(message: string) {
    setError(message);
    setShakeError((n) => n + 1);
    sfx("error");
  }

  function failLoad(e: unknown, silent: boolean | undefined) {
    if (!silent && !loadErrorShown.current) {
      loadErrorShown.current = true;
      flashError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
    if (String(e).toLowerCase().includes("unauthorized")) {
      logout();
      setLoggedIn(false);
      setSummaryBase(null);
      setTransactions([]);
      setLedgerRev(0);
      txRevRef.current = -1;
      setTxRev(-1);
      setTxHydrated(false);
      setTxFailed(false);
      rev.current = 0;
    }
  }

  async function loadSummary(silent?: boolean) {
    try {
      const { summary: s, rev: serverRev } = await fetchSummary();
      if (!savedToken()) return;
      if (serverRev != null && serverRev < rev.current) return;
      if (serverRev != null) {
        rev.current = serverRev;
        setLedgerRev(serverRev);
      }
      setSummaryBase(s);
      seedMembers(s);
    } catch (e) {
      failLoad(e, silent);
    }
  }

  async function loadTransactions(silent?: boolean) {
    try {
      const { transactions: t, rev: serverRev } = await fetchTransactions();
      if (!savedToken()) return;
      // Отставший список не затирает уже показанный. Пустой экран — заполняем всё равно.
      if (serverRev != null && serverRev < rev.current && txRevRef.current >= 0) return;
      if (serverRev != null) {
        txRevRef.current = serverRev;
        rev.current = Math.max(rev.current, serverRev);
      } else if (txRevRef.current < 0) {
        txRevRef.current = rev.current;
      }
      const nextRev = txRevRef.current;
      startTransition(() => {
        setTransactions((prev) =>
          sortTransactions([
            ...t,
            ...prev.filter((x) => x.pending && !t.some((s) => s.id === x.id)),
          ]),
        );
        setTxRev(nextRev);
        setTxHydrated(true);
        setTxFailed(false);
      });
      seedOpType(t);
    } catch (e) {
      setTxHydrated(true);
      if (txRevRef.current < 0) setTxFailed(true);
      failLoad(e, silent);
    }
  }

  /**
   * Сводка уходит в сеть первой и рисуется, как только приехала.
   * Список — отдельным запросом на тик позже, шапку он не держит.
   */
  async function refresh(opts?: { background?: boolean; silent?: boolean }) {
    loadErrorShown.current = false;
    const background = opts?.background ?? false;
    if (!background) setLoading(true);
    if (!opts?.silent) setError(null);
    const summaryDone = loadSummary(opts?.silent).finally(() => {
      if (!background) setLoading(false);
    });
    const txDone = new Promise<void>((resolve) => {
      setTimeout(() => {
        void loadTransactions(opts?.silent).finally(resolve);
      }, 0);
    });
    await Promise.all([summaryDone, txDone]);
  }

  /**
   * Один жест на указателе — и палец, и мышь.
   * Удержал и отпустил почти на месте: кнопки Изменить / Удалить.
   * Удержал и повёл: строка едет за пальцем, кнопки не открываются.
   * Сдвиг до порога — это скролл, жест забываем.
   * Отмена (Esc, потеря указателя) возвращает порядок без сети.
   */
  function clearPress() {
    const row = pressRow.current;
    if (!row) return;
    delete row.dataset.pressing;
    pressRow.current = null;
  }

  function endGesture() {
    gestureCleanup.current?.();
    gestureCleanup.current = null;
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
    clearPress();
    const wasDragging = dragRef.current !== null;
    dragRef.current = null;
    document.documentElement.classList.remove("tx-dragging");
    // Скролл тоже начинается с pointerdown. setState здесь перерисовывал все строки.
    if (wasDragging) setDrag(null);
  }

  function onRowPointerDown(e: React.PointerEvent, tx: Transaction) {
    if (tx.pending || editing || dragRef.current) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea")) return;

    endGesture();
    const row = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let armed = false;
    let mode: "press" | "drag" = "press";

    const blockTouch = (ev: TouchEvent) => {
      // Слушатель повешен сразу в pointerdown, иначе iOS уже не даст отменить скролл.
      if (armed) ev.preventDefault();
    };
    const blockWheel = (ev: WheelEvent) => {
      if (mode === "drag") ev.preventDefault();
    };

    let frame = 0;
    let alive = true;
    const tickScroll = () => {
      if (!alive) return;
      const session = dragRef.current;
      frame = window.requestAnimationFrame(tickScroll);
      if (!session || mode !== "drag") return;
      const edge = 72;
      const view = window.innerHeight;
      let speed = 0;
      if (session.y < edge) speed = -((edge - session.y) / edge) * 14;
      else if (session.y > view - edge) {
        speed = ((session.y - (view - edge)) / edge) * 14;
      }
      if (speed) window.scrollBy(0, speed);
      // Слот считаем раз в кадр, не на каждый pointermove: иначе layout на всех строках.
      const next = dropIndexAt(session.y, session.id);
      if (next !== session.index) {
        session.index = next;
        setDrag((prev) => (prev ? { ...prev, index: next } : prev));
      }
    };

    const startDrag = (ev: PointerEvent) => {
      const rect = row.getBoundingClientRect();
      const list = transactionsRef.current;
      const originIndex = list.findIndex((t) => t.id === tx.id);
      if (originIndex < 0) return;
      mode = "drag";
      const session = {
        id: tx.id,
        pointerId,
        index: dropIndexAt(ev.clientY, tx.id),
        originIndex,
        height: rect.height || 48,
        left: rect.left,
        width: rect.width,
        grabOffset: ev.clientY - rect.top,
        grabX: ev.clientX - rect.left,
        y: ev.clientY,
      };
      dragRef.current = session;
      clearPress();
      setRevealedId(null);
      setDrag({
        id: session.id,
        index: session.index,
        originIndex: session.originIndex,
        height: session.height,
        left: session.left,
        width: session.width,
        grabOffset: session.grabOffset,
        grabX: session.grabX,
      });
      document.documentElement.classList.add("tx-dragging");
      frame = window.requestAnimationFrame(tickScroll);
    };

    const moveLift = (ev: PointerEvent) => {
      const session = dragRef.current;
      if (!session) return;
      session.y = ev.clientY;
      const lift = liftRef.current;
      if (lift) lift.style.top = `${ev.clientY - session.grabOffset}px`;
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (mode === "drag") {
        moveLift(ev);
        return;
      }
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!armed) {
        if (dist > HOLD_SLOP_PX) endGesture();
        return;
      }
      if (dist > HOLD_SLOP_PX) startDrag(ev);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (mode === "drag") {
        suppressClick.current = true;
        void commitReorder();
        return;
      }
      const id = armed ? tx.id : null;
      endGesture();
      if (id) setRevealedId(id);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // Палец потерян или жест перехватил браузер — порядок как был, без записи.
      if (mode === "drag") suppressClick.current = true;
      endGesture();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      endGesture();
    };
    const onBlur = () => {
      if (mode === "drag") suppressClick.current = true;
      endGesture();
    };

    const timer = window.setTimeout(() => {
      if (longPress.current?.pointerId !== pointerId) return;
      armed = true;
      pressRow.current = row;
      row.dataset.pressing = "true";
      navigator.vibrate?.(8);
      sfx("nav");
    }, HOLD_MS);
    longPress.current = { timer, pointerId };

    document.addEventListener("touchmove", blockTouch, { passive: false });
    document.addEventListener("wheel", blockWheel, { passive: false });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    gestureCleanup.current = () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      document.removeEventListener("touchmove", blockTouch);
      document.removeEventListener("wheel", blockWheel);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }

  useEffect(() => {
    return () => {
      gestureCleanup.current?.();
      gestureCleanup.current = null;
    };
  }, []);

  useEffect(() => {
    const onClick = (ev: globalThis.MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      ev.preventDefault();
      ev.stopPropagation();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  /** Отпустили в новом месте: дата встаёт между соседями, остальное не трогаем. */
  async function commitReorder() {
    const session = dragRef.current;
    if (!session || session.index === session.originIndex) {
      endGesture();
      return;
    }
    const list = transactionsRef.current;
    const previous = list.find((t) => t.id === session.id);
    endGesture();
    if (!previous || previous.pending) return;
    const others = list.filter((t) => t.id !== session.id);
    const occurredAt = reorderOccurredAt(
      others.map((t) => t.occurredAt),
      session.index,
    );
    if (occurredAt === previous.occurredAt) return;
    const id = session.id;

    setTransactions((prev) =>
      sortTransactions(
        prev.map((t) => (t.id === id ? { ...t, occurredAt, pending: true } : t)),
      ),
    );
    setRevealedId(null);
    setError(null);
    sfx("success");

    try {
      const res = await enqueue(() => updateTransaction(id, { occurredAt }));
      noteWrite(res.rev);
      setSummaryBase(res.summary);
      setTransactions((prev) =>
        sortTransactions(prev.map((t) => (t.id === id ? res.transaction : t))),
      );
    } catch (err) {
      setTransactions((prev) =>
        sortTransactions(prev.map((t) => (t.id === id ? previous : t))),
      );
      flashError(err instanceof Error ? err.message : "Не удалось сохранить");
    }
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
      amount: formatAmountInput(String(tx.amountCents / 100)),
      memberId: tx.memberId ?? "",
      toMemberId:
        tx.toMemberId ?? otherMemberId(summary?.members ?? [], tx.memberId ?? ""),
      note: tx.note ?? "",
      date: dateInputValue(tx.occurredAt),
      occurredAt: tx.occurredAt,
    });
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

    try {
      const res = await enqueue(() => updateTransaction(id, patch));
      noteWrite(res.rev);
      setSummaryBase(res.summary);
      sfx("success");
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
      noteWrite(res.rev);
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
      setLedgerRev(data.rev ?? 0);
      setSummaryBase(data.summary);
      seedMembers(data.summary);
      setLoggedIn(true);
      sfx("success");
      if (data.transactions) {
        const txs = sortTransactions(data.transactions);
        const serverRev = data.rev ?? 0;
        txRevRef.current = serverRev;
        startTransition(() => {
          setTransactions(txs);
          setTxRev(serverRev);
          setTxHydrated(true);
        });
        seedOpType(txs);
      } else {
        setTxHydrated(true);
        void loadTransactions(true);
      }
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }

  async function submitOp() {
    if (!summary) return;
    const value = amountToCents(opAmount);
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
      account,
      type,
      amountCents: value,
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
      account,
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

    if (type === "deposit" || type === "interest" || type === "cashback") {
      setCelebrations((active) => [...active, id]);
    }

    try {
      const res = await enqueue(() => createTransaction(body));
      noteWrite(res.rev);
      setSummaryBase(res.summary);
      sfx(type === "withdrawal" ? "remove" : "success");
      setTransactions((prev) =>
        sortTransactions(prev.map((t) => (t.id === id ? res.transaction : t))),
      );
    } catch (err) {
      setCelebrations((active) => active.filter((item) => item !== id));
      setTransactions((prev) => prev.filter((t) => t.id !== id));
      flashError(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  }

  function toggleHideBalances() {
    setHideBalances((prev) => {
      const next = !prev;
      writeFlag(HIDE_BALANCES_KEY, next);
      return next;
    });
  }

  /**
   * Пока строку тащат, в списке она уже стоит в слоте под пальцем — но дата
   * черновая, на сервер уедет только если палец отпустить в другом месте.
   * Тот же слот, что был: occurredAt не трогаем, щель остаётся на своём месте.
   */
  const ordered = useMemo(() => {
    if (!drag || drag.index === drag.originIndex) return accountTransactions;
    const current = accountTransactions.find((t) => t.id === drag.id);
    if (!current) return accountTransactions;
    const others = accountTransactions.filter((t) => t.id !== drag.id);
    const occurredAt = reorderOccurredAt(
      others.map((t) => t.occurredAt),
      drag.index,
    );
    return sortTransactions(
      accountTransactions.map((t) => (t.id === drag.id ? { ...t, occurredAt } : t)),
    );
  }, [accountTransactions, drag]);
  const months = useMemo(() => groupByMonth(ordered), [ordered]);
  const lifted = drag ? (ordered.find((t) => t.id === drag.id) ?? null) : null;
  const mom = useMemo(() => monthOverMonth(accountTransactions), [accountTransactions]);
  const currentMonth = calendarMonthKey();
  const monthlyMemberTotals = useMemo(() => {
    const totals = new Map<string, { deposit: number; withdrawal: number }>();
    for (const tx of accountTransactions) {
      if (
        !tx.memberId ||
        (tx.type !== "deposit" && tx.type !== "withdrawal") ||
        monthKeyOf(tx.occurredAt) !== currentMonth
      ) continue;

      const member = totals.get(tx.memberId) ?? { deposit: 0, withdrawal: 0 };
      member[tx.type] += tx.amountCents;
      totals.set(tx.memberId, member);
    }
    return totals;
  }, [accountTransactions, currentMonth]);
  const monthlyTotalsReady = txRev >= 0 && txRev >= ledgerRev;
  const overallMom = useMemo(() => monthOverMonth(transactions), [transactions]);
  gestureLive.current = { onRowPointerDown, startEdit, askRemove, saveEdit, cancelEdit };
  // Поле суммы живёт в этом же компоненте. Без этой границы каждый символ
  // заново собирает все строки — на телефоне ввод начинает лагать.
  const ledger = useMemo(() => {
    const live = gestureLive;
    return (
      <div className="mt-8 lg:mt-0" data-appear={mounted ? "true" : "false"}>
        {months.map((month, i) => (
          /* Воздух после месяца — in-flow after:h-10, не pb: padding
             не держит sticky. Плашка живёт, пока не приедет следующая. */
          <section key={month.key} className="space-y-1">
            <div
              className={`space-y-1 ${
                months[i + 1] && !months[i + 1].showYear ? "after:block after:h-10" : ""
              }`}
            >
              <div className="bg-background sticky top-2 z-10 -mx-2 shadow-[0_-8px_0_0_var(--background)]">
                <div className="bg-muted flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5">
                  <h3 className="text-muted-foreground text-xs font-medium">{month.label}</h3>
                  <p
                    className={`text-xs font-medium tabular-nums ${month.totalCents < 0 ? "text-destructive/80" : "text-muted-foreground"}`}
                  >
                    {`${month.totalCents < 0 ? "−" : "+"}${formatMoney(Math.abs(month.totalCents))}`}
                  </p>
                </div>
              </div>

              {month.items.map((tx) =>
                drag?.id === tx.id ? (
                  <div
                    key={tx.id}
                    className="tx-gap"
                    style={{ height: drag.height }}
                    aria-hidden
                  />
                ) : editing?.id === tx.id ? (
                  <form
                    key={tx.id}
                    className="bg-muted/30 my-1 grid gap-3 rounded-xl border p-3"
                    onSubmit={(e) => live.current.saveEdit(e)}
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>Тип</Label>
                        <select
                          className="field border-input bg-background h-[44px] rounded-md border px-3 text-base md:h-10 md:text-sm"
                          value={editing.type}
                          onChange={(e) => {
                            sfx("nav");
                            const nextType = e.target.value as TransactionType;
                            const toMemberId =
                              nextType === "transfer" &&
                              (!editing.toMemberId || editing.toMemberId === editing.memberId)
                                ? otherMemberId(summary?.members ?? [], editing.memberId)
                                : editing.toMemberId;
                            setEditing({
                              ...editing,
                              type: nextType,
                              toMemberId,
                            });
                          }}
                        >
                          {ALL_TYPES.filter(
                            (t) => account !== "yandex" || t !== "cashback" || editing.type === t,
                          ).map((t) => (
                            <option key={t} value={t}>
                              {transactionTypeLabel(t, account)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Сумма</Label>
                        <Input
                          value={editing.amount}
                          onChange={(e) => setEditing({ ...editing, amount: formatAmountInput(e.target.value) })}
                          inputMode="decimal"
                          lang="ru"
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
                            className="field border-input bg-background h-[44px] rounded-md border px-3 text-base md:h-10 md:text-sm"
                            value={editing.memberId}
                            onChange={(e) => {
                              sfx("nav");
                              const memberId = e.target.value;
                              const toMemberId =
                                editing.type === "transfer" && memberId === editing.toMemberId
                                  ? otherMemberId(summary?.members ?? [], memberId)
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
                            className="field border-input bg-background h-[44px] rounded-md border px-3 text-base md:h-10 md:text-sm"
                            value={editing.toMemberId}
                            onChange={(e) => {
                              sfx("nav");
                              const toMemberId = e.target.value;
                              const memberId =
                                toMemberId === editing.memberId
                                  ? otherMemberId(summary?.members ?? [], toMemberId)
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
                          onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>Комментарий</Label>
                      <Input
                        value={editing.note}
                        onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-cuelume-press={SFX.secondary}
                        onClick={() => live.current.cancelEdit()}
                      >
                        Отмена
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={loading}
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
                    data-pending={tx.pending ? "true" : "false"}
                    className="tx-row stagger-item -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2"
                    onPointerDown={(e) => live.current.onRowPointerDown(e, tx)}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <TxRowBody
                      tx={tx}
                      onEdit={() => live.current.startEdit(tx)}
                      onRemove={() => live.current.askRemove(tx)}
                    />
                  </div>
                ),
              )}
              {months[i + 1]?.showYear && (
                <div className="text-muted-foreground flex items-center gap-3 pt-12 pb-4 text-xs font-medium tabular-nums">
                  <span className="border-border/70 flex-1 border-t" />
                  {months[i + 1]?.year}
                  <span className="border-border/70 flex-1 border-t" />
                </div>
              )}
            </div>
          </section>
        ))}
        {txRev < 0 ? (
          txHydrated && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {txFailed ? "Список не загрузился" : "Загрузка…"}
            </p>
          )
        ) : (
          !months.length && (
            <p className="text-muted-foreground py-6 text-center text-sm">Операций пока нет</p>
          )
        )}
      </div>
    );
  }, [
    months,
    drag,
    editing,
    revealedId,
    summary,
    loading,
    mounted,
    txRev,
    txHydrated,
    txFailed,
  ]);

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
              data-mounted={mounted ? "true" : "false"}
              className={`surface-enter grid gap-4 ${summary ? "content-ready" : "content-busy"}`}
            >
              <div className="grid gap-1.5">
                <p className="text-muted-foreground text-sm">Всего на всех счетах</p>
                <div className="font-heading flex items-center gap-2 text-4xl leading-none font-semibold md:gap-3 md:text-5xl tabular-nums">
                  <span
                    className="digit-play"
                    onMouseOver={onTotalDigitOver}
                    onMouseOut={onTotalDigitOut}
                  >
                    <RollingMoney
                      cents={overallTotal}
                      hidden={hideBalances}
                      wideGroups
                    />
                  </span>
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
                {!hideBalances && <MomDelta cents={overallMom?.totalCents} />}
              </div>
              <div
                role="group"
                aria-label="Счёт"
                className="bg-muted relative isolate grid w-fit grid-cols-2 rounded-xl p-1"
              >
                <span
                  aria-hidden="true"
                  className={`account-indicator pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-background shadow-sm ${account === "yandex" ? "translate-x-full" : ""}`}
                />
                {ACCOUNTS.map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    variant="ghost"
                    aria-pressed={id === account}
                    disabled={id === "yandex" && !summaries?.yandex}
                    className="relative h-[44px] px-5 hover:bg-transparent dark:hover:bg-transparent"
                    data-cuelume-press={SFX.nav}
                    onClick={() => {
                      if (id === account) return;
                      endGesture();
                      setRevealedId(null);
                      setEditing(null);
                      setOpAmount("");
                      setOpSpecial(null);
                      setOpType("deposit");
                      setAccount(id);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-4">
                {(summary?.members ?? []).map((m, i) => (
                  <div
                    key={m.id}
                    className="stagger-item"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <p className="text-muted-foreground text-xs sm:text-sm">{m.name}</p>
                    <p className="text-[clamp(0.9375rem,4.6vw,1.5rem)] leading-tight font-semibold tracking-tight tabular-nums">
                      <RollingMoney cents={m.balanceCents ?? 0} hidden={hideBalances} />
                    </p>
                    <dl className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs font-medium tabular-nums">
                      {[
                        { label: "Пополнения за текущий месяц", cents: monthlyTotalsReady ? (monthlyMemberTotals.get(m.id)?.deposit ?? 0) : undefined, sign: "+" as const },
                        { label: "Списания за текущий месяц", cents: monthlyTotalsReady ? (monthlyMemberTotals.get(m.id)?.withdrawal ?? 0) : undefined, sign: "−" as const },
                      ].map(({ label, cents, sign }) => (
                        <div key={label}>
                          <dt className="sr-only">{label}</dt>
                          <dd className={sign === "+" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                            {cents == null ? "—" : (
                              <RollingMoney
                                cents={cents}
                                sign={sign}
                                hidden={hideBalances}
                              />
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[clamp(0.75rem,3.4vw,0.875rem)]">
                <div className="stagger-item">
                  <p className="text-muted-foreground">{account === "rocket" ? "Изи мани" : "Доход"}</p>
                  <p className="font-medium tabular-nums">
                    <RollingMoney
                      cents={summary?.accrualsCents ?? 0}
                      hidden={hideBalances}
                    />
                  </p>
                  {!hideBalances && <MomDelta cents={mom?.accrualsCents} />}
                </div>
              </div>
            </section>

            {/* Карточек больше нет — блоки делит линия: по 32px воздуха с каждой
                стороны (сверху 16 из gap колонки плюс mt-4). */}
            <section className="border-border/70 mt-4 border-t pt-8">
              <TxComposer
                account={account}
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
                disabled={!summary}
                mounted={mounted}
              />
            </section>
          </div>

          {/* На мобилке список сразу под композером, без второй линейки:
              черта остаётся только между цифрами и полем. */}
          {ledger}
        </div>

        {/* Выход — последнее, что есть на странице: под обеими колонками. */}
        <div className="flex">
          <Button
            variant="ghost"
            data-cuelume-press={SFX.logout}
            onClick={() => {
              endGesture();
              logout();
              setCelebrations([]);
              setAccount("rocket");
              setLoggedIn(false);
              setSummaryBase(null);
              setTransactions([]);
              setLedgerRev(0);
              txRevRef.current = -1;
              setTxRev(-1);
              setTxHydrated(false);
              setTxFailed(false);
              rev.current = 0;
              opTypeSeeded.current = false;
            }}
          >
            Выйти
          </Button>
        </div>
      </div>

      {celebrations.map((id) => (
        <CreditCelebration
          key={id}
          onEnd={() => setCelebrations((active) => active.filter((item) => item !== id))}
        />
      ))}

      {lifted && drag
        ? createPortal(
            <div
              ref={liftRef}
              data-row-id={lifted.id}
              data-dragging="true"
              className="tx-row flex items-center justify-between gap-3 rounded-lg px-2 py-2"
              style={{
                top: dragRef.current
                  ? dragRef.current.y - drag.grabOffset
                  : 0,
                left: drag.left,
                width: drag.width,
                transformOrigin: `${drag.grabX}px ${drag.grabOffset}px`,
              }}
            >
              <TxRowBody
                tx={lifted}
                onEdit={() => startEdit(lifted)}
                onRemove={() => askRemove(lifted)}
              />
            </div>,
            document.body,
          )
        : null}

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
                ? `${transactionTypeLabel(pendingDelete.type, pendingDelete.account)} · ${formatMoney(pendingDelete.amountCents)} · ${formatDate(pendingDelete.occurredAt)}`
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
