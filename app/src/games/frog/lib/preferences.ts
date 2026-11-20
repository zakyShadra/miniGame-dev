// Preferensi kamera + bidik katak (F6.13/F6.14/F6.15), tersimpan di
// localStorage supaya pilihan pemain bertahan antar sesi. Aman di
// lingkungan tanpa localStorage (SSR/QA): baca gagal = default false.

export const HIGH_CAM_KEY = "minigame:frog-highcam";
export const AIM_FACING_KEY = "minigame:frog-aim-facing";
export const LICK_KEY = "minigame:frog-lick";

export function readPref(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // localStorage tidak tersedia: abaikan.
  }
}
