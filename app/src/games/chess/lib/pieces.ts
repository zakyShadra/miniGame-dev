// Bidak catur: set SVG cburnett (CC BY-SA, dari lichess lila) yang
// dibundel lokal di public/pieces/. Nama file: <warna><bidak>.svg,
// misal wN.svg = kuda putih, bQ.svg = menteri hitam.

import type { Color, PieceSymbol } from "chess.js";

export function pieceUrl(color: Color, type: PieceSymbol): string {
  return `/pieces/${color}${type.toUpperCase()}.svg`;
}

export const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "Pion",
  n: "Kuda",
  b: "Gajah",
  r: "Benteng",
  q: "Menteri",
  k: "Raja",
};

export const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

// Urutan file (a-h) dan rank (1-8) untuk render papan.
export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

// a1 itu petak gelap: petak terang kalau (indeks file + rank) genap.
export function isLightSquare(fileIndex: number, rank: number): boolean {
  return (fileIndex + rank) % 2 === 0;
}
