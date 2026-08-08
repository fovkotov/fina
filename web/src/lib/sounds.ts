import { play, type SoundName } from "cuelume";

/**
 * Единая звуковая карта UI.
 * Близкие по роли контролы → один и тот же cue.
 */
export const SFX = {
  /** Табы, сегменты, переключатели выбора */
  nav: "tick" as const,
  /** Primary CTA (сохранить / войти) — press */
  primaryPress: "pulse" as const,
  /** Primary CTA — release / успех внесения */
  success: "success" as const,
  /** Списание / удаление */
  remove: "droplet" as const,
  /** Вторичные действия (обновить, копировать-старт) */
  secondary: "scan" as const,
  /** Тихий выход */
  logout: "whisper" as const,
  /** Ошибка */
  error: "error" as const,
  /** Старт загрузки по кнопке */
  loading: "loading" as const,
} satisfies Record<string, SoundName>;

export function sfx(name: keyof typeof SFX) {
  play(SFX[name]);
}
