// Store game (Pinia): state puzzle, timer, progres, menang.
// Satu-satunya tempat yang mengubah posisi piece di M1.

import { defineStore } from "pinia";
import type { PieceState } from "../../../shared/types";
import { cutPuzzle, type CutResult } from "../game/cutter";
import {
  isSolved,
  progressPercent,
  scatterPieces,
  snapTolerance,
  trySnap,
  type BoardLayout,
} from "../game/engine";
import { hashSeed, mulberry32 } from "../game/prng";

export type GameStatus = "lobby" | "playing" | "won";

export interface PresetImage {
  name: string;
  url: string;
}

export const PRESET_IMAGES: PresetImage[] = [
  { name: "Van biru", url: "/images/preset-van.jpg" },
  { name: "Pantai ramai", url: "/images/preset-pantai.jpg" },
  { name: "Kampus tua", url: "/images/preset-kampus.jpg" },
];

export const PIECE_COUNTS = [24, 48, 100, 200] as const;

function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Gambar tidak bisa dimuat: " + url));
    img.src = url;
  });
}

export const useGameStore = defineStore("game", {
  state: () => ({
    status: "lobby" as GameStatus,
    imageUrl: "",
    imageName: "",
    imageW: 0,
    imageH: 0,
    pieceCount: 24,
    seed: 1,
    cut: null as CutResult | null,
    pieces: [] as PieceState[],
    layout: null as BoardLayout | null,
    scattered: false,
    selectedId: null as number | null,
    startedAt: 0,
    elapsedMs: 0,
    timerId: null as ReturnType<typeof setInterval> | null,
  }),
  getters: {
    progress(state): number {
      return progressPercent(state.pieces);
    },
    placed(state): number {
      return state.pieces.filter((p) => p.placed).length;
    },
    totalPieces(state): number {
      return state.pieces.length;
    },
    elapsedSeconds(state): number {
      return Math.floor(state.elapsedMs / 1000);
    },
  },
  actions: {
    async newGame(imageUrl: string, imageName: string, pieceCount: number) {
      this.stopTimer();
      const { w, h } = await loadImageSize(imageUrl);
      // Seed dari nama gambar + jumlah piece + waktu, supaya tiap game
      // baru potongannya beda. Seed yang sama = potongan yang sama.
      this.seed = hashSeed(imageName + pieceCount + Date.now());
      this.imageUrl = imageUrl;
      this.imageName = imageName;
      this.imageW = w;
      this.imageH = h;
      this.pieceCount = pieceCount;
      this.cut = cutPuzzle(w, h, pieceCount, this.seed);
      this.pieces = this.cut.pieces.map((spec) => ({
        id: spec.id,
        x: 0,
        y: 0,
        rotation: 0,
        placed: false,
        lockedBy: null,
        lockedAt: null,
      }));
      this.scattered = false;
      this.selectedId = null;
      this.elapsedMs = 0;
      this.startedAt = Date.now();
      this.status = "playing";
      this.startTimer();
      // Scatter terjadi di applyLayout, saat BoardCanvas sudah tahu
      // ukuran boardnya. Kalau layout sudah ada (game kedua), langsung.
      if (this.layout) this.applyLayout(this.layout);
    },

    applyLayout(layout: BoardLayout) {
      this.layout = layout;
      if (this.status !== "playing" || this.scattered || !this.cut) return;
      const rng = mulberry32(this.seed ^ 0x9e3779b9);
      this.pieces = scatterPieces(this.cut, layout, rng);
      this.scattered = true;
    },

    selectPiece(id: number | null) {
      this.selectedId = id;
    },

    movePiece(id: number, x: number, y: number) {
      const piece = this.pieces.find((p) => p.id === id);
      if (!piece || piece.placed) return;
      piece.x = x;
      piece.y = y;
    },

    dropPiece(id: number) {
      const piece = this.pieces.find((p) => p.id === id);
      const spec = this.cut?.pieces.find((s) => s.id === id);
      if (!piece || !spec || !this.layout || !this.cut) return;
      if (piece.placed) return;
      const snapped = trySnap(
        piece,
        spec,
        this.layout,
        snapTolerance(this.cut, this.layout),
      );
      if (snapped && isSolved(this.pieces)) {
        this.status = "won";
        this.stopTimer();
      }
    },

    backToLobby() {
      this.stopTimer();
      this.status = "lobby";
      this.pieces = [];
      this.cut = null;
      this.scattered = false;
      this.selectedId = null;
    },

    startTimer() {
      this.timerId = setInterval(() => {
        this.elapsedMs = Date.now() - this.startedAt;
      }, 250);
    },

    stopTimer() {
      if (this.timerId !== null) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
      if (this.startedAt > 0) {
        this.elapsedMs = Date.now() - this.startedAt;
      }
    },
  },
});
