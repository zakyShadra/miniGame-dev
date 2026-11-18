// Logika game murni (tanpa Vue): scatter, snap, progres, menang.
// Dipakai store (M1) dan nanti dipakai ulang server (M2).

import type { PieceState } from "../../../shared/types";
import type { CutResult, PieceSpec } from "./cutter";

export interface BoardLayout {
  // px board per px gambar.
  scale: number;
  // Pojok kiri atas area target di board.
  targetX: number;
  targetY: number;
  boardW: number;
  boardH: number;
}

export function solvedPosition(
  spec: PieceSpec,
  layout: BoardLayout,
): { x: number; y: number } {
  return {
    x: layout.targetX + spec.x * layout.scale,
    y: layout.targetY + spec.y * layout.scale,
  };
}

// Toleransi snap: 20% dari sisi piece terpendek, dijepit 8-20 px.
export function snapTolerance(cut: CutResult, layout: BoardLayout): number {
  const s = Math.min(cut.pieceW, cut.pieceH) * layout.scale * 0.2;
  return Math.min(20, Math.max(8, s));
}

// Coba snap piece ke posisi benarnya. Kalau jaraknya dalam toleransi,
// piece dikunci di posisi benar dan mengembalikan true.
export function trySnap(
  piece: PieceState,
  spec: PieceSpec,
  layout: BoardLayout,
  tolerance: number,
): boolean {
  const target = solvedPosition(spec, layout);
  const dx = Math.abs(piece.x - target.x);
  const dy = Math.abs(piece.y - target.y);
  if (dx <= tolerance && dy <= tolerance) {
    piece.x = target.x;
    piece.y = target.y;
    piece.placed = true;
    return true;
  }
  return false;
}

export function placedCount(pieces: PieceState[]): number {
  return pieces.filter((p) => p.placed).length;
}

export function progressPercent(pieces: PieceState[]): number {
  if (pieces.length === 0) return 0;
  return Math.round((placedCount(pieces) / pieces.length) * 100);
}

export function isSolved(pieces: PieceState[]): boolean {
  return pieces.length > 0 && pieces.every((p) => p.placed);
}

// Acak posisi awal piece di luar area target. Board dibagi jadi empat
// strip di sekeliling target (kiri, kanan, atas, bawah), tiap strip
// dibuat grid sel seukuran piece. Dijamin selalu ada sel (strip yang
// lebih kecil dari piece tetap dapat 1 sel), jadi tidak ada lagi
// fallback acak-bebas yang menaruh piece di atas target.
export function scatterPieces(
  cut: CutResult,
  layout: BoardLayout,
  rng: () => number,
): PieceState[] {
  const pw = cut.pieceW * layout.scale;
  const ph = cut.pieceH * layout.scale;
  const tx = layout.targetX;
  const ty = layout.targetY;
  const tw = cut.cols * pw;
  const th = cut.rows * ph;
  // Strip kiri/kanan setinggi board, strip atas/bawah selebar target
  // supaya pojok tidak dihitung dua kali.
  const strips = [
    { x: 0, y: 0, w: tx, h: layout.boardH },
    { x: tx + tw, y: 0, w: layout.boardW - (tx + tw), h: layout.boardH },
    { x: tx, y: 0, w: tw, h: ty },
    { x: tx, y: ty + th, w: tw, h: layout.boardH - (ty + th) },
  ];
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  for (const s of strips) {
    if (s.w <= 0 || s.h <= 0) continue;
    const cols = Math.max(1, Math.floor(s.w / pw));
    const rows = Math.max(1, Math.floor(s.h / ph));
    const cw = s.w / cols;
    const ch = s.h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ x: s.x + c * cw, y: s.y + r * ch, w: cw, h: ch });
      }
    }
  }
  // Acak urutan sel (Fisher-Yates).
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = tmp;
  }
  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));
  return cut.pieces.map((spec, i) => {
    if (cells.length === 0) {
      // Board terlalu kecil untuk strip apa pun: posisi acak bebas.
      return {
        id: spec.id,
        x: rng() * Math.max(0, layout.boardW - pw),
        y: rng() * Math.max(0, layout.boardH - ph),
        rotation: 0,
        placed: false,
        lockedBy: null,
        lockedAt: null,
      };
    }
    const cell = cells[i % cells.length]!;
    // Pusatkan piece di sel (sel bisa lebih kecil dari piece), lalu jitter.
    const x = cell.x + (cell.w - pw) / 2 + (rng() - 0.5) * cell.w * 0.2;
    const y = cell.y + (cell.h - ph) / 2 + (rng() - 0.5) * cell.h * 0.2;
    return {
      id: spec.id,
      x: clamp(x, 0, Math.max(0, layout.boardW - pw)),
      y: clamp(y, 0, Math.max(0, layout.boardH - ph)),
      rotation: 0,
      placed: false,
      lockedBy: null,
      lockedAt: null,
    };
  });
}
