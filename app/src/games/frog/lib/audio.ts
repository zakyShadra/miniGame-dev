// Suara katak (F4): kroak, lompat, lidah, makan lalat, pintu, menang.
// WebAudio murni (osilator + noise), tanpa file eksternal. Memakai
// AudioContext + preferensi mute bersama dari lib/sound (satu tombol
// mute untuk semua game). Pola sama seperti audio naval. Semua fungsi
// aman dipanggil kapan saja: tidak bunyi (dan tidak error) bila
// AudioContext diblokir / belum ada interaksi.
// Volume 0..1 dari pemanggil (atenuasi jarak ke katak pasangan).

import { getAudioContext, muted } from "../../../lib/sound";

/** Statistik buat QA Playwright (jumlah bunyi yang benar-benar dimainkan). */
export const frogAudioStats = { played: 0, kinds: {} as Record<string, number> };

if (typeof window !== "undefined") {
  (window as unknown as { __frogAudio?: unknown }).__frogAudio = {
    stats: frogAudioStats,
  };
}

// Jeda minimum antar bunyi sejenis (ms).
const THROTTLE_MS: Record<string, number> = {
  croak: 300,
  jump: 120,
  tongueFire: 150,
  tongueStick: 150,
  eatFly: 100,
  door: 500,
  win: 1000,
  bounce: 200,
  land: 150,
  ring: 300,
  kiss: 1000,
};
const lastPlayed: Record<string, number> = {};

let noiseBuf: AudioBuffer | null = null;
let noiseCtx: AudioContext | null = null;

function getNoise(ac: AudioContext): AudioBuffer {
  if (noiseBuf && noiseCtx === ac) return noiseBuf;
  const len = Math.floor(ac.sampleRate * 1);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  noiseCtx = ac;
  return buf;
}

function ready(kind: string): AudioContext | null {
  if (muted.value) return null;
  const now = performance.now();
  if (now - (lastPlayed[kind] ?? 0) < (THROTTLE_MS[kind] ?? 0)) return null;
  const ac = getAudioContext();
  if (!ac) return null;
  lastPlayed[kind] = now;
  frogAudioStats.played++;
  frogAudioStats.kinds[kind] = (frogAudioStats.kinds[kind] ?? 0) + 1;
  return ac;
}

function noise(
  ac: AudioContext,
  at: number,
  dur: number,
  filterType: BiquadFilterType,
  freqFrom: number,
  freqTo: number,
  vol: number,
): void {
  const src = ac.createBufferSource();
  src.buffer = getNoise(ac);
  src.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freqFrom, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), at + dur);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(at);
  src.stop(at + dur + 0.05);
}

function tone(
  ac: AudioContext,
  type: OscillatorType,
  at: number,
  dur: number,
  freqFrom: number,
  freqTo: number,
  vol: number,
): void {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), at + dur);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

function clampVol(vol: number): number {
  return Math.max(0, Math.min(1, vol));
}

/** Kroak: dua denyut rendah ("rib-bit"). */
export function playCroak(vol = 1): void {
  try {
    const ac = ready("croak");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    tone(ac, "sine", now, 0.09, 170, 95, 0.4 * v);
    tone(ac, "sine", now + 0.12, 0.11, 150, 85, 0.4 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Lompat: cicit naik cepat. */
export function playJump(vol = 1): void {
  try {
    const ac = ready("jump");
    if (!ac) return;
    tone(ac, "sine", ac.currentTime, 0.14, 280, 540, 0.18 * clampVol(vol));
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Lidah meluncur: desis whoosh naik. */
export function playTongueFire(vol = 1): void {
  try {
    const ac = ready("tongueFire");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    noise(ac, now, 0.14, "bandpass", 900, 2400, 0.22 * v);
    tone(ac, "sine", now, 0.1, 600, 1200, 0.08 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Lidah menempel: "thwip" pendek. */
export function playTongueStick(vol = 1): void {
  try {
    const ac = ready("tongueStick");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    noise(ac, now, 0.08, "lowpass", 800, 200, 0.25 * v);
    tone(ac, "sine", now, 0.08, 220, 140, 0.2 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Makan lalat: "pop" kecil + blip tinggi. */
export function playEatFly(vol = 1): void {
  try {
    const ac = ready("eatFly");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    tone(ac, "sine", now, 0.07, 900, 300, 0.25 * v);
    tone(ac, "triangle", now + 0.03, 0.06, 1400, 1400, 0.12 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Pintu besi terbuka: gemuruh rendah + derit. */
export function playDoorOpen(vol = 1): void {
  try {
    const ac = ready("door");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    tone(ac, "sawtooth", now, 0.5, 70, 45, 0.12 * v);
    noise(ac, now, 0.4, "lowpass", 300, 100, 0.2 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Menang: jingle 4 nada naik. */
export function playWin(vol = 1): void {
  try {
    const ac = ready("win");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      tone(ac, "triangle", now + i * 0.11, 0.18, freq, freq, 0.2 * v);
    });
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Jamur lompat: "boing" pegas. */
export function playBounce(vol = 1): void {
  try {
    const ac = ready("bounce");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    tone(ac, "sine", now, 0.09, 200, 500, 0.2 * v);
    tone(ac, "sine", now + 0.09, 0.1, 500, 240, 0.18 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Mendarat: debuk pelan. */
export function playLand(vol = 1): void {
  try {
    const ac = ready("land");
    if (!ac) return;
    tone(ac, "sine", ac.currentTime, 0.1, 90, 50, 0.14 * clampVol(vol));
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Cincin emas aktif (F6.2): lonceng cerah 2 nada + kilau. */
export function playRing(vol = 1): void {
  try {
    const ac = ready("ring");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    tone(ac, "sine", now, 0.25, 880, 880, 0.2 * v);
    tone(ac, "sine", now + 0.09, 0.3, 1318.5, 1318.5, 0.18 * v);
    noise(ac, now, 0.3, "highpass", 6000, 9000, 0.05 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Ciuman lidah (F6.8): kecupan "muah" (smack + cicit naik). */
export function playKiss(vol = 1): void {
  try {
    const ac = ready("kiss");
    if (!ac) return;
    const now = ac.currentTime;
    const v = clampVol(vol);
    noise(ac, now, 0.07, "lowpass", 1200, 300, 0.3 * v);
    tone(ac, "sine", now + 0.05, 0.16, 700, 1250, 0.16 * v);
    tone(ac, "sine", now + 0.16, 0.12, 1250, 1568, 0.1 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Atenuasi jarak: 1 di dekat katak, turun ke 0.1 di 40 m. */
export function attenByDistance(distMeters: number): number {
  return Math.max(0.1, Math.min(1, 1 - distMeters / 40));
}
