// Store catur (Pinia): state game catur, seleksi, riwayat, hasil.
// chess.js dipakai untuk aturan; instance Chess disimpan NON-reaktif di
// dalam setup store, lalu state reaktif di-sync setelah setiap perubahan
// (sync()). C1 hanya mode lokal 2 pemain; mode bot ditambah di C2.

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  Chess,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from "chess.js";
import { PIECE_VALUES } from "../lib/pieces";

export type ChessMode = "local" | "bot";
export type ChessPhase = "setup" | "playing" | "over";
export type BotLevel = "easy" | "medium" | "hard" | "extreme";

export interface MovePair {
  n: number;
  white: Move;
  black?: Move;
}

const COLOR_NAME: Record<Color, string> = { w: "Putih", b: "Hitam" };

export const useChessStore = defineStore("chess", () => {
  // Instance aturan, sengaja non-reaktif (Vue proxy bisa merusak
  // internal chess.js dan memperlambat generate langkah).
  let chess = new Chess();

  const phase = ref<ChessPhase>("setup");
  const mode = ref<ChessMode>("local");
  const botLevel = ref<BotLevel>("medium");
  // Warna manusia di mode bot (C2). Di mode lokal tidak dipakai.
  const humanColor = ref<Color>("w");
  const orientation = ref<Color>("w");

  const selected = ref<Square | null>(null);
  const targets = ref<Move[]>([]);
  const promotionPending = ref<{ from: Square; to: Square } | null>(null);

  // Cermin reaktif dari instance chess, diisi sync().
  const fen = ref(chess.fen());
  const historyVerbose = ref<Move[]>([]);
  const turn = ref<Color>("w");
  const inCheck = ref(false);
  const result = ref<string | null>(null);
  const lastMove = ref<{ from: Square; to: Square } | null>(null);
  // Dipakai computed boardMap sebagai pemicu re-render.
  const version = ref(0);

  function computeResult(): string | null {
    if (chess.isCheckmate()) {
      // Giliran jalan yang kena skakmat, jadi lawannya menang.
      return `Skakmat! ${COLOR_NAME[turn.value === "w" ? "b" : "w"]} menang.`;
    }
    if (chess.isStalemate()) return "Remis (stalemate).";
    if (chess.isThreefoldRepetition()) return "Remis (pengulangan 3x).";
    if (chess.isInsufficientMaterial()) return "Remis (materi tidak cukup).";
    if (chess.isDrawByFiftyMoves()) return "Remis (aturan 50 langkah).";
    if (chess.isDraw()) return "Remis.";
    return null;
  }

  function sync() {
    fen.value = chess.fen();
    historyVerbose.value = chess.history({ verbose: true });
    turn.value = chess.turn();
    inCheck.value = chess.isCheck();
    const last = historyVerbose.value[historyVerbose.value.length - 1];
    lastMove.value = last ? { from: last.from, to: last.to } : null;
    result.value = computeResult();
    if (result.value) phase.value = "over";
    version.value++;
  }

  // Petak -> bidak, buat render papan. Bergantung pada version.
  const boardMap = computed(() => {
    void version.value;
    const map = new Map<Square, { type: PieceSymbol; color: Color }>();
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell) map.set(cell.square, { type: cell.type, color: cell.color });
      }
    }
    return map;
  });

  // Petak raja yang sedang skak (buat highlight merah).
  const checkSquare = computed<Square | null>(() => {
    if (!inCheck.value) return null;
    for (const [sq, piece] of boardMap.value) {
      if (piece.type === "k" && piece.color === turn.value) return sq;
    }
    return null;
  });

  const moveList = computed<MovePair[]>(() => {
    const pairs: MovePair[] = [];
    const h = historyVerbose.value;
    for (let i = 0; i < h.length; i += 2) {
      const white = h[i]!;
      pairs.push({ n: i / 2 + 1, white, black: h[i + 1] });
    }
    return pairs;
  });

  // Bidak yang ditangkap tiap pihak + selisih materi (positif = Putih unggul).
  const captured = computed(() => {
    const byWhite: PieceSymbol[] = [];
    const byBlack: PieceSymbol[] = [];
    for (const m of historyVerbose.value) {
      if (!m.captured) continue;
      if (m.color === "w") byWhite.push(m.captured);
      else byBlack.push(m.captured);
    }
    const score = (list: PieceSymbol[]) =>
      list.reduce((s, p) => s + PIECE_VALUES[p], 0);
    return {
      byWhite,
      byBlack,
      materialDiff: score(byWhite) - score(byBlack),
    };
  });

  const statusText = computed(() => {
    if (result.value) return result.value;
    if (phase.value !== "playing") return "";
    return `${COLOR_NAME[turn.value]} jalan${inCheck.value ? " (skak!)" : ""}`;
  });

  function clearSelection() {
    selected.value = null;
    targets.value = [];
  }

  function newLocalGame() {
    chess = new Chess();
    mode.value = "local";
    orientation.value = "w";
    phase.value = "playing";
    clearSelection();
    promotionPending.value = null;
    sync();
  }

  function toSetup() {
    phase.value = "setup";
    clearSelection();
    promotionPending.value = null;
    result.value = null;
  }

  function doMove(from: Square, to: Square, promotion?: PieceSymbol) {
    try {
      chess.move({ from, to, promotion });
    } catch {
      // Langkah dari daftar legal tidak mungkin ilegal; abaikan saja.
      return;
    }
    clearSelection();
    promotionPending.value = null;
    sync();
  }

  function selectSquare(sq: Square) {
    if (phase.value !== "playing" || result.value) return;
    if (promotionPending.value) return;

    // Klik target legal dari bidak terpilih = jalan.
    if (selected.value) {
      const options = targets.value.filter((m) => m.to === sq);
      if (options.length > 0) {
        if (options.some((m) => m.promotion)) {
          promotionPending.value = { from: selected.value, to: sq };
        } else {
          doMove(selected.value, sq);
        }
        return;
      }
    }

    // Klik bidak sendiri = pilih + tampilkan langkah legal.
    const piece = chess.get(sq);
    if (piece && piece.color === turn.value) {
      selected.value = sq;
      targets.value = chess.moves({ square: sq, verbose: true });
      return;
    }

    clearSelection();
  }

  function choosePromotion(piece: PieceSymbol) {
    const pending = promotionPending.value;
    if (!pending) return;
    doMove(pending.from, pending.to, piece);
  }

  function cancelPromotion() {
    promotionPending.value = null;
  }

  // Mode lokal: undo satu setengah langkah. Mode bot (C2): undo dua
  // (langkah manusia + balasan bot) supaya giliran kembali ke manusia.
  function undo() {
    if (phase.value !== "playing" && phase.value !== "over") return;
    const steps = mode.value === "bot" ? 2 : 1;
    for (let i = 0; i < steps; i++) {
      if (!chess.undo()) break;
    }
    clearSelection();
    promotionPending.value = null;
    result.value = null;
    if (phase.value === "over") phase.value = "playing";
    sync();
  }

  function resign() {
    if (phase.value !== "playing") return;
    result.value = `${COLOR_NAME[turn.value === "w" ? "b" : "w"]} menang (${COLOR_NAME[turn.value]} menyerah).`;
    phase.value = "over";
    clearSelection();
  }

  function flip() {
    orientation.value = orientation.value === "w" ? "b" : "w";
  }

  return {
    phase,
    mode,
    botLevel,
    humanColor,
    orientation,
    selected,
    targets,
    promotionPending,
    fen,
    historyVerbose,
    turn,
    inCheck,
    result,
    lastMove,
    boardMap,
    checkSquare,
    moveList,
    captured,
    statusText,
    newLocalGame,
    toSetup,
    selectSquare,
    choosePromotion,
    cancelPromotion,
    doMove,
    undo,
    resign,
    flip,
  };
});
