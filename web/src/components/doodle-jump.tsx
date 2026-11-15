"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Pause, X } from "lucide-react";
import {
  createJump, JUMP_HEIGHT, JUMP_HZ, JUMP_WIDTH, jumpScore, stepJump,
  type Jump,
} from "../../../worker/src/jump-engine";
import { fetchJumpStatus, finishJumpRun, startJumpRun, type JumpStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SFX } from "@/lib/sounds";

const TICK = 1000 / JUMP_HZ;
const number = new Intl.NumberFormat("ru-RU");
type Run = { game: Jump; id: string; input: string[]; tilt: boolean };
type Phase = "opening" | "playing" | "saving" | "result" | "error";

function askForTilt() {
  const orientation = window.DeviceOrientationEvent as
    | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
    | undefined;
  if (!orientation || !window.matchMedia("(pointer: coarse)").matches) return Promise.resolve(false);
  return orientation.requestPermission
    ? orientation.requestPermission().then((value) => value === "granted", () => false)
    : Promise.resolve(true);
}

function draw(ctx: CanvasRenderingContext2D, game: Jump) {
  ctx.fillStyle = "#151613";
  ctx.fillRect(0, 0, JUMP_WIDTH, JUMP_HEIGHT);
  ctx.strokeStyle = "#2a2c23";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < JUMP_WIDTH; x += 24) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, JUMP_HEIGHT);
  }
  for (let y = game.camera % 24; y < JUMP_HEIGHT; y += 24) {
    ctx.moveTo(0, y);
    ctx.lineTo(JUMP_WIDTH, y);
  }
  ctx.stroke();
  for (const p of game.platforms) {
    const y = JUMP_HEIGHT - p.y + game.camera;
    if (p.broken) continue;
    ctx.fillStyle = p.kind === "cracked" ? "#bc8171" : "#d8e78e";
    ctx.beginPath();
    ctx.roundRect(p.x, y, p.width, 8, 3);
    ctx.fill();
    if (p.kind === "cracked") {
      ctx.strokeStyle = "#593e39";
      ctx.beginPath();
      ctx.moveTo(p.x + p.width / 2, y);
      ctx.lineTo(p.x + p.width / 2 - 4, y + 4);
      ctx.lineTo(p.x + p.width / 2 + 2, y + 8);
      ctx.stroke();
    }
    if (p.kind === "boots" || p.kind === "helicopter") {
      ctx.font = "20px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(p.kind === "boots" ? "🥾" : "🚁", p.x + p.width / 2, y - 4);
    }
  }
  const y = JUMP_HEIGHT - game.y + game.camera;
  ctx.fillStyle = "#f2bd52";
  ctx.strokeStyle = "#fce5a7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(game.x, y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#322616";
  ctx.font = "bold 17px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("₽", game.x, y + 6);
  if (game.flight > 0) ctx.fillText("✦", game.x, y - 17);
}

