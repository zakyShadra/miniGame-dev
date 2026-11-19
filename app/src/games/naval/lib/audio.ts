// Suara naval (N6): meriam, ledakan, cipratan, tenggelam. WebAudio
// murni (osilator + noise), tanpa file eksternal. Memakai AudioContext
// + preferensi mute bersama dari lib/sound (satu tombol mute untuk
// semua game). Semua fungsi aman dipanggil kapan saja: tidak bunyi
// (dan tidak error) bila AudioContext diblokir / belum ada interaksi.
// Volume 0..1 dari pemanggil (atenuasi jarak ke kapal pemain).

import { getAudioContext, muted } from "../../../lib/sound";

/** Statistik buat QA Playwright (jumlah bunyi yang benar-benar dimainkan). */
export const navalAudioStats = { played: 0, kinds: {} as Record<string, number> };

if (typeof window !== "undefined") {
  (window as unknown as { __navalAudio?: unknown }).__navalAudio = {
    stats: navalAudioStats,
  };
}

// Jeda minimum antar bunyi sejenis (ms) supaya volley tidak berisik.
const THROTTLE_MS: Record<string, number> = {
  cannon: 90,
  explosion: 70,
  splash: 90,
  sink: 300,
  thud: 120,
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
  navalAudioStats.played++;
  navalAudioStats.kinds[kind] = (navalAudioStats.kinds[kind] ?? 0) + 1;
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

/** Dentum meriam: sinus rendah jatuh + desis noise pendek. */
export function playCannon(vol = 1): void {
  try {
    const ac = ready("cannon");
    if (!ac) return;
    const now = ac.currentTime;
    const v = Math.max(0, Math.min(1, vol));
    tone(ac, "sine", now, 0.18, 95, 42, 0.5 * v);
    noise(ac, now, 0.12, "lowpass", 700, 200, 0.35 * v);
  } catch {
    // Audio gagal (konteks ditutup dsb): game tetap jalan tanpa suara.
  }
}

/** Ledakan kena hit: noise besar + dentum bawah. */
export function playExplosion(vol = 1): void {
  try {
    const ac = ready("explosion");
    if (!ac) return;
    const now = ac.currentTime;
    const v = Math.max(0, Math.min(1, vol));
    noise(ac, now, 0.5, "lowpass", 1200, 120, 0.55 * v);
    tone(ac, "sine", now, 0.3, 70, 30, 0.45 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Cipratan air: noise bandpass pendek. */
export function playSplash(vol = 1): void {
  try {
    const ac = ready("splash");
    if (!ac) return;
    const now = ac.currentTime;
    const v = Math.max(0, Math.min(1, vol));
    noise(ac, now, 0.35, "bandpass", 1000, 500, 0.28 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Kapal tenggelam: sweep rendah memanjang. */
export function playSink(vol = 1): void {
  try {
    const ac = ready("sink");
    if (!ac) return;
    const now = ac.currentTime;
    const v = Math.max(0, Math.min(1, vol));
    tone(ac, "sine", now, 1.1, 220, 38, 0.3 * v);
    noise(ac, now + 0.1, 0.9, "lowpass", 500, 100, 0.18 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Benturan (pulau / kapal): dentum pendek pelan. */
export function playThud(vol = 1): void {
  try {
    const ac = ready("thud");
    if (!ac) return;
    const now = ac.currentTime;
    const v = Math.max(0, Math.min(1, vol));
    tone(ac, "sine", now, 0.12, 75, 45, 0.25 * v);
  } catch {
    // Audio gagal: abaikan.
  }
}

/** Atenuasi jarak: 1 di dekat kapal, turun ke 0.12 di 450 m. */
export function attenByDistance(distMeters: number): number {
  return Math.max(0.12, Math.min(1, 1 - distMeters / 450));
}
