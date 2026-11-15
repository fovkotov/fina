"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { TextMorph } from "torph/react";
import { Button } from "@/components/ui/button";
import { AVATARS, PLUS_STICKER, SIGN_IMAGES } from "@/lib/assets";
import { SFX } from "@/lib/sounds";
import { MONEY_GROUP_SEPARATOR, transactionTypeLabel, type Account, type Member } from "@/lib/api";

export type OpType = "deposit" | "withdrawal";

/** Необычные типы: начисления без знака, перевод — два участника вместо знака. */
export type SpecialType = "cashback" | "interest" | "transfer";

const QUICK_AMOUNTS = [1000, 2000, 5000];
const SPECIAL_TYPES: SpecialType[] = ["cashback", "interest", "transfer"];

/** Рубли из поля: пробелы — разряды, запятая или точка — копейки. Пустое и ноль — 0. */
export function amountToCents(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!normalized || normalized === ".") return 0;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** Целая часть с пробелами, после запятой — не больше двух копеек. Точка тоже запятая. */
export function formatAmountInput(value: string) {
  const raw = value.replace(/[^\d,.]/g, "").replace(/\./g, ",");
  if (!raw) return "";
  const commaAt = raw.indexOf(",");
  const wholeRaw = (commaAt === -1 ? raw : raw.slice(0, commaAt)).replace(
    /^0+(?=\d)/,
    "",
  );
  const whole = wholeRaw.replace(/\B(?=(\d{3})+(?!\d))/g, MONEY_GROUP_SEPARATOR);
  if (commaAt === -1) return whole;
  const frac = raw
    .slice(commaAt + 1)
    .replace(/\D/g, "")
    .slice(0, 2);
  return `${whole || "0"},${frac}`;
}

/** Чужой фокус не забираем: за два кадра появления человек мог уже тапнуть поле. */
function focusIsFree(el: HTMLElement) {
  const active = document.activeElement;
  return (
    active == null ||
    active === document.body ||
    active === document.documentElement ||
    active === el
  );
}

/** iOS не фокусирует opacity: 0, display:none и visibility:hidden. */
function fieldIsShown(el: HTMLElement) {
  let node: HTMLElement | null = el;
  while (node) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity < 0.05) return false;
    node = node.parentElement;
  }
  return true;
}

function MemberAvatar({
  member,
  label,
  onClick,
}: {
  member: Member | null;
  label: string;
  onClick: () => void;
}) {
  const avatar = member ? AVATARS[member.name] : undefined;
  return (
    <button
      type="button"
      aria-label={label}
      title={member?.name ?? undefined}
      className="pressable grid size-[44px] place-items-center shrink-0 overflow-hidden rounded-full"
      data-cuelume-press={SFX.nav}
      onClick={onClick}
    >
      {avatar ? (
        <Image
          key={member?.id}
          className="swap-in size-[42px] object-cover"
          src={avatar}
          alt=""
          width={42}
          height={42}
          priority
        />
      ) : (
        <span
          key={member?.id}
          className="swap-in bg-secondary text-secondary-foreground flex size-[42px] items-center justify-center rounded-full text-sm font-medium"
        >
          {member?.name.slice(0, 1) ?? "?"}
        </span>
      )}
    </button>
  );
}

