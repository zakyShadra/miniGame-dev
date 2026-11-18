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
import {
  stockfish,
  type EngineProgress,
  type EngineStatus,
} from "../lib/engine";
import { getLevelConfig } from "../lib/levels";

export type ChessMode = "local" | "bot";
export type ChessPhase = "setup" | "playing" | "over";
export type BotLevel = "easy" | "medium" | "hard" | "extreme";
export type HumanColorChoice = "w" | "b" | "random";

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

  // State engine (C2): loading, bot berpikir, hint, error.
  const engineStatus = ref<EngineStatus>("idle");
  const engineProgress = ref<EngineProgress | null>(null);
  const engineError = ref<string | null>(null);
  const botThinking = ref(false);
  const hintMove = ref<{ from: Square; to: Square } | null>(null);

  const botColor = computed<Color>(() =>
    humanColor.value === "w" ? "b" : "w",
  );
  const isBotTurn = computed(
    () =>
      mode.value === "bot" &&
      phase.value === "playing" &&
      turn.value === botColor.value,
  );

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
    hintMove.value = null;
    sync();
  }

  // Parse langkah UCI (e2e4, e7e8q) jadi from/to/promotion.
  function parseUci(uci: string): {
    from: Square;
    to: Square;
    promotion?: PieceSymbol;
  } {
    return {
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: (uci[4] as PieceSymbol | undefined) ?? undefined,
    };
  }

  // Minta langkah ke bot lalu jalankan. Dipanggil setelah langkah
  // manusia (mode bot) dan saat bot pegang Putih di awal game.
  async function maybeBotMove() {
    if (!isBotTurn.value || botThinking.value) return;
    botThinking.value = true;
    try {
      const cfg = getLevelConfig(botLevel.value);
      const r = await stockfish.go(fen.value, {
        depth: cfg.depth,
        movetimeMs: cfg.movetimeMs,
        multiPv: cfg.multiPv,
        skill: cfg.skill,
      });
      // Level Mudah kadang sengaja ambil langkah ke-2/ke-3 terbaik.
      let uci = r.bestMove;
      if (
        cfg.randomPickChance > 0 &&
        r.lines.length > 1 &&
        Math.random() < cfg.randomPickChance
      ) {
        const alt =
          r.lines[1 + Math.floor(Math.random() * (r.lines.length - 1))]!;
        if (alt.pv[0]) uci = alt.pv[0];
      }
      const { from, to, promotion } = parseUci(uci);
      chess.move({ from, to, promotion });
      clearSelection();
      sync();
    } catch (e) {
      engineError.value =
        e instanceof Error ? e.message : "Engine gagal berpikir.";
    } finally {
      botThinking.value = false;
    }
  }

  // Mulai game lawan bot. Engine di-load dulu (download .wasm 99 MB
  // di load pertama, lalu dari cache). Melempar error kalau load gagal.
  async function newBotGame(level: BotLevel, colorChoice: HumanColorChoice) {
    botLevel.value = level;
    humanColor.value =
      colorChoice === "random"
        ? Math.random() < 0.5
          ? "w"
          : "b"
        : colorChoice;
    engineError.value = null;
    stockfish.onProgress = (p) => {
      engineProgress.value = p;
    };
    stockfish.onStatusChange = (s) => {
      engineStatus.value = s;
    };
    await stockfish.load();
    chess = new Chess();
    mode.value = "bot";
    orientation.value = humanColor.value;
    phase.value = "playing";
    clearSelection();
    promotionPending.value = null;
    hintMove.value = null;
    sync();
    // Bot pegang Putih: langsung jalan.
    void maybeBotMove();
  }

  // Minta langkah terbaik engine buat posisi saat ini (mode bot saja).
  async function hint() {
    if (
      mode.value !== "bot" ||
      phase.value !== "playing" ||
      isBotTurn.value ||
      botThinking.value
    ) {
      return;
    }
    botThinking.value = true;
    try {
      const r = await stockfish.go(fen.value, {
        depth: 10,
        multiPv: 1,
        skill: 20,
      });
      const { from, to } = parseUci(r.bestMove);
      hintMove.value = { from, to };
    } catch (e) {
      engineError.value =
        e instanceof Error ? e.message : "Hint gagal.";
    } finally {
      botThinking.value = false;
    }
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
    hintMove.value = null;
    sync();
    // Mode bot: giliran bot setelah langkah manusia.
    void maybeBotMove();
  }

  function selectSquare(sq: Square) {
    if (phase.value !== "playing" || result.value) return;
    if (promotionPending.value) return;
    // Giliran bot: input manusia dikunci.
    if (isBotTurn.value || botThinking.value) return;

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

  // Mode lokal: undo satu setengah langkah. Mode bot: undo dua
  // (langkah manusia + balasan bot) supaya giliran kembali ke manusia.
  function undo() {
    if (phase.value !== "playing" && phase.value !== "over") return;
    if (botThinking.value) return;
    const steps = mode.value === "bot" ? 2 : 1;
    for (let i = 0; i < steps; i++) {
      if (!chess.undo()) break;
    }
    clearSelection();
    promotionPending.value = null;
    hintMove.value = null;
    result.value = null;
    if (phase.value === "over") phase.value = "playing";
    sync();
    // Kalau setelah undo jadi giliran bot, bot jalan lagi.
    void maybeBotMove();
  }

  function resign() {
    if (phase.value !== "playing") return;
    if (mode.value === "bot") {
      result.value = "Bot menang (kamu menyerah).";
    } else {
      result.value = `${COLOR_NAME[turn.value === "w" ? "b" : "w"]} menang (${COLOR_NAME[turn.value]} menyerah).`;
    }
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
    engineStatus,
    engineProgress,
    engineError,
    botThinking,
    hintMove,
    botColor,
    isBotTurn,
    newLocalGame,
    newBotGame,
    toSetup,
    selectSquare,
    choosePromotion,
    cancelPromotion,
    doMove,
    undo,
    resign,
    flip,
    hint,
  };
});
