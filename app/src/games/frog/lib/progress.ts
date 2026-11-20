// Progresi level katak (F3): level terbuka berurutan + level yang
// sudah selesai, disimpan di localStorage (pola naval). Dipakai store
// solo dan co-op (progresi yang sama di kedua mode).

import { LEVEL_PACK } from "../../../../../shared/frog/levels";

export const FROG_UNLOCK_KEY = "minigame:frog-unlocked";
export const FROG_DONE_KEY = "minigame:frog-completed";

/** Jumlah level yang terbuka (1..4), default 1. */
export function readUnlocked(): number {
  try {
    const v = Number(localStorage.getItem(FROG_UNLOCK_KEY));
    if (Number.isInteger(v) && v >= 1 && v <= LEVEL_PACK.length) return v;
  } catch {
    // localStorage tidak tersedia: mulai dari level 1.
  }
  return 1;
}

/** Id pack level yang sudah selesai. */
export function readCompleted(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FROG_DONE_KEY) ?? "[]");
    if (Array.isArray(raw)) {
      return raw.filter((id) => LEVEL_PACK.some((m) => m.id === id));
    }
  } catch {
    // Data rusak: anggap belum ada yang selesai.
  }
  return [];
}

/** Tandai level selesai + buka level berikutnya. Kembalikan progres
 * baru (buat di-sync ke store). */
export function markCompleted(levelId: string): {
  unlocked: number;
  completed: string[];
} {
  const completed = readCompleted();
  if (!completed.includes(levelId)) completed.push(levelId);
  const idx = LEVEL_PACK.findIndex((m) => m.id === levelId);
  const unlocked = Math.max(readUnlocked(), Math.min(LEVEL_PACK.length, idx + 2));
  try {
    localStorage.setItem(FROG_DONE_KEY, JSON.stringify(completed));
    localStorage.setItem(FROG_UNLOCK_KEY, String(unlocked));
  } catch {
    // localStorage tidak tersedia: progres hanya di sesi ini.
  }
  return { unlocked, completed };
}
