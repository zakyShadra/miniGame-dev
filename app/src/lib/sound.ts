// Bunyi snap halus saat piece terpasang (M3): WebAudio oscillator,
// tanpa file audio. AudioContext dibuat/diresume hanya setelah
// interaksi user pertama (aturan autoplay browser). Preferensi mute
// disimpan di localStorage.

import { ref } from "vue";

const MUTE_KEY = "puzzlegame:muted";

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export const muted = ref(loadMuted());

export function setMuted(m: boolean) {
  muted.value = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    // localStorage nonaktif: abaikan.
  }
}

let ctx: AudioContext | null = null;

// Panggil dari handler interaksi user (pointerdown) supaya audio
// diizinkan browser. Aman dipanggil berulang kali.
export function ensureAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

// Klik kayu lembut: osilator triangle 1200 -> 500 Hz dalam 80ms,
// gain turun cepat. Tidak bunyi kalau belum ada interaksi user
// (AudioContext masih suspended) atau kalau di-mute.
export function playSnap() {
  if (muted.value || !ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.exponentialRampToValueAtTime(500, now + 0.08);
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}
