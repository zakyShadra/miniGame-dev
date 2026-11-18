// Store game (Pinia): state puzzle, timer, progres, menang.
// Satu-satunya tempat yang mengubah posisi piece di M1.

import { defineStore } from "pinia";
import type { PieceState, RoomState } from "../../../shared/types";
import { cutPuzzle, type CutResult } from "../../../shared/game/cutter";
import {
  isSolved,
  progressPercent,
  scatterPieces,
  snapTolerance,
  trySnap,
  type BoardLayout,
} from "../../../shared/game/engine";
import { hashSeed, mulberry32 } from "../../../shared/game/prng";

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
    // Pilihan di lobby (dipakai single-player dan create room).
    selectedImage: PRESET_IMAGES[0]! as PresetImage,
    selectedCount: 24,
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
    // Selisih jam server - jam lokal (ms), dari pesan state (M3).
    // 0 di single-player; dipakai supaya timer tersinkron antar pemain.
    clockOffset: 0,
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
      this.clockOffset = 0;
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

    // Multiplayer (M2): muat state room dari server. Cut dihitung lokal
    // dari seed (deterministik, sama persis dengan server); posisi piece
    // pakai data server apa adanya, jangan di-scatter ulang.
    // serverNow = jam server saat state dikirim, dipakai mengoreksi
    // selisih jam supaya timer sama di semua pemain (M3).
    loadRoomState(state: RoomState, serverNow?: number) {
      this.stopTimer();
      this.imageUrl = state.imageUrl;
      this.imageName = state.imageName;
      this.imageW = state.imageW;
      this.imageH = state.imageH;
      this.pieceCount = state.pieceCount;
      this.seed = state.seed;
      this.cut = cutPuzzle(
        state.imageW,
        state.imageH,
        state.pieceCount,
        state.seed,
      );
      this.pieces = state.pieces.map((p) => ({ ...p }));
      this.scattered = true;
      this.selectedId = null;
      this.startedAt = state.startedAt;
      if (serverNow !== undefined) {
        this.clockOffset = serverNow - Date.now();
      }
      this.elapsedMs = state.solvedAt
        ? state.solvedAt - state.startedAt
        : this.nowCorrected() - state.startedAt;
      this.status = state.solvedAt ? "won" : "playing";
      if (!state.solvedAt) this.startTimer();
    },

    // Jam lokal yang sudah dikoreksi selisih jam server.
    nowCorrected(): number {
      return Date.now() + this.clockOffset;
    },

    // Rapikan (single-player): acak ulang posisi piece yang belum
    // terpasang. Di multiplayer server yang melakukan ini (pesan sort).
    sortPieces() {
      if (!this.cut || !this.layout || this.status !== "playing") return;
      const rng = mulberry32((Date.now() ^ (Math.random() * 0x7fffffff)) | 0);
      const fresh = scatterPieces(this.cut, this.layout, rng);
      const freshById = new Map(fresh.map((p) => [p.id, p]));
      for (const piece of this.pieces) {
        if (piece.placed) continue;
        const pos = freshById.get(piece.id);
        if (pos) {
          piece.x = pos.x;
          piece.y = pos.y;
        }
      }
    },

    // Terapkan posisi/status piece dari server (broadcast pemain lain
    // atau posisi akhir drop yang sudah di-snap server).
    applyRemotePiece(piece: PieceState) {
      const local = this.pieces.find((p) => p.id === piece.id);
      if (!local) return;
      local.x = piece.x;
      local.y = piece.y;
      local.placed = piece.placed;
      local.lockedBy = piece.lockedBy;
      local.lockedAt = piece.lockedAt;
    },

    applyRemoteLock(pieceId: number, playerId: string | null) {
      const local = this.pieces.find((p) => p.id === pieceId);
      if (!local) return;
      local.lockedBy = playerId;
      local.lockedAt = playerId ? Date.now() : null;
    },

    markSolved(at: number) {
      this.status = "won";
      this.stopTimer();
      if (this.startedAt > 0) this.elapsedMs = at - this.startedAt;
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
        this.elapsedMs = this.nowCorrected() - this.startedAt;
      }, 250);
    },

    stopTimer() {
      if (this.timerId !== null) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
      if (this.startedAt > 0) {
        this.elapsedMs = this.nowCorrected() - this.startedAt;
      }
    },
  },
});
