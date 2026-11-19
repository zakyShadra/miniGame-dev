// Analisa game catur gaya lichess (C3).
//
// Cara kerja: engine Stockfish full mengevaluasi SEMUA posisi game
// (posisi awal + setelah tiap langkah), lalu dari dua evaluasi
// berurutan didapat cp loss tiap langkah dan diklasifikasi ke 7
// level. Semua skor engine relatif terhadap giliran jalan di posisi
// itu; di sini diubah ke sudut pandang si penggerak (buat cp loss)
// atau Putih (buat grafik eval bar).
//
// Dua mode (keputusan Zaky, round 2):
// - Cepat (default): depth 16, multipv 1. ~3-5x lebih cepat dari
//   Thinking; klasifikasi hampir sama, hanya langkah yang nilainya
//   mepet threshold bisa geser kelas.
// - Thinking: depth 18, multipv 2 (perilaku C3). Paling teliti.
// Kedua mode menampilkan hasil PROGRESIF: tiap langkah yang selesai
// dihitung langsung muncul di panel (tidak menunggu semua beres).
// Cap movetime 5 detik/posisi dipertahankan di kedua mode.
//
// Threshold klasifikasi (centipawn loss, sudut pandang penggerak):
// - Brilliant (!!): langkah terbaik engine + korban materi bersih
//   >= 2 pion (200 cp) + posisi tidak memburuk (loss < 25). Bukan
//   Brilliant kalau hanya ada 1 langkah legal (langkah paksa).
// - Best (bintang): langkah yang sama dengan top move engine.
// - Excellent (!): loss < 25 cp.
// - Good (centang halus): loss < 50 cp.
// - Inaccuracy (?!): loss 50-100 cp.
// - Mistake (?): loss 100-300 cp.
// - Blunder (??): loss >= 300 cp, ATAU dari menang jadi kalah
//   (sebelum >= +200 cp, sesudah <= -200 cp dari sudut penggerak).
//
// Skor mate diubah ke cp supaya bisa dibandingkan: mate dalam N
// langkah = 10000 - 100*N cp (dibatasi minimal 100). Mate harus
// selalu bernilai di atas eval cp biasa (yang bisa tembus 2000+ di
// posisi menang telak); kalau tidak, langkah yang memberi mate bisa
// terlihat "kehilangan" ratusan cp, dan langkah yang membiarkan mate
// bisa terlihat tanpa kerugian. Batas 10000 cukup di atas eval cp
// praktis mana pun, tapi penundaan mate (mate 3 jadi mate 5) tetap
// hanya kehilangan 200 cp (Mistake), bukan ribuan.
//
// Akurasi per pemain memakai metode lichess (bukan rata-rata cp
// loss mentah): tiap evaluasi cp diubah dulu jadi peluang menang
// (Win%) lewat kurva logistik lichess, lalu akurasi langkah dihitung
// dari Win% yang hilang: accuracy = 103.1668 * e^(-0.04354 * win% loss)
// - 3.1669. Versi lama (C3) keliru memasukkan ACPL (centipawn)
// langsung ke rumus ini, padahal rumusnya mengharapkan selisih Win%
// (skala 0-100); akibatnya akurasi bot Stockfish yang bermain
// langkah terbaik pun tampil 9%. Akurasi game = rata-rata dari
// volatility-weighted mean dan harmonic mean akurasi langkah,
// sesuai metode lichess (lichess.org/page/accuracy).
// Langkah yang sama dengan best move engine selalu 0 loss: selisih
// eval apa pun di situ hanya noise engine, bukan kesalahan pemain.

import { Chess, type Color, type PieceSymbol } from "chess.js";
import { stockfish, type EngineScore } from "./engine";
import { PIECE_VALUES } from "./pieces";

export type AnalysisMode = "fast" | "thinking";

// Konfigurasi engine per mode analisa.
export const ANALYSIS_MODES: Record<
  AnalysisMode,
  { depth: number; multiPv: number; label: string; hint: string }
> = {
  fast: {
    depth: 16,
    multiPv: 1,
    label: "Analisa Cepat",
    hint: "Depth 16, hasil mengalir cepat",
  },
  thinking: {
    depth: 18,
    multiPv: 2,
    label: "Thinking",
    hint: "Depth 18 multipv 2, paling teliti",
  },
};
// Batas waktu per posisi (pengaman): depth yang tercapai duluan
// yang menang, tapi posisi rumit tidak boleh menggantung selamanya.
const ANALYSIS_MOVETIME_MS = 5000;

