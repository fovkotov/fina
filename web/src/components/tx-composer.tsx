"use client";

import { useLayoutEffect, useRef } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { TextMorph } from "torph/react";
import { Button } from "@/components/ui/button";
import { AVATARS, SIGN_IMAGES } from "@/lib/assets";
import { SFX } from "@/lib/sounds";
import { TYPE_LABELS, type Member } from "@/lib/api";

export type OpType = "deposit" | "withdrawal";

/** Необычные типы: начисления без знака, перевод — два участника вместо знака. */
export type SpecialType = "cashback" | "interest" | "transfer";

const QUICK_AMOUNTS = [1000, 2000, 5000];
const SPECIAL_TYPES: SpecialType[] = ["cashback", "interest", "transfer"];

export function digitsOf(value: string) {
  return value.replace(/\D/g, "");
}

export function formatAmountInput(value: string) {
  const digits = digitsOf(value).replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
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
      className="pressable size-[42px] shrink-0 overflow-hidden rounded-full"
      data-cuelume-press={SFX.nav}
      data-cuelume-release={SFX.release}
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
};

export function TxComposer({
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

  // autoFocus на iOS часто молчит — дублируем фокус после гидрации и из bfcache.
  useLayoutEffect(() => {
    focusAmount();
    const raf = requestAnimationFrame(focusAmount);
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) focusAmount();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pageshow", onPageShow);
    };
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
    const current = Number(digitsOf(amount) || 0);
    onAmountChange(formatAmountInput(String(current + value)));
    focusAmount();
  }

  return (
    <form
      className="grid w-full max-w-[var(--composer-field)] gap-[9px]"
      // сумма форматируется пробелами и не проходит pattern="[0-9]*" у поля
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
        focusAmount();
      }}
    >
      <div className="flex flex-wrap items-center gap-[6px]">
        {SPECIAL_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={special === t}
            /* Крестик уже намекает на снятие выбора, но скринридеру нужен текст. */
            aria-label={
              special === t ? `${TYPE_LABELS[t]}, снять выбор` : undefined
            }
            /* Тот же чип, что у быстрых сумм снизу; выбранный — в акценте. */
            className={`pressable flex items-center justify-center gap-[5px] rounded-[30px] px-[15px] py-[8px] text-[16px] font-medium ${
              special === t
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
            data-cuelume-press={SFX.nav}
            data-cuelume-release={SFX.release}
            onClick={() => onSpecialChange(special === t ? null : t)}
          >
            {TYPE_LABELS[t]}
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
                ? TYPE_LABELS[special]
                : type === "withdrawal"
                  ? "Списание"
                  : "Внесение"
            }
            /* Без круглой маски: у знака руки и ноги доходят до краёв картинки. */
            className="pressable size-[42px] shrink-0"
            data-cuelume-press={SFX.nav}
            data-cuelume-release={SFX.release}
            onClick={() => {
              // у начисления знака нет: первое нажатие возвращает обычную операцию
              if (special) return onSpecialChange(null);
              onTypeChange(type === "deposit" ? "withdrawal" : "deposit");
            }}
          >
            <Image
              key={signType}
              className="swap-in size-[42px]"
              src={SIGN_IMAGES[signType]}
              alt=""
              width={42}
              height={42}
              priority
            />
          </button>
        )}

        <input
          ref={amountRef}
          value={amount}
          onChange={(e) => onAmountChange(formatAmountInput(e.target.value))}
          placeholder="скока"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
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
            className="pressable size-[42px] shrink-0 overflow-hidden rounded-full"
            data-cuelume-press={SFX.nav}
            data-cuelume-release={SFX.release}
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
            className="pressable bg-muted text-muted-foreground flex w-[90px] items-center justify-center rounded-[30px] px-[15px] py-[8px] text-[16px] font-medium tabular-nums"
            data-cuelume-press={SFX.nav}
            data-cuelume-release={SFX.release}
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
          data-cuelume-press={SFX.primaryPress}
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
