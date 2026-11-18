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

// Bunyi akhir game catur (round 2, tugas 5): jingle pendek WebAudio,
// tanpa file audio. Menang = 3 nada naik, kalah = 2 nada turun,
// remis = 2 nada datar. Memanggil ensureAudio() dulu: kalau game
// berakhir tepat di klik user (langkah skakmat), konteks dibuat di
// dalam gesture dan langsung berbunyi.
export function playGameEnd(outcome: "win" | "loss" | "draw") {
  ensureAudio();
  const ac = ctx;
  if (muted.value || !ac || ac.state !== "running") return;
  const notes =
    outcome === "win"
      ? [523.25, 659.25, 783.99]
      : outcome === "loss"
        ? [392.0, 311.13]
        : [440.0, 440.0];
  const now = ac.currentTime;
  notes.forEach((freq, i) => {
    const start = now + i * 0.11;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
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