export type Classification =
  | "brilliant"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

// Simbol anotasi standar catur (Zaky 19 Nov 20:00). Warna WAJIB dari
// DESIGN.md, jangan invent warna: brilliant = sky (istimewa),
// best = success, excellent = lavender, good = mint (halus),
// inaccuracy = ochre, mistake = warning, blunder = danger.
export const CLASSIFICATION_META: Record<
  Classification,
  { symbol: string; label: string; color: string }
> = {
  brilliant: { symbol: "!!", label: "Brilliant", color: "#0099e1" },
  best: { symbol: "★", label: "Best", color: "#22c55e" },
  excellent: { symbol: "!", label: "Excellent", color: "#b8a4ed" },
  good: { symbol: "✓", label: "Good", color: "#a4d4c5" },
  inaccuracy: { symbol: "?!", label: "Inaccuracy", color: "#e8b94a" },
  mistake: { symbol: "?", label: "Mistake", color: "#f59e0b" },
  blunder: { symbol: "??", label: "Blunder", color: "#ef4444" },
};

// Penjelasan klasifikasi langkah (Zaky 19 Nov 20:08): alasan kenapa
// langkah ini dapat simbol itu. cpLoss = kerugian centipawn dari
// sudut penggerak (0 untuk Best/Brilliant).
export function classificationExplanation(
  c: Classification,
  cpLoss: number,
): string {
  // Desimal Indonesia pakai koma (1,5 pion).
  const pawns = (cpLoss / 100).toFixed(1).replace(".", ",");
  switch (c) {
    case "brilliant":
      return "Pengorbanan/taktik sulit yang menemukan satu-satunya langkah terbaik, mempertahankan/memenangkan posisi.";
    case "best":
      return "Langkah terbaik di posisi ini menurut engine.";
    case "excellent":
      return "Langkah kuat, hampir sebaik langkah terbaik.";
    case "good":
      return "Langkah solid, mempertahankan posisi.";
    case "inaccuracy":
      return `Sedikit melemahkan posisi (kehilangan ~${pawns} pion).`;
    case "mistake":
      return `Melemahkan posisi secara signifikan (kehilangan ~${pawns} pion).`;
    case "blunder":
      return `Kesalahan besar, kehilangan material/posisi (kehilangan ~${pawns} pion).`;
  }
}

export interface PositionEval {
  fen: string;
  score: EngineScore;
  bestMove: string;
  bestLineSan: string[];
  sideToMove: Color;
}

export interface AnalyzedMove {
  ply: number;
  san: string;
  uci: string;
  color: Color;
  cpLoss: number;
  // Win% (lichess) yang hilang akibat langkah ini + akurasi langkah
  // (0-100) dari rumus lichess. Dipakai buat akurasi game.
  winPercentLoss: number;
  moveAccuracy: number;
  classification: Classification;
  bestMoveSan: string;
  bestLineSan: string[];
  evalBeforeCpWhite: number;
  evalAfterCpWhite: number;
  fenAfter: string;
}

export interface GameAnalysis {
  moves: AnalyzedMove[];
  evals: PositionEval[];
  whiteAccuracy: number;
  blackAccuracy: number;
  counts: Record<Color, Record<Classification, number>>;
}

function mateToCp(mate: number): number {
  const sign = mate > 0 ? 1 : -1;
  return sign * Math.max(100, 10000 - 100 * Math.abs(mate));
}

// Skor engine (relatif terhadap giliran jalan) -> cp dari sudut
// pandang warna tertentu.
export function scoreToCp(
  score: EngineScore,
  sideToMove: Color,
  pov: Color,
): number {
  const cp = score.type === "cp" ? score.value : mateToCp(score.value);
  return sideToMove === pov ? cp : -cp;
}

// Peluang menang Putih (0-100) dari cp, rumus logistik lichess.
export function cpToWinPercent(cpWhite: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cpWhite)) - 1);
}

function materialOf(fen: string, color: Color): number {
  const board = new Chess(fen).board();
  let total = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.color === color) total += PIECE_VALUES[cell.type];
    }
  }
  return total;
}

function legalMoveCount(fen: string): number {
  return new Chess(fen).moves().length;
}

