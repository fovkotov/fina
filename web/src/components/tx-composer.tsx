"use client";

import Image from "next/image";
import { TextMorph } from "torph/react";
import { Button } from "@/components/ui/button";
import { SFX } from "@/lib/sounds";
import type { Member } from "@/lib/api";

export type OpType = "deposit" | "withdrawal";

const QUICK_AMOUNTS = [1000, 2000, 5000];

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const AVATARS: Record<string, string> = {
  Аня: `${BASE_PATH}/assets/avatar-anya.png`,
  Андрей: `${BASE_PATH}/assets/avatar-andrey.png`,
};

const SIGN_IMAGES: Record<OpType, string> = {
  deposit: `${BASE_PATH}/assets/sign-plus.png`,
  withdrawal: `${BASE_PATH}/assets/sign-minus.png`,
};

export function digitsOf(value: string) {
  return value.replace(/\D/g, "");
}

export function formatAmountInput(value: string) {
  const digits = digitsOf(value).replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

type Props = {
  type: OpType;
  onTypeChange: (type: OpType) => void;
  members: Member[];
  memberId: string;
  onMemberChange: (memberId: string) => void;
  amount: string;
  onAmountChange: (amount: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
};

export function TxComposer({
  type,
  onTypeChange,
  members,
  memberId,
  onMemberChange,
  amount,
  onAmountChange,
  onSubmit,
  disabled,
}: Props) {
  const sign = type === "withdrawal" ? "−" : "+";
  const activeMember =
    members.find((m) => m.id === memberId) ?? members[0] ?? null;
  const avatar = activeMember ? AVATARS[activeMember.name] : undefined;

  function nextMember() {
    if (members.length < 2) return;
    const index = members.findIndex((m) => m.id === activeMember?.id);
    onMemberChange(members[(index + 1) % members.length].id);
  }

  function applyQuick(value: number) {
    const current = Number(digitsOf(amount) || 0);
    onAmountChange(formatAmountInput(String(current + value)));
  }

  return (
    <form
      className="grid max-w-[420px] gap-[9px]"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="bg-muted flex w-full items-center justify-between gap-3 rounded-[60px] px-[21px] py-[18px]">
        <button
          type="button"
          aria-label={type === "withdrawal" ? "Списание" : "Внесение"}
          className="pressable size-[42px] shrink-0 overflow-hidden rounded-full"
          data-cuelume-press={SFX.nav}
          onClick={() => onTypeChange(type === "deposit" ? "withdrawal" : "deposit")}
        >
          <Image
            key={type}
            className="swap-in size-[42px]"
            src={SIGN_IMAGES[type]}
            alt=""
            width={42}
            height={42}
          />
        </button>

        <input
          value={amount}
          onChange={(e) => onAmountChange(formatAmountInput(e.target.value))}
          placeholder="скока"
          inputMode="numeric"
          aria-label="Сумма"
          className="placeholder:text-foreground/20 min-w-0 flex-1 bg-transparent text-center text-[22px] tabular-nums outline-none"
        />

        <button
          type="button"
          aria-label={`Операция от ${activeMember?.name ?? "участника"}`}
          title={activeMember?.name ?? undefined}
          className="pressable size-[42px] shrink-0 overflow-hidden rounded-full"
          data-cuelume-press={SFX.nav}
          onClick={nextMember}
        >
          {avatar ? (
            <Image
              key={activeMember?.id}
              className="swap-in size-[42px] object-cover"
              src={avatar}
              alt=""
              width={42}
              height={42}
            />
          ) : (
            <span
              key={activeMember?.id}
              className="swap-in flex size-[42px] items-center justify-center rounded-full text-sm font-medium"
              style={{ backgroundColor: activeMember?.accent ?? undefined }}
            >
              {activeMember?.name.slice(0, 1)}
            </span>
          )}
        </button>
      </div>

      <div className="flex items-center gap-[6px] px-[8px]">
        {QUICK_AMOUNTS.map((value) => (
          <button
            key={value}
            type="button"
            className="pressable bg-muted text-muted-foreground flex w-[90px] items-center justify-center rounded-[30px] px-[15px] py-[8px] text-[16px] font-medium tabular-nums"
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
          className="reveal-up mt-1 justify-self-start rounded-[30px] px-5"
          data-cuelume-press={SFX.primaryPress}
        >
          {type === "withdrawal" ? "Списать" : "Внести"}
        </Button>
      )}
    </form>
  );
}
