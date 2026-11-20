// Level tutorial "Bengkel Penyihir": lantai kayu, platform naik,
// satu jurang yang wajib dilewati dengan ayun lidah, 5 lalat, goal
// di ujung. Jalur utama mengarah ke -z (dari spawn z=5 ke goal z=-34).
// Lompatan antar platform naik 1.2 m (tinggi lompat maks ~1.84 m);
// jurang 7 m tidak bisa dilompati (jarak lompat maks ~4.9 m).

import type { LevelDef } from "./types";

export const LEVEL_WORKSHOP: LevelDef = {
  id: "bengkel",
  name: "Bengkel Penyihir",
  platforms: [
    // Lantai awal (tempat spawn). Rapat ke p1, tanpa celah.
    { id: "floor0", min: { x: -8, y: -1, z: -3 }, max: { x: 8, y: 0, z: 8 } },
    // Anak tangga naik: 1.2 m lalu 2.4 m.
    { id: "p1", min: { x: -6, y: 0, z: -8 }, max: { x: 2, y: 1.2, z: -3 } },
    { id: "p2", min: { x: 0, y: 0, z: -13 }, max: { x: 8, y: 2.4, z: -8 } },
    // Jurang z -13..-20 (tanpa lantai). Seberang jurang:
    { id: "p3", min: { x: -6, y: 0, z: -25 }, max: { x: 4, y: 2.4, z: -20 } },
    { id: "p4", min: { x: -4, y: 0, z: -30 }, max: { x: 6, y: 3.6, z: -25 } },
    // Platform goal.
    { id: "goal", min: { x: -8, y: 0, z: -38 }, max: { x: 8, y: 3.6, z: -30 } },
  ],
  anchors: [
    // Anchor utama: lentera di balok atas jurang (wajib dipakai).
    { id: "swing", pos: { x: 2, y: 7.5, z: -16.5 } },
    // Anchor latihan di atas p1 + p4 (opsional).
    { id: "help1", pos: { x: 0, y: 5.2, z: -5.5 } },
    { id: "help2", pos: { x: -2, y: 6.5, z: -28 } },
  ],
  flies: [
    { id: "f1", pos: { x: 0, y: 1.6, z: 4 } },
    { id: "f2", pos: { x: -2, y: 2.8, z: -5.5 } },
    { id: "f3", pos: { x: 4, y: 4.0, z: -10.5 } },
    { id: "f4", pos: { x: 2, y: 5.2, z: -16.5 } },
    { id: "f5", pos: { x: 0, y: 5.2, z: -34.5 } },
  ],
  spawn: { x: 0, y: 0, z: 5 },
  goal: { pos: { x: 0, y: 3.6, z: -34.5 }, radius: 1.8 },
  bounds: { minX: -18, maxX: 18, minZ: -39, maxZ: 10, killY: -4 },
};

// Level co-op "Bengkel Penyihir (Co-op)": kerangka tutorial F1 + 2
// puzzle yang wajib 2 katak:
//  a. Tombol + pintu di z=-25: pintu besi menutup satu-satunya jalan
//     dari p3 ke p4. Tombol A di sisi p3, tombol B di sisi p4; pintu
//     terbuka selama ada tombol yang tertekan, jadi satu katak menahan
//     tombol sementara pasangannya lewat, lalu gantian.
//  b. Ayun pasangan di jurang ke-2 (z -30..-37, 7 m): lentera "rapuh"
//     di atas jurang hanya tahan sekali ayun, jadi hanya katak pertama
//     yang bisa mengayun. Katak ke-2 harus ditarik lidah pasangannya
//     dari seberang (lidah bisa nempel ke katak lain).
// Menang: kedua katak sampai portal.
export const LEVEL_WORKSHOP_COOP: LevelDef = {
  id: "workshop-coop",
  name: "Bengkel Penyihir (Co-op)",
  platforms: [
    { id: "floor0", min: { x: -8, y: -1, z: -3 }, max: { x: 8, y: 0, z: 8 } },
    { id: "p1", min: { x: -6, y: 0, z: -8 }, max: { x: 2, y: 1.2, z: -3 } },
    { id: "p2", min: { x: 0, y: 0, z: -13 }, max: { x: 8, y: 2.4, z: -8 } },
    { id: "p3", min: { x: -6, y: 0, z: -25 }, max: { x: 4, y: 2.4, z: -20 } },
    // Pintu besi: menutup celah z=-25 (satu-satunya jalan p3 -> p4).
    { id: "door", min: { x: -4, y: 2.4, z: -25.6 }, max: { x: 6, y: 5.6, z: -25 } },
    { id: "p4", min: { x: -4, y: 0, z: -30 }, max: { x: 6, y: 3.6, z: -25 } },
    // Platform goal di seberang jurang ke-2 (tanpa p4 lama di tengah).
    { id: "goal", min: { x: -8, y: 0, z: -45 }, max: { x: 8, y: 3.6, z: -37 } },
  ],
  anchors: [
    { id: "swing", pos: { x: 2, y: 7.5, z: -16.5 } },
    { id: "help1", pos: { x: 0, y: 5.2, z: -5.5 } },
    { id: "help2", pos: { x: -2, y: 6.5, z: -28 } },
    // Lentera rapuh di atas jurang ke-2: sekali pakai.
    { id: "fragile", pos: { x: 1, y: 7.5, z: -33.5 }, oneUse: true },
  ],
  flies: [
    { id: "f1", pos: { x: 0, y: 1.6, z: 4 } },
    { id: "f2", pos: { x: -2, y: 2.8, z: -5.5 } },
    { id: "f3", pos: { x: 4, y: 4.0, z: -10.5 } },
    { id: "f4", pos: { x: 2, y: 5.2, z: -16.5 } },
    { id: "f5", pos: { x: 4.5, y: 5.0, z: -28.5 } },
    { id: "f6", pos: { x: 1, y: 5.5, z: -33.5 } },
    { id: "f7", pos: { x: 0, y: 5.2, z: -41.5 } },
  ],
  spawn: { x: 0, y: 0, z: 5 },
  spawn2: { x: 2.5, y: 0, z: 5 },
  buttons: [
    { id: "btn-a", pos: { x: -4.5, y: 2.4, z: -21.5 }, radius: 1.1 },
    { id: "btn-b", pos: { x: 4.5, y: 3.6, z: -28.5 }, radius: 1.1 },
  ],
  door: { platformId: "door", buttonIds: ["btn-a", "btn-b"] },
  goal: { pos: { x: 0, y: 3.6, z: -41.5 }, radius: 1.8 },
  bounds: { minX: -18, maxX: 18, minZ: -46, maxZ: 10, killY: -4 },
};

export const LEVELS: LevelDef[] = [LEVEL_WORKSHOP, LEVEL_WORKSHOP_COOP];

export function getLevel(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? LEVEL_WORKSHOP;
}