// Ubah PV (langkah UCI) jadi notasi SAN dengan replay di chess.js.
function pvToSan(fen: string, pv: string[]): string[] {
  const game = new Chess(fen);
  const san: string[] = [];
  for (const uci of pv) {
    try {
      const m = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] as PieceSymbol | undefined,
      });
      san.push(m.san);
    } catch {
      break;
    }
  }
  return san;
}

function classify(
  cpLoss: number,
  isBest: boolean,
  sacrificed: boolean,
  onlyMove: boolean,
  cpBeforeMover: number,
  cpAfterMover: number,
): Classification {
  // Langkah terbaik engine tidak mungkin Blunder: kalau evaluasi
  // sebelum/sesudah berayun, itu noise engine di posisi tajam,
  // bukan kesalahan pemain. Jadi best move dicek duluan, sebelum
  // aturan menang-jadi-kalah.
  if (isBest && sacrificed && !onlyMove && cpLoss < 25) return "brilliant";
  if (isBest) return "best";
  const winToLoss = cpBeforeMover >= 200 && cpAfterMover <= -200;
  if (cpLoss >= 300 || winToLoss) return "blunder";
  if (cpLoss < 25) return "excellent";
  if (cpLoss < 50) return "good";
  if (cpLoss < 100) return "inaccuracy";
  if (cpLoss < 300) return "mistake";
  return "blunder";
}