function JumpField({
  run, paused, onPause, onDone,
}: {
  run: Run;
  paused: boolean;
  onPause: () => void;
  onDone: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const touch = useRef<number | null>(null);
  const [score, setScore] = useState(() => jumpScore(run.game));
  const [usingTilt, setUsingTilt] = useState(false);
  const callbacks = useRef({ onPause, onDone });
  callbacks.current = { onPause, onDone };

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    draw(ctx, run.game);
    if (paused) return;

    let tilt = 0;
    let tiltSeen = false;
    const keys = new Set<string>();
    const orientation = (event: DeviceOrientationEvent) => {
      if (event.gamma == null) return;
      tilt = Math.round(Math.max(-5, Math.min(5, event.gamma / 4)));
      if (!tiltSeen) {
        tiltSeen = true;
        setUsingTilt(true);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      if (event.type === "keydown") keys.add(event.key);
      else keys.delete(event.key);
    };
    const visibility = () => {
      if (document.hidden) callbacks.current.onPause();
    };
    if (run.tilt) window.addEventListener("deviceorientation", orientation);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    document.addEventListener("visibilitychange", visibility);

    let previous = performance.now();
    let bank = 0;
    let frame = 0;
    let reported = jumpScore(run.game);
    const tick = (now: number) => {
      bank += Math.min(100, now - previous);
      previous = now;
      const arrows = (keys.has("ArrowRight") ? 5 : 0) - (keys.has("ArrowLeft") ? 5 : 0);
      const input = touch.current ?? (keys.size ? arrows : tilt);
      while (bank >= TICK && !run.game.done) {
        bank -= TICK;
        run.input.push(String.fromCharCode(53 + input));
        stepJump(run.game, input);
      }
      draw(ctx, run.game);
      const next = jumpScore(run.game);
      if (next !== reported && (run.game.done || run.game.ticks % 4 === 0)) {
        reported = next;
        setScore(next);
      }
      if (run.game.done) callbacks.current.onDone();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("deviceorientation", orientation);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      document.removeEventListener("visibilitychange", visibility);
      touch.current = null;
    };
  }, [run, paused]);

  return (
    <div className="relative mx-auto grid min-h-0 w-full max-w-[360px] flex-1 place-items-center overflow-hidden rounded-2xl bg-[#151613]">
      <canvas
        ref={canvas}
        width={JUMP_WIDTH}
        height={JUMP_HEIGHT}
        aria-label="Игровое поле Doodle Jump"
        className="h-full max-h-full w-full touch-none object-contain"
        onPointerDown={(event) => {
          if (paused) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          touch.current = event.clientX < bounds.left + bounds.width / 2 ? -5 : 5;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={() => { touch.current = null; }}
        onPointerCancel={() => { touch.current = null; }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 text-white">
        <div className="rounded-lg bg-black/70 px-2.5 py-1 font-semibold tabular-nums">{number.format(score)}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="pointer-events-auto size-11 bg-black/70 text-white"
          aria-label="Пауза"
          onClick={onPause}
        >
          <Pause />
        </Button>
      </div>
      {run.game.ticks < 120 && !paused && (
        <p className="pointer-events-none absolute inset-x-2 bottom-3 text-center text-xs text-white/80">
          {usingTilt ? "Наклоняй телефон" : "Наклон, касания слева и справа или стрелки"}
        </p>
      )}
    </div>
  );
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
}

export function DoodleJump({ onPrize }: { onPrize: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opening = useRef(false);
  const requestId = useRef<string | null>(null);
  const [status, setStatus] = useState<JumpStatus | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState<Phase>("opening");
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState("");
  const sentPrize = useRef<string | undefined>(undefined);

  function report(data: JumpStatus) {
    setStatus(data);
    if (data.prize?.month && sentPrize.current !== data.prize.month) {
      sentPrize.current = data.prize.month;
      onPrize();
    }
  }

  async function start() {
    if (opening.current) return;
    opening.current = true;
    if (!dialog.current?.open) dialog.current?.showModal();
    setPhase("opening");
    setError("");
    setResult(null);
    setPaused(false);
    try {
      const permission = status?.remaining === 0 ? Promise.resolve(false) : askForTilt();
      if (status?.remaining === 0) {
        const current = await fetchJumpStatus();
        report(current);
        if (current.remaining === 0) {
          setPhase("result");
          setRun(null);
          return;
        }
      }
      const tilt = await permission;
      requestId.current ??= crypto.randomUUID();
      const data = await startJumpRun(requestId.current);
      requestId.current = null;
      report(data);
      setRun({ id: data.runId, game: createJump(data.seed), input: [], tilt });
      setPhase("playing");
    } catch (err) {
      try {
        const current = await fetchJumpStatus();
        report(current);
        if (current.remaining === 0) {
          requestId.current = null;
          setRun(null);
          setPhase("result");
          return;
        }
      } catch {
        // Keep the original error and reuse the request ID on retry.
      }
      setError(err instanceof Error ? err.message : "Не удалось начать игру");
      setPhase("error");
    } finally {
      opening.current = false;
    }
  }

  async function finish(active: Run) {
    setPhase("saving");
    setError("");
    try {
      const data = await finishJumpRun(active.id, active.input.join(""));
      report(data);
      setResult(data.score);
      setPhase("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить результат");
      setPhase("error");
    }
  }

  function close() {
    if (phase === "opening" || phase === "saving") return;
    if (phase === "playing") {
      setPaused(true);
      return;
    }
    setRun(null);
    dialog.current?.close();
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="h-auto min-h-[54px] w-full min-w-0 justify-start gap-1.5 rounded-xl px-2 py-2 text-left"
        data-cuelume-press={SFX.nav}
        onClick={() => void start()}
      >
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-[#f2bd52] text-base font-bold text-[#322616]">₽</span>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-[13px] font-semibold sm:text-sm">Doodle Jump</span>
          <span className="text-muted-foreground text-[11px] font-normal">
            {status ? `Попытки: ${status.remaining} / 3` : "3 попытки · 500 ₽"}
          </span>
        </span>
        <ArrowUpRight aria-hidden="true" className="text-muted-foreground ml-auto hidden size-3.5 sm:block" />
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="jump-title"
        className="bg-background text-foreground fixed inset-0 m-auto h-dvh w-full max-h-none max-w-none p-0 backdrop:bg-black/60 sm:h-[min(760px,95dvh)] sm:max-w-[440px] sm:rounded-2xl"
        onCancel={(event) => { event.preventDefault(); close(); }}
      >
        <div className="mx-auto flex h-full w-full max-w-[440px] flex-col gap-3 overflow-y-auto px-4 pt-[max(12px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]">
          <header className="flex items-center justify-between gap-2">
            <h2 id="jump-title" className="text-lg font-semibold">Doodle Jump</h2>
            <Button type="button" variant="ghost" size="icon" aria-label="Закрыть игру" disabled={phase === "opening" || phase === "saving"} onClick={close}>
              <X />
            </Button>
          </header>
          {phase === "playing" && run && (
            <>
              <JumpField
                key={run.id}
                run={run}
                paused={paused}
                onPause={() => setPaused(true)}
                onDone={() => void finish(run)}
              />
              {paused && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => setPaused(false)}>Продолжить</Button>
                  <Button type="button" variant="ghost" onClick={() => {
                    setRun(null);
                    dialog.current?.close();
                  }}>Выйти из попытки</Button>
                </div>
              )}
            </>
          )}
          {(phase === "opening" || phase === "saving") && (
            <p role="status" className="text-muted-foreground py-12 text-center text-sm">
              {phase === "opening" ? "Запускаем игру…" : "Сохраняем результат…"}
            </p>
          )}
          {phase === "error" && (
            <div className="space-y-3">
              <p role="alert" className="text-destructive text-sm">{error}</p>
              <Button type="button" onClick={() => run?.game.done ? void finish(run) : void start()}>Повторить</Button>
            </div>
          )}
          {phase === "result" && status && (
            <div className="grid gap-5">
              {result !== null && (
                <div>
                  <p className="text-muted-foreground text-sm">Минус высота</p>
                  <p className="text-4xl font-semibold tabular-nums">{number.format(result)}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground mb-2 text-sm capitalize">{monthLabel(status.month)}</p>
                {[...status.players].sort((a, b) => b.best - a.best).map((player) => (
                  <div key={player.id} className="border-border flex items-center justify-between gap-2 border-b py-2">
                    <span>{player.name} <span className="text-muted-foreground text-xs">· {player.used}/3</span></span>
                    <strong className="tabular-nums">{number.format(player.best)}</strong>
                  </div>
                ))}
              </div>
              {status.prize?.winner && status.prize.month && (
                <p className="text-muted-foreground text-sm">{monthLabel(status.prize.month)} · получатель 500 ₽ — {status.prize.winner}. Перевод на Рокете.</p>
              )}
              <p className="text-muted-foreground text-sm">Приз месяца — 500 ₽ за лучший результат.</p>
              {status.remaining > 0 ? (
                <Button type="button" onClick={() => void start()}>Играть · осталось {status.remaining}</Button>
              ) : (
                <p className="text-muted-foreground text-sm">Попытки закончились. Следующие три будут в новом месяце.</p>
              )}
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
