// Store catur (Pinia): state game catur, seleksi, riwayat, hasil.
// chess.js dipakai untuk aturan; instance Chess disimpan NON-reaktif di
// dalam setup store, lalu state reaktif di-sync setelah setiap perubahan
// (sync()). C1 hanya mode lokal 2 pemain; mode bot ditambah di C2;
// analisa pasca-game + eval bar live ditambah di C3.

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
  type EngineScore,
  type EngineStatus,
} from "../lib/engine";
import { getLevelConfig } from "../lib/levels";
import {
  analyzeGame,
  scoreToCp,
  type AnalysisMode,
  type GameAnalysis,
} from "../lib/analysis";

export type ChessMode = "local" | "bot";
export type ChessPhase = "setup" | "playing" | "over";
export type BotLevel = "easy" | "medium" | "hard" | "extreme";
export type HumanColorChoice = "w" | "b" | "random";
export type AnalysisStatus = "idle" | "loading" | "running" | "done" | "error";

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

  // State analisa + eval bar (C3).
  const analysisStatus = ref<AnalysisStatus>("idle");
  const analysisProgress = ref({ done: 0, total: 0 });
  const analysis = ref<GameAnalysis | null>(null);
  const analysisError = ref<string | null>(null);
  // Mode analisa yang sedang berjalan / terakhir dipakai (round 2:
  // Cepat = depth 16 multipv 1, Thinking = depth 18 multipv 2).
  const analysisMode = ref<AnalysisMode>("fast");
  // Posisi yang di-review (indeks 0 = posisi awal, N = posisi akhir).
  // null = tampilkan posisi live.
  const reviewPly = ref<number | null>(null);
  // Evaluasi live mentah (skor engine + giliran jalan), null = belum
  // ada. Skor mentah disimpan supaya eval bar bisa menampilkan mate
  // sebagai #N, bukan angka cp raksasa. liveEvalCp turunannya.
  const liveEvalScore = ref<{
    score: EngineScore;
    sideToMove: Color;
  } | null>(null);
  const liveEvalCp = computed<number | null>(() =>
    liveEvalScore.value
      ? scoreToCp(
          liveEvalScore.value.score,
          liveEvalScore.value.sideToMove,
          "w",
        )
      : null,
  );
  const evalBarEnabled = ref(false);
  let analysisCancelled = false;
  let liveEvalTimer: ReturnType<typeof setTimeout> | null = null;
  // Nomor urut permintaan eval live: hanya permintaan terbaru yang
  // boleh menulis hasil, supaya eval basi (misal dari posisi lama
  // yang fen-nya kebetulan sama lagi setelah undo) tidak tampil.
  let liveEvalRequestId = 0;

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
    if (phase.value === "playing") scheduleLiveEval();
  }

  // FEN posisi setelah ply ke-N (0 = posisi awal), dihitung dengan
  // replay riwayat. Dipakai review saat belum ada analisa (hasil
  // analisa menyimpan FEN-nya sendiri, tapi replay ini setara).
  function fenAtPly(ply: number): string {
    const game = new Chess();
    const h = historyVerbose.value;
    for (let i = 0; i < Math.min(ply, h.length); i++) {
      const m = h[i]!;
      game.move({ from: m.from, to: m.to, promotion: m.promotion });
    }
    return game.fen();
  }

  // FEN yang ditampilkan di papan: posisi review kalau sedang
  // review, kalau tidak posisi live.
  const displayFen = computed(() => {
    if (reviewPly.value !== null) {
      return (
        analysis.value?.evals[reviewPly.value]?.fen ??
        fenAtPly(reviewPly.value)
      );
    }
    return fen.value;
  });

  // Petak -> bidak, buat render papan. Bergantung pada version dan
  // posisi review.
  const boardMap = computed(() => {
    void version.value;
    const map = new Map<Square, { type: PieceSymbol; color: Color }>();
    const board = new Chess(displayFen.value).board();
    for (const row of board) {
      for (const cell of row) {
        if (cell) map.set(cell.square, { type: cell.type, color: cell.color });
      }
    }
    return map;
  });

  // Petak raja yang sedang skak di posisi tampil (buat highlight merah).
  const checkSquare = computed<Square | null>(() => {
    const game = new Chess(displayFen.value);
    if (!game.isCheck()) return null;
    const side = game.turn();
    for (const [sq, piece] of boardMap.value) {
      if (piece.type === "k" && piece.color === side) return sq;
    }
    return null;
  });

  // Langkah terakhir di posisi tampil (saat review = langkah yang
  // membawa ke posisi itu; posisi awal tidak punya langkah terakhir).
  const displayLastMove = computed<{ from: Square; to: Square } | null>(() => {
    if (reviewPly.value !== null) {
      if (reviewPly.value === 0) return null;
      const m = historyVerbose.value[reviewPly.value - 1];
      return m ? { from: m.from, to: m.to } : null;
    }
    return lastMove.value;
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
    if (reviewPly.value !== null) {
      if (reviewPly.value === 0) return "Review: posisi awal";
      const m = historyVerbose.value[reviewPly.value - 1];
      return m ? `Review: setelah ${m.san}` : "Review";
    }
    if (result.value) return result.value;
    if (phase.value !== "playing") return "";
    return `${COLOR_NAME[turn.value]} jalan${inCheck.value ? " (skak!)" : ""}`;
  });

  // Evaluasi live depth rendah (eval bar). Dijalankan tertunda 500 ms
  // setelah tiap langkah; dilewati kalau engine sedang dipakai bot
  // atau analisa (tidak antre, eval berikutnya menyusul).
  async function refreshLiveEval() {
    if (!evalBarEnabled.value || phase.value !== "playing") return;
    if (
      botThinking.value ||
      analysisStatus.value === "running" ||
      analysisStatus.value === "loading"
    ) {
      return;
    }
    if (stockfish.status !== "ready") return;
    const fenAtStart = fen.value;
    const requestId = ++liveEvalRequestId;
    try {
      const score = await stockfish.evaluate(fenAtStart, 6);
      // Posisi sudah berubah, atau ada permintaan eval lebih baru:
      // hasil ini basi, buang.
      if (
        score &&
        requestId === liveEvalRequestId &&
        fen.value === fenAtStart
      ) {
        liveEvalScore.value = {
          score,
          sideToMove: new Chess(fenAtStart).turn(),
        };
      }
    } catch {
      // Engine sibuk: lewati saja.
    }
  }

  function scheduleLiveEval() {
    if (liveEvalTimer) clearTimeout(liveEvalTimer);
    liveEvalTimer = setTimeout(() => void refreshLiveEval(), 500);
  }

  function resetAnalysis() {
    analysisCancelled = true;
    analysisStatus.value = "idle";
    analysisProgress.value = { done: 0, total: 0 };
    analysis.value = null;
    analysisError.value = null;
    reviewPly.value = null;
  }

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
    resetAnalysis();
    // Eval bar ikut nyala kalau engine sudah siap dari game sebelumnya.
    evalBarEnabled.value = stockfish.status === "ready";
    liveEvalScore.value = null;
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
    resetAnalysis();
    // Mode bot: engine sudah ter-load, eval bar langsung nyala.
    evalBarEnabled.value = true;
    liveEvalScore.value = null;
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
    // Sedang review posisi lama: papan read-only.
    if (reviewPly.value !== null) return;
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
  // Undo membatalkan analisa (game berubah, analisa tidak berlaku lagi).
  function undo() {
    if (phase.value !== "playing" && phase.value !== "over") return;
    if (botThinking.value) return;
    resetAnalysis();
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

  // Analisa pasca-game (C3, round 2: dua mode + progresif). Engine
  // di-load dulu kalau belum siap (di mode lokal biasanya sudah
  // di-prefetch saat game berjalan). Hasil mengalir per langkah
  // lewat onPartial, jadi panel menampilkan klasifikasi begitu
  // tersedia tanpa menunggu semua posisi selesai.
  async function startAnalysis(mode: AnalysisMode = "fast") {
    if (
      analysisStatus.value === "running" ||
      analysisStatus.value === "loading"
    ) {
      return;
    }
    if (historyVerbose.value.length === 0) return;
    analysisMode.value = mode;
    analysisCancelled = false;
    analysisError.value = null;
    analysis.value = null;
    reviewPly.value = null;
    try {
      if (stockfish.status !== "ready") {
        analysisStatus.value = "loading";
        stockfish.onProgress = (p) => {
          engineProgress.value = p;
        };
        stockfish.onStatusChange = (s) => {
          engineStatus.value = s;
        };
        await stockfish.load();
      }
      analysisStatus.value = "running";
      // Susun daftar FEN: posisi awal + setelah tiap langkah.
      const replay = new Chess();
      const fens = [replay.fen()];
      for (const m of historyVerbose.value) {
        replay.move({ from: m.from, to: m.to, promotion: m.promotion });
        fens.push(replay.fen());
      }
      const moves = historyVerbose.value.map((m) => ({
        san: m.san,
        uci: m.from + m.to + (m.promotion ?? ""),
        color: m.color,
      }));
      const result = await analyzeGame(fens, moves, {
        mode,
        onProgress: (done, total) => {
          analysisProgress.value = { done, total };
        },
        onPartial: (partial) => {
          analysis.value = partial;
        },
        isCancelled: () => analysisCancelled,
      });
      if (result) {
        analysis.value = result;
        analysisStatus.value = "done";
      } else {
        // Dibatalkan pengguna.
        analysisStatus.value = "idle";
      }
    } catch (e) {
      analysisError.value =
        e instanceof Error ? e.message : "Analisa gagal.";
      analysisStatus.value = "error";
    }
  }

  function cancelAnalysis() {
    analysisCancelled = true;
    stockfish.stop();
  }

  // Pilih posisi review (indeks 0 = awal, N = akhir). null = live.
  // Review tidak butuh analisa: tanpa analisa, FEN dihitung dengan
  // replay riwayat (fenAtPly). Dengan analisa, batasnya jumlah eval.
  function setReview(ply: number | null) {
    if (ply === null) {
      reviewPly.value = null;
      return;
    }
    const max = analysis.value
      ? analysis.value.evals.length - 1
      : historyVerbose.value.length;
    if (max <= 0) return;
    reviewPly.value = Math.max(0, Math.min(max, ply));
    clearSelection();
  }

  // Toggle review satu langkah (ply 0-based): klik langkah yang
  // sedang di-review = kembali ke live, klik langkah lain = review.
  function toggleReview(ply: number) {
    setReview(reviewPly.value === ply + 1 ? null : ply + 1);
  }

  // Nyalakan/matikan eval bar. Menyalakan di mode lokal butuh load
  // engine dulu (download ~99 MB di load pertama).
  async function toggleEvalBar() {
    if (evalBarEnabled.value) {
      evalBarEnabled.value = false;
      liveEvalScore.value = null;
      return;
    }
    try {
      stockfish.onProgress = (p) => {
        engineProgress.value = p;
      };
      stockfish.onStatusChange = (s) => {
        engineStatus.value = s;
      };
      await stockfish.load();
      evalBarEnabled.value = true;
      void refreshLiveEval();
    } catch (e) {
      engineError.value =
        e instanceof Error ? e.message : "Engine gagal dimuat.";
    }
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
    displayFen,
    displayLastMove,
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
    analysisStatus,
    analysisProgress,
    analysis,
    analysisError,
    analysisMode,
    reviewPly,
    liveEvalScore,
    liveEvalCp,
    evalBarEnabled,
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
    startAnalysis,
    cancelAnalysis,
    setReview,
    toggleReview,
    toggleEvalBar,
  };
});