type Props = {
  account: Account;
  type: OpType;
  onTypeChange: (type: OpType) => void;
  special: SpecialType | null;
  onSpecialChange: (special: SpecialType | null) => void;
  members: Member[];
  memberId: string;
  onMemberChange: (memberId: string) => void;
  toMemberId: string;
  onToMemberChange: (memberId: string) => void;
  amount: string;
  onAmountChange: (amount: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Кадр появления кабинета. Раньше него iOS молча глотает focus(). */
  mounted: boolean;
};

export function TxComposer({
  account,
  type,
  onTypeChange,
  special,
  onSpecialChange,
  members,
  memberId,
  onMemberChange,
  toMemberId,
  onToMemberChange,
  amount,
  onAmountChange,
  onSubmit,
  disabled,
  mounted,
}: Props) {
  const amountRef = useRef<HTMLInputElement>(null);

  function focusAmount() {
    const el = amountRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* type=number и часть мобильных webview бросают */
    }
  }

  // Пока карточка с opacity 0, iOS сбрасывает focus() и сам не повторяет.
  // Зовем один раз, когда data-mounted уже true и поле реально нарисовано.
  useLayoutEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let tries = 0;
    const tick = () => {
      const el = amountRef.current;
      if (!el || !focusIsFree(el)) return;
      if (!fieldIsShown(el)) {
        if (tries++ < 24) raf = requestAnimationFrame(tick);
        return;
      }
      focusAmount();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      const el = amountRef.current;
      if (!el || !focusIsFree(el) || !fieldIsShown(el)) return;
      focusAmount();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const isTransfer = special === "transfer";
  const signType: OpType = special ? "deposit" : type;
  const sign = isTransfer ? "→" : signType === "withdrawal" ? "−" : "+";
  const fromMember =
    members.find((m) => m.id === memberId) ?? members[0] ?? null;
  const toMember =
    members.find((m) => m.id === toMemberId) ??
    members.find((m) => m.id !== fromMember?.id) ??
    null;
  const avatar = fromMember ? AVATARS[fromMember.name] : undefined;

  function cycleSide(
    currentId: string | undefined,
    otherId: string | undefined,
    setCurrent: (id: string) => void,
    setOther: (id: string) => void,
  ) {
    if (members.length < 2) return;
    const index = members.findIndex((m) => m.id === currentId);
    const next = members[(Math.max(index, 0) + 1) % members.length];
    setCurrent(next.id);
    if (next.id === otherId && currentId) setOther(currentId);
  }

  function nextMember() {
    if (members.length < 2) return;
    const index = members.findIndex((m) => m.id === fromMember?.id);
    onMemberChange(members[(index + 1) % members.length].id);
  }

  function applyQuick(value: number) {
    const cents = amountToCents(amount) + value * 100;
    const rub = Math.floor(cents / 100);
    const kop = cents % 100;
    onAmountChange(
      kop === 0
        ? formatAmountInput(String(rub))
        : formatAmountInput(`${rub},${String(kop).padStart(2, "0")}`),
    );
    focusAmount();
  }

  return (
    <form
      className="grid w-full max-w-[var(--composer-field)] gap-[9px]"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
        focusAmount();
      }}
    >
      <div className="flex flex-wrap items-center gap-[6px]">
        {SPECIAL_TYPES.filter((t) => account !== "yandex" || t !== "cashback").map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={special === t}
            /* Крестик уже намекает на снятие выбора, но скринридеру нужен текст. */
            aria-label={
              special === t ? `${transactionTypeLabel(t, account)}, снять выбор` : undefined
            }
            /* Тот же чип, что у быстрых сумм снизу; выбранный — в акценте. */
            className={`pressable flex min-h-[44px] items-center justify-center gap-[5px] rounded-[30px] px-[15px] py-[8px] text-[16px] font-medium ${
              special === t
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
            data-cuelume-press={SFX.nav}
            onClick={() => onSpecialChange(special === t ? null : t)}
          >
            {transactionTypeLabel(t, account)}
            {special === t && (
              /* Не вложенная кнопка: клик по всему чипу и так снимает выбор. */
              <X className="swap-in size-[15px]" strokeWidth={2.5} aria-hidden />
            )}
          </button>
        ))}
      </div>

      {/* Отступы по макету: иконки 42px вписаны с inset 16px, высота поля — 74px. */}
      <div className="bg-muted flex w-full items-center justify-between gap-3 rounded-[60px] p-[16px]">
        {isTransfer ? (
          <MemberAvatar
            member={fromMember}
            label={`От ${fromMember?.name ?? "участника"}`}
            onClick={() =>
              cycleSide(
                fromMember?.id,
                toMember?.id,
                onMemberChange,
                onToMemberChange,
              )
            }
          />
        ) : (
          <button
            type="button"
            aria-label={
              special
                ? transactionTypeLabel(special, account)
                : type === "withdrawal"
                  ? "Списание"
                  : "Внесение"
            }
            /* Без круглой маски: у знака руки и ноги доходят до краёв картинки. */
            className={`pressable relative flex size-[44px] shrink-0 items-center justify-start pl-px ${signType === "deposit" ? "after:absolute after:-inset-y-4 after:-left-4 after:-right-[42px]" : ""}`}
            data-cuelume-press={SFX.nav}
            onClick={() => {
              // у начисления знака нет: первое нажатие возвращает обычную операцию
              if (special) return onSpecialChange(null);
              onTypeChange(type === "deposit" ? "withdrawal" : "deposit");
            }}
          >
            <picture
              key={signType}
              className={`swap-in pointer-events-none shrink-0 ${signType === "deposit" ? "size-[84px]" : "size-[42px]"}`}
            >
              {signType === "deposit" && (
                <source srcSet={PLUS_STICKER} type="image/webp" media="(prefers-reduced-motion: no-preference)" />
              )}
              <Image
                className="size-full object-contain"
                src={SIGN_IMAGES[signType]}
                alt=""
                width={84}
                height={84}
                unoptimized
              />
            </picture>
          </button>
        )}

        <input
          ref={amountRef}
          value={amount}
          onChange={(e) => onAmountChange(formatAmountInput(e.target.value))}
          placeholder="скока"
          type="text"
          /* numeric на iOS — панель без запятой; pattern="[0-9]*" делает то же. */
          inputMode="decimal"
          lang="ru"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-label="Сумма"
          // w-0: без явной ширины поле держит интринсик ~20 символов и распирает страницу
          className="placeholder:text-foreground/20 w-0 min-w-0 flex-1 bg-transparent text-center text-[22px] tabular-nums outline-none"
        />

        {isTransfer ? (
          <MemberAvatar
            member={toMember}
            label={`Кому ${toMember?.name ?? "участнику"}`}
            onClick={() =>
              cycleSide(
                toMember?.id,
                fromMember?.id,
                onToMemberChange,
                onMemberChange,
              )
            }
          />
        ) : (
          <button
            type="button"
            aria-label={`Операция от ${fromMember?.name ?? "участника"}`}
            title={fromMember?.name ?? undefined}
            className="pressable grid size-[44px] place-items-center shrink-0 overflow-hidden rounded-full"
            data-cuelume-press={SFX.nav}
            onClick={nextMember}
          >
            {avatar ? (
              <Image
                key={fromMember?.id}
                className="swap-in size-[42px] object-cover"
                src={avatar}
                alt=""
                width={42}
                height={42}
                priority
              />
            ) : (
              <span
                key={fromMember?.id}
                className="swap-in bg-secondary text-secondary-foreground flex size-[42px] items-center justify-center rounded-full text-sm font-medium"
              >
                {fromMember?.name.slice(0, 1)}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-[6px]">
        {QUICK_AMOUNTS.map((value) => (
          <button
            key={value}
            type="button"
            className="pressable bg-muted text-muted-foreground flex min-h-[44px] w-[90px] items-center justify-center rounded-[30px] px-[15px] py-[8px] text-[16px] font-medium tabular-nums"
            data-cuelume-press={SFX.nav}
            onClick={() => applyQuick(value)}
          >
            <TextMorph as="span" locale="ru" duration={220}>
              {`${sign} ${formatAmountInput(String(value))}`}
            </TextMorph>
          </button>
        ))}
      </div>

      {amount && (
        <Button
          type="submit"
          size="lg"
          disabled={disabled}
          /* Кнопка повторяет габариты поля ввода: та же ширина, высота и скругление. */
          className="reveal-up mt-1 h-[74px] w-full rounded-[60px] text-[18px]"
        >
          {special === "transfer"
            ? "Перевести"
            : special
              ? "Начислить"
              : type === "withdrawal"
                ? "Списать"
                : "Внести"}
        </Button>
      )}
    </form>
  );
}
