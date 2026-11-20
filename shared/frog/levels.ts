// Level tutorial "Bengkel Penyihir": lantai kayu, platform naik,
// satu jurang yang wajib dilewati dengan ayun lidah, 5 lalat, goal
// di ujung. Jalur utama mengarah ke -z (dari spawn z=5 ke goal z=-34).
// Lompatan antar platform naik 1.2 m (tinggi lompat maks ~1.84 m);
// jurang 7 m tidak bisa dilompati (jarak lompat maks ~3.3 m).

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
    // Pijakan tengah jurang (F6.2): tersembunyi sampai cincin r1 kena
    // lidah. Alternatif ayun: lompat p2 -> step1 -> p3.
    { id: "step1", min: { x: -3.5, y: 0, z: -18 }, max: { x: -0.5, y: 1.2, z: -15 }, hiddenUntil: "r1" },
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
  rings: [
    // Cincin emas di atas jurang (sisi kiri, jauh dari anchor swing +
    // lalat f4): kena lidah = step1 muncul + sparkle biru.
    { id: "r1", pos: { x: -2, y: 4.5, z: -16.5 } },
  ],
  // Orb hijau (F6.11): tersembunyi di luar jalur utama, diambil
  // dengan lidah. Masing-masing >= 2,5 m dari lalat/anchor/cincin
  // terdekat supaya tidak mencuri bidikan.
  orbs: [
    { id: "o1", pos: { x: -5.5, y: 2.6, z: 6.5 } },
    { id: "o2", pos: { x: 5.5, y: 3.2, z: -5.5 } },
    { id: "o3", pos: { x: 5.5, y: 5.8, z: -16.5 } },
    { id: "o4", pos: { x: -6.5, y: 4.6, z: -27.5 } },
    { id: "o5", pos: { x: -6.5, y: 2.2, z: -10.5 } },
  ],
  // Koin emas (F6.11): di atas meja, dekat puzzle, diambil lidah.
  coins: [
    { id: "c1", pos: { x: 3, y: 0.4, z: 6 } },
    { id: "c2", pos: { x: 6.5, y: 2.8, z: -10.5 } },
    { id: "c3", pos: { x: 4.5, y: 4.0, z: -27.5 } },
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

// Level co-op "Bengkel Penyihir (Co-op)": kerangka tutorial F1 + 3
// puzzle yang wajib 2 katak:
//  a. Pintu tarik (F6.3) di z=-22: dua katak menempelkan lidah ke
//     gagang pintu bundar, pintu bergeser membuka jalan ke tombol A.
//  b. Tombol + pintu di z=-25: pintu besi menutup satu-satunya jalan
//     dari p3 ke p4. Tombol A di sisi p3, tombol B di sisi p4; pintu
//     terbuka selama ada tombol yang tertekan, jadi satu katak menahan
//     tombol sementara pasangannya lewat, lalu gantian.
//  c. Ayun pasangan di jurang ke-2 (z -30..-37, 7 m): lentera "rapuh"
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
    // Pijakan tengah jurang 1 (F6.2): tersembunyi sampai cincin r1
    // kena lidah. Jurang ke-2 SENGAJA tanpa cincin: puzzle lentera
    // rapuh + tarik pasangan harus tetap wajib.
    { id: "step1", min: { x: -3.5, y: 0, z: -18 }, max: { x: -0.5, y: 1.2, z: -15 }, hiddenUntil: "r1" },
    // Pintu tarik bundar (F6.3, puzzle baru): menutup jalan p3 di
    // z=-22. Segmen statis pullwall (x 0..4) + pintu geser pulldoor
    // (x -6..0, di depan dinding 0.6 m). Dua katak menempelkan lidah
    // ke gagang (-3, 3.6, -21.2), pintu bergeser +x 4 m dan membuka
    // celah x -6..-2 menuju tombol A. Atas pintu 5.6 m: tidak bisa
    // dilompati (apex lompat 4.24 m dari p3).
    { id: "pullwall", min: { x: 0, y: 2.4, z: -22.6 }, max: { x: 4, y: 5.6, z: -22 } },
    { id: "pulldoor", min: { x: -6, y: 2.4, z: -21.9 }, max: { x: 0, y: 5.6, z: -21.3 } },
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
  rings: [{ id: "r1", pos: { x: -2, y: 4.5, z: -16.5 } }],
  // Orb + koin (F6.11): sama seperti solo, ditambah o6 di atas jurang
  // ke-2 dan c4 di platform goal.
  orbs: [
    { id: "o1", pos: { x: -5.5, y: 2.6, z: 6.5 } },
    { id: "o2", pos: { x: 5.5, y: 3.2, z: -5.5 } },
    { id: "o3", pos: { x: 5.5, y: 5.8, z: -16.5 } },
    { id: "o4", pos: { x: -6.5, y: 4.6, z: -27.5 } },
    { id: "o5", pos: { x: -6.5, y: 2.2, z: -10.5 } },
    { id: "o6", pos: { x: 4.5, y: 6.0, z: -33.5 } },
  ],
  coins: [
    { id: "c1", pos: { x: 3, y: 0.4, z: 6 } },
    { id: "c2", pos: { x: 6.5, y: 2.8, z: -10.5 } },
    { id: "c3", pos: { x: 4.5, y: 4.0, z: -27.5 } },
    { id: "c4", pos: { x: -5, y: 4.0, z: -41 } },
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
  pullDoors: [
    { id: "pd1", platformId: "pulldoor", axis: "x", slide: 4, target: { x: -3, y: 3.6, z: -21.2 } },
  ],
  buttons: [
    { id: "btn-a", pos: { x: -4.5, y: 2.4, z: -21.5 }, radius: 1.1 },
    { id: "btn-b", pos: { x: 4.5, y: 3.6, z: -28.5 }, radius: 1.1 },
  ],
  door: { platformId: "door", buttonIds: ["btn-a", "btn-b"] },
  goal: { pos: { x: 0, y: 3.6, z: -41.5 }, radius: 1.8 },
  bounds: { minX: -18, maxX: 18, minZ: -46, maxZ: 10, killY: -4 },
};

// Level 2 "Selokan Bercahaya" (F3): selokan gelap, air di bawah
// (jatuh = respawn checkpoint). Jalur zigzag ke kiri lalu lurus -z.
// Puzzle: (1) ayun jurang 7 m, (2) tombol + pintu di z=-27,
// (3) ayunan ganda: lentera d1 ke pulau tengah, lalu lentera rapuh d2
// (sekali pakai) ke seberang; co-op katak ke-2 ditarik lidah pasangan.
export const LEVEL_SEWER: LevelDef = {
  id: "selokan",
  name: "Selokan Bercahaya",
  theme: "sewer",
  platforms: [
    { id: "floor0", min: { x: -8, y: -1, z: -3 }, max: { x: 8, y: 0, z: 8 } },
    { id: "s1", min: { x: -8, y: 0, z: -9 }, max: { x: -1, y: 1.2, z: -3 } },
    { id: "s2", min: { x: -8, y: 0, z: -15 }, max: { x: -1, y: 2.4, z: -9 } },
    // Pijakan tengah jurang 1 (F6.2): tersembunyi sampai cincin r1
    // kena lidah. Alternatif ayun swing1.
    { id: "step1", min: { x: -3, y: 0, z: -20 }, max: { x: 0, y: 1.2, z: -17 }, hiddenUntil: "r1" },
    // s3 + pintu selebar penuh (x -8..8): pintu yang lebih sempit dari
    // jalan bisa dilompati diagonal dari tepinya.
    { id: "s3", min: { x: -8, y: 0, z: -27 }, max: { x: 8, y: 2.4, z: -22 } },
    { id: "door", min: { x: -8, y: 2.4, z: -27.6 }, max: { x: 8, y: 5.6, z: -27 } },
    { id: "s4", min: { x: -8, y: 0, z: -33 }, max: { x: 8, y: 3.6, z: -27 } },
    // Pulau tengah sedalam 5 m: ayunan d1 mendarat di z=-42 dengan
    // momentum maju, pulau 3 m membuat katak meluncur jatuh ke jurang.
    { id: "island", min: { x: -3, y: 0, z: -44 }, max: { x: 3, y: 3.6, z: -39 } },
    { id: "goal", min: { x: -8, y: 0, z: -57 }, max: { x: 8, y: 3.6, z: -50 } },
  ],
  anchors: [
    { id: "help1", pos: { x: 0, y: 5.2, z: -5.5 } },
    { id: "swing1", pos: { x: -4.5, y: 7, z: -18.5 } },
    { id: "d1", pos: { x: 0, y: 7.5, z: -36 } },
    { id: "d2", pos: { x: 0, y: 7.5, z: -47 }, oneUse: true },
  ],
  rings: [
    // Cincin di tepi kanan jurang 1 (jauh dari lalat f4 di x -4.5):
    // kena lidah = step1 muncul + sparkle biru.
    { id: "r1", pos: { x: -1.5, y: 4, z: -18.5 } },
  ],
  flies: [
    { id: "f1", pos: { x: 0, y: 1.6, z: 4 } },
    { id: "f2", pos: { x: -4, y: 2.8, z: -6 } },
    { id: "f3", pos: { x: -4, y: 4, z: -12 } },
    { id: "f4", pos: { x: -4.5, y: 5, z: -18.5 } },
    { id: "f5", pos: { x: 0, y: 5, z: -30 } },
    { id: "f6", pos: { x: 0, y: 5.2, z: -36 } },
    { id: "f7", pos: { x: 0, y: 5.2, z: -53.5 } },
  ],
  spawn: { x: 0, y: 0, z: 5 },
  spawn2: { x: 2.5, y: 0, z: 5 },
  buttons: [
    { id: "btn-a", pos: { x: -6.5, y: 2.4, z: -23.5 }, radius: 1.1 },
    { id: "btn-b", pos: { x: 5, y: 3.6, z: -30 }, radius: 1.1 },
  ],
  door: { platformId: "door", buttonIds: ["btn-a", "btn-b"] },
  goal: { pos: { x: 0, y: 3.6, z: -53.5 }, radius: 1.8 },
  bounds: { minX: -18, maxX: 18, minZ: -58, maxZ: 10, killY: -4 },
};

// Level 3 "Atap Perpustakaan" (F3): tangga buku raksasa naik ke kanan,
// lalu buku terbang (platform bergerak, sumbu z, amplitudo 3 m,
// periode 6 dtk) menyeberangi jurang 12 m, pintu di rak atas, dan
// ayun ke atap goal. Puzzle: (1) buku terbang, (2) tombol + pintu,
// (3) ayun jurang 7 m.
export const LEVEL_LIBRARY: LevelDef = {
  id: "atap",
  name: "Atap Perpustakaan",
  theme: "library",
  platforms: [
    { id: "floor0", min: { x: -8, y: -1, z: -3 }, max: { x: 8, y: 0, z: 8 } },
    { id: "b1", min: { x: 2, y: 0, z: -8 }, max: { x: 10, y: 1.2, z: -3 } },
    { id: "b2", min: { x: 4, y: 0, z: -13 }, max: { x: 12, y: 2.4, z: -8 } },
    { id: "b3", min: { x: 6, y: 0, z: -18 }, max: { x: 14, y: 3.6, z: -13 } },
    // Buku terbang: papan melayang (tebal 0.6 m), naik saat di ujung
    // dekat b3 (z -22..-19) dan ujung dekat b4 (z -28..-25). Celah ke
    // b4 2 m di ujung jauh (F6.7: lompat 4 m/s ~3.3 m, lompat dari
    // tepi buku sampai dengan margin).
    { id: "book1", min: { x: 8, y: 3, z: -25 }, max: { x: 11, y: 3.6, z: -22 } },
    { id: "b4", min: { x: 6, y: 0, z: -36 }, max: { x: 14, y: 3.6, z: -30 } },
    { id: "door", min: { x: 6, y: 3.6, z: -36.6 }, max: { x: 14, y: 6.8, z: -36 } },
    { id: "b5", min: { x: 6, y: 0, z: -42 }, max: { x: 14, y: 4.8, z: -36 } },
    { id: "goal", min: { x: 4, y: 0, z: -55 }, max: { x: 14, y: 4.8, z: -49 } },
  ],
  movers: [{ platformId: "book1", axis: "z", amplitude: 3, period: 6 }],
  anchors: [
    { id: "help1", pos: { x: 6, y: 5.5, z: -5.5 } },
    { id: "swing", pos: { x: 10, y: 8.5, z: -45.5 } },
  ],
  flies: [
    { id: "f1", pos: { x: 0, y: 1.6, z: 4 } },
    { id: "f2", pos: { x: 6, y: 2.8, z: -5.5 } },
    { id: "f3", pos: { x: 8, y: 4, z: -10.5 } },
    { id: "f4", pos: { x: 10, y: 5.2, z: -15.5 } },
    { id: "f5", pos: { x: 9.5, y: 5, z: -22.5 } },
    { id: "f6", pos: { x: 10, y: 6.4, z: -38 } },
    { id: "f7", pos: { x: 9, y: 6.4, z: -52 } },
  ],
  spawn: { x: 0, y: 0, z: 5 },
  spawn2: { x: 2.5, y: 0, z: 5 },
  buttons: [
    { id: "btn-a", pos: { x: 8, y: 3.6, z: -32 }, radius: 1.1 },
    { id: "btn-b", pos: { x: 12, y: 4.8, z: -39 }, radius: 1.1 },
  ],
  door: { platformId: "door", buttonIds: ["btn-a", "btn-b"] },
  goal: { pos: { x: 9, y: 4.8, z: -52 }, radius: 1.8 },
  bounds: { minX: -18, maxX: 18, minZ: -56, maxZ: 10, killY: -4 },
};

// Level 4 "Taman Jamur" (F3): taman terbuka, naik vertikal dengan
// jamur lompat (apex ~3.27 m, anak tangga 2.4 m tidak bisa dilompati
// biasa). Puzzle: (1) rantai 2 jamur lompat, (2) tombol + pintu di
// ketinggian, (3) piring spora bergerak menyeberangi jurang 12 m.
export const LEVEL_GARDEN: LevelDef = {
  id: "taman",
  name: "Taman Jamur",
  theme: "garden",
  platforms: [
    { id: "floor0", min: { x: -8, y: -1, z: -3 }, max: { x: 8, y: 0, z: 8 } },
    { id: "g1", min: { x: -6, y: 0, z: -10 }, max: { x: 6, y: 1.2, z: -3 } },
    { id: "g2", min: { x: -6, y: 0, z: -16 }, max: { x: 6, y: 3.6, z: -10 } },
    { id: "g3", min: { x: -6, y: 0, z: -22 }, max: { x: 6, y: 6, z: -16 } },
    { id: "door", min: { x: -6, y: 6, z: -22.6 }, max: { x: 6, y: 9.2, z: -22 } },
    { id: "g4", min: { x: -6, y: 0, z: -28 }, max: { x: 6, y: 7.2, z: -22 } },
    // Piring spora: papan melayang (tebal 0.6 m), ujung dekat g4
    // (z -32..-29) dan ujung dekat goal (z -38..-35).
    { id: "spore1", min: { x: -1.5, y: 6.6, z: -35 }, max: { x: 1.5, y: 7.2, z: -32 } },
    { id: "goal", min: { x: -8, y: 0, z: -47 }, max: { x: 8, y: 7.2, z: -40 } },
  ],
  movers: [{ platformId: "spore1", axis: "z", amplitude: 3, period: 7 }],
  mushrooms: [
    // Jamur 1 m dari tepi platform (F6.7): loncatan 12 m/s + lari
    // 4 m/s mendarat di platform berikutnya (dari -7/-13, loncatan
    // di 4 m/s jatuh 0.8 m sebelum tepi).
    { id: "m1", pos: { x: 0, y: 1.2, z: -8 }, radius: 1.2 },
    { id: "m2", pos: { x: 0, y: 3.6, z: -14 }, radius: 1.2 },
  ],
  anchors: [{ id: "help1", pos: { x: 0, y: 5.2, z: -5.5 } }],
  flies: [
    { id: "f1", pos: { x: 0, y: 1.6, z: 4 } },
    { id: "f2", pos: { x: 3, y: 2.8, z: -6.5 } },
    { id: "f3", pos: { x: 0, y: 5.2, z: -10.5 } },
    { id: "f4", pos: { x: -3, y: 5.2, z: -13 } },
    { id: "f5", pos: { x: 0, y: 7.8, z: -19 } },
    { id: "f6", pos: { x: 0, y: 8.6, z: -34 } },
    { id: "f7", pos: { x: 0, y: 8.8, z: -43.5 } },
  ],
  spawn: { x: 0, y: 0, z: 5 },
  spawn2: { x: 2.5, y: 0, z: 5 },
  buttons: [
    { id: "btn-a", pos: { x: -4, y: 6, z: -18 }, radius: 1.1 },
    { id: "btn-b", pos: { x: 4, y: 7.2, z: -25 }, radius: 1.1 },
  ],
  door: { platformId: "door", buttonIds: ["btn-a", "btn-b"] },
  goal: { pos: { x: 0, y: 7.2, z: -43.5 }, radius: 1.8 },
  bounds: { minX: -18, maxX: 18, minZ: -48, maxZ: 10, killY: -4 },
};

export const LEVELS: LevelDef[] = [
  LEVEL_WORKSHOP,
  LEVEL_WORKSHOP_COOP,
  LEVEL_SEWER,
  LEVEL_LIBRARY,
  LEVEL_GARDEN,
];

export function getLevel(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? LEVEL_WORKSHOP;
}

// Satu entri di level select (F3): level baru punya satu definisi
// untuk solo + co-op (spawn2 di definisi yang sama); Bengkel memakai
// dua definisi lama (bengkel solo, workshop-coop co-op).
export interface LevelMeta {
  id: string;
  name: string;
  desc: string;
  /** Jumlah puzzle co-op di level ini. */
  puzzles: number;
  /** Id definisi level solo. */
  soloId: string;
  /** Id definisi level co-op. */
  coopId: string;
}

export const LEVEL_PACK: LevelMeta[] = [
  {
    id: "bengkel",
    name: "Bengkel Penyihir",
    desc: "Tutorial: lompat, ayun lidah, dan portal pertama.",
    puzzles: 2,
    soloId: "bengkel",
    coopId: "workshop-coop",
  },
  {
    id: "selokan",
    name: "Selokan Bercahaya",
    desc: "Selokan gelap: ayunan ganda dan lentera rapuh.",
    puzzles: 3,
    soloId: "selokan",
    coopId: "selokan",
  },
  {
    id: "atap",
    name: "Atap Perpustakaan",
    desc: "Buku raksasa dan buku terbang di atap perpustakaan.",
    puzzles: 3,
    soloId: "atap",
    coopId: "atap",
  },
  {
    id: "taman",
    name: "Taman Jamur",
    desc: "Melenting di jamur lompat dan melayang di atas spora.",
    puzzles: 3,
    soloId: "taman",
    coopId: "taman",
  },
];

export function getLevelMeta(id: string): LevelMeta {
  return LEVEL_PACK.find((m) => m.id === id) ?? LEVEL_PACK[0]!;
}

/** Id pack dari id definisi level (solo atau co-op). */
export function packIdOfDef(defId: string): string {
  return (
    LEVEL_PACK.find((m) => m.soloId === defId || m.coopId === defId)?.id ??
    "bengkel"
  );
}
