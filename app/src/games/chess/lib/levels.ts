// Konfigurasi 4 level bot (UCI Skill Level + depth + movetime).
// Skill Level 0-20: 0 paling acak, 20 kekuatan penuh. Depth membatasi
// seberapa dalam engine menghitung; movetime membatasi waktu pikir
// (yang tercapai duluan yang menang). Level Mudah kadang sengaja
// mengambil langkah ke-2/ke-3 terbaik (randomPickChance) supaya
// terasa manusiawi, bukan sekadar engine lemah yang konsisten.

import type { BotLevel } from "../stores/chess";

export interface BotLevelConfig {
  id: BotLevel;
  name: string;
  description: string;
  skill: number;
  depth: number;
  movetimeMs: number;
  multiPv: number;
  randomPickChance: number;
}

export const BOT_LEVELS: BotLevelConfig[] = [
  {
    id: "easy",
    name: "Mudah",
    description: "Santai, sering salah langkah. Cocok buat belajar.",
    skill: 1,
    depth: 2,
    movetimeMs: 300,
    multiPv: 3,
    randomPickChance: 0.35,
  },
  {
    id: "medium",
    name: "Medium",
    description: "Main wajar, kadang blunder kecil.",
    skill: 8,
    depth: 5,
    movetimeMs: 500,
    multiPv: 1,
    randomPickChance: 0,
  },
  {
    id: "hard",
    name: "Sulit",
    description: "Jarang salah, menghukum blunder.",
    skill: 15,
    depth: 8,
    movetimeMs: 1000,
    multiPv: 1,
    randomPickChance: 0,
  },
  {
    id: "extreme",
    name: "Extreme",
    description: "Kekuatan penuh Stockfish. Siap-siap kalah.",
    skill: 20,
    depth: 12,
    movetimeMs: 1500,
    multiPv: 1,
    randomPickChance: 0,
  },
];

export function getLevelConfig(level: BotLevel): BotLevelConfig {
  return BOT_LEVELS.find((l) => l.id === level) ?? BOT_LEVELS[1]!;
}