// Akurasi satu langkah dari Win% yang hilang (rumus lichess).
function moveAccuracy(winPercentLoss: number): number {
  const acc = 103.1668 * Math.exp(-0.04354 * winPercentLoss) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

// Akurasi game metode lichess: rata-rata dari volatility-weighted
// mean dan harmonic mean akurasi langkah. Volatility tiap langkah =
// simpangan baku Win% dalam jendela geser (ukuran jendela tumbuh
// dengan panjang game); posisi yang Win%-nya bergejolak (langkah
// kritis) berbobot lebih besar. Harmonic mean memastikan satu
// blunder besar tetap terasa dan tidak tertutup langkah bersih.
// winAfter = Win% si penggerak setelah tiap langkahnya.
function gameAccuracy(
  moves: { acc: number; winAfter: number }[],
): number {
  const n = moves.length;
  if (n === 0) return 100;
  const windowSize = Math.max(2, Math.ceil(n / 5));
  const vols = moves.map((_, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const win = moves.slice(start, i + 1).map((m) => m.winAfter);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const variance =
      win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
    return Math.sqrt(variance);
  });
  const volSum = vols.reduce((a, b) => a + b, 0);
  const weighted =
    volSum > 0
      ? moves.reduce((a, m, i) => a + m.acc * vols[i]!, 0) / volSum
      : moves.reduce((a, m) => a + m.acc, 0) / n;
  const harmonic = moves.some((m) => m.acc <= 0)
    ? 0
    : n / moves.reduce((a, m) => a + 1 / m.acc, 0);
  return Math.max(0, Math.min(100, Math.round((weighted + harmonic) / 2)));
}

function emptyCounts(): Record<Classification, number> {
  return {
    brilliant: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
}

// Klasifikasi satu langkah dari dua evaluasi berurutan. Dipisah jadi
// fungsi supaya bisa dipanggil langsung begitu evaluasi posisi
// berikutnya tiba (hasil progresif), bukan menunggu semua posisi.
function classifyMove(
  move: { san: string; uci: string; color: Color },
  ply: number,
  before: PositionEval,
  after: PositionEval,
): AnalyzedMove {
  const cpBeforeMover = scoreToCp(before.score, before.sideToMove, move.color);
  const cpAfterMover = scoreToCp(after.score, after.sideToMove, move.color);
  const isBest = move.uci === before.bestMove;
  // Langkah terbaik engine = 0 loss. Selisih eval di sini hanya
  // noise antar pencarian di posisi tajam.
  const cpLoss = isBest ? 0 : Math.max(0, cpBeforeMover - cpAfterMover);
  // Win% sebelum langkah = Win% eval posisi (sudah mengasumsikan
  // langkah terbaik); Win% sesudah = Win% posisi hasil langkah.
  const winBefore = cpToWinPercent(cpBeforeMover);
  const winAfter = cpToWinPercent(cpAfterMover);
  const winPercentLoss = isBest ? 0 : Math.max(0, winBefore - winAfter);
  const acc = moveAccuracy(winPercentLoss);
  // Korban materi: materi bersih si penggerak berkurang >= 200 cp
  // akibat langkahnya sendiri (misal korban kuda ambil pion).
  const sacrificed =
    materialOf(after.fen, move.color) - materialOf(before.fen, move.color) <=
    -200;
  const onlyMove = legalMoveCount(before.fen) === 1;
  return {
    ply,
    san: move.san,
    uci: move.uci,
    color: move.color,
    cpLoss,
    winPercentLoss,
    moveAccuracy: acc,
    classification: classify(
      cpLoss,
      isBest,
      sacrificed,
      onlyMove,
      cpBeforeMover,
      cpAfterMover,
    ),
    bestMoveSan: before.bestLineSan[0] ?? "",
    bestLineSan: before.bestLineSan,
    evalBeforeCpWhite: scoreToCp(before.score, before.sideToMove, "w"),
    evalAfterCpWhite: scoreToCp(after.score, after.sideToMove, "w"),
    fenAfter: after.fen,
  };
}

export interface AnalyzeOptions {
  mode: AnalysisMode;
  onProgress: (done: number, total: number) => void;
  // Dipanggil tiap ada langkah baru yang terklasifikasi, dengan
  // snapshot hasil sejauh ini (buat tampil progresif).
  onPartial: (partial: GameAnalysis) => void;
  isCancelled: () => boolean;
}

// Analisa satu game penuh. fens berisi N+1 posisi (awal + setelah
// tiap langkah), moves berisi N langkah. Mengembalikan null kalau
// dibatalkan lewat isCancelled. Setiap selesai mengevaluasi satu
// posisi, langkah sebelumnya langsung diklasifikasi dan snapshot
// parsial dikirim lewat onPartial, jadi UI mengalir per langkah.
export async function analyzeGame(
  fens: string[],
  moves: { san: string; uci: string; color: Color }[],
  opts: AnalyzeOptions,
): Promise<GameAnalysis | null> {
  const { depth, multiPv } = ANALYSIS_MODES[opts.mode];
  const evals: PositionEval[] = [];
  const analyzed: AnalyzedMove[] = [];
  const counts: Record<Color, Record<Classification, number>> = {
    w: emptyCounts(),
    b: emptyCounts(),
  };
  // Akurasi langkah + Win% sesudah langkah, per warna (buat akurasi game).
  const moveAccs: Record<Color, { acc: number; winAfter: number }[]> = {
    w: [],
    b: [],
  };
  const snapshot = (): GameAnalysis => ({
    moves: [...analyzed],
    evals: [...evals],
    whiteAccuracy: gameAccuracy(moveAccs.w),
    blackAccuracy: gameAccuracy(moveAccs.b),
    counts: { w: { ...counts.w }, b: { ...counts.b } },
  });

  for (let i = 0; i < fens.length; i++) {
    if (opts.isCancelled()) return null;
    const fen = fens[i]!;
    let result;
    try {
      result = await stockfish.go(fen, {
        depth,
        multiPv,
        movetimeMs: ANALYSIS_MOVETIME_MS,
        skill: 20,
      });
    } catch {
      // Dibatalkan (stop) atau engine error di tengah jalan.
      if (opts.isCancelled()) return null;
      throw new Error("Engine gagal mengevaluasi posisi.");
    }
    const line = result.lines[0];
    const sideToMove = new Chess(fen).turn();
    evals.push({
      fen,
      score: line?.score ?? { type: "cp", value: 0 },
      bestMove: result.bestMove,
      bestLineSan: pvToSan(fen, line?.pv ?? []),
      sideToMove,
    });
    opts.onProgress(i + 1, fens.length);
    // Evaluasi posisi ke-i melengkapi langkah ke-(i-1): klasifikasi
    // langsung dan kirim snapshot parsial.
    if (i > 0) {
      const move = moves[i - 1]!;
      const analyzedMove = classifyMove(move, i - 1, evals[i - 1]!, evals[i]!);
      analyzed.push(analyzedMove);
      counts[move.color][analyzedMove.classification]++;
      moveAccs[move.color].push({
        acc: analyzedMove.moveAccuracy,
        winAfter: cpToWinPercent(
          scoreToCp(evals[i]!.score, evals[i]!.sideToMove, move.color),
        ),
      });
      opts.onPartial(snapshot());
    }
  }

  return snapshot();
}
