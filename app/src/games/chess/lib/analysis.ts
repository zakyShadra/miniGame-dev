// Analisa game catur gaya lichess (C3).
//
// Cara kerja: engine Stockfish full mengevaluasi SEMUA posisi game
// (posisi awal + setelah tiap langkah) di depth 18, multipv 2. Dari
// dua evaluasi berurutan didapat cp loss tiap langkah, lalu
// diklasifikasi ke 7 level. Semua skor engine relatif terhadap
// giliran jalan di posisi itu; di sini diubah ke sudut pandang
// si penggerak (buat cp loss) atau Putih (buat grafik eval bar).
//
// Threshold klasifikasi (centipawn loss, sudut pandang penggerak):
// - Brilliant (!!): langkah terbaik engine + korban materi bersih
//   >= 2 pion (200 cp) + posisi tidak memburuk (loss < 25). Bukan
//   Brilliant kalau hanya ada 1 langkah legal (langkah paksa).
// - Best (!): langkah yang sama dengan top move engine.
// - Excellent: loss < 25 cp.
// - Good: loss < 50 cp.
// - Inaccuracy (?!): loss 50-100 cp.
// - Mistake (?): loss 100-300 cp.
// - Blunder (??): loss >= 300 cp, ATAU dari menang jadi kalah
//   (sebelum >= +200 cp, sesudah <= -200 cp dari sudut penggerak).
//
// Skor mate diubah ke cp supaya bisa dibandingkan: mate dalam N
// langkah = 1000 - 10*N cp (dibatasi minimal 100). Jadi melewatkan
// mate dalam 1 untuk mate dalam 5 hanya kehilangan ~40 cp (Good),
// tapi melewatkan mate untuk posisi imbang = Blunder.
//
// Akurasi per pemain memakai rumus lichess dari rata-rata cp loss
// (acpl): accuracy = 103.1668 * e^(-0.04354 * acpl) - 3.1669,
// dibatasi 0-100. Satu blunder besar tidak langsung menghancurkan
// akurasi karena rumusnya eksponensial, sama seperti lichess.

import { Chess, type Color, type PieceSymbol } from "chess.js";
import { stockfish, type EngineScore } from "./engine";
import { PIECE_VALUES } from "./pieces";

export const ANALYSIS_DEPTH = 18;
export const ANALYSIS_MULTIPV = 2;
// Batas waktu per posisi (pengaman): depth 18 yang tercapai duluan
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

export const CLASSIFICATION_META: Record<
  Classification,
  { symbol: string; label: string; color: string }
> = {
  brilliant: { symbol: "!!", label: "Brilliant", color: "#0d9488" },
  best: { symbol: "!", label: "Best", color: "#16a34a" },
  excellent: { symbol: "", label: "Excellent", color: "#65a30d" },
  good: { symbol: "", label: "Good", color: "#84cc16" },
  inaccuracy: { symbol: "?!", label: "Inaccuracy", color: "#ca8a04" },
  mistake: { symbol: "?", label: "Mistake", color: "#ea580c" },
  blunder: { symbol: "??", label: "Blunder", color: "#dc2626" },
};

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
  return sign * Math.max(100, 1000 - 10 * Math.abs(mate));
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
  const winToLoss = cpBeforeMover >= 200 && cpAfterMover <= -200;
  if (cpLoss >= 300 || winToLoss) return "blunder";
  if (isBest && sacrificed && !onlyMove && cpLoss < 25) return "brilliant";
  if (isBest) return "best";
  if (cpLoss < 25) return "excellent";
  if (cpLoss < 50) return "good";
  if (cpLoss < 100) return "inaccuracy";
  if (cpLoss < 300) return "mistake";
  return "blunder";
}

function accuracyFromLosses(losses: number[]): number {
  if (losses.length === 0) return 100;
  const acpl = losses.reduce((a, b) => a + b, 0) / losses.length;
  const acc = 103.1668 * Math.exp(-0.04354 * acpl) - 3.1669;
  return Math.max(0, Math.min(100, Math.round(acc)));
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

// Analisa satu game penuh. fens berisi N+1 posisi (awal + setelah
// tiap langkah), moves berisi N langkah. Mengembalikan null kalau
// dibatalkan lewat isCancelled.
export async function analyzeGame(
  fens: string[],
  moves: { san: string; uci: string; color: Color }[],
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<GameAnalysis | null> {
  const evals: PositionEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled()) return null;
    const fen = fens[i]!;
    let result;
    try {
      result = await stockfish.go(fen, {
        depth: ANALYSIS_DEPTH,
        multiPv: ANALYSIS_MULTIPV,
        movetimeMs: ANALYSIS_MOVETIME_MS,
        skill: 20,
      });
    } catch {
      // Dibatalkan (stop) atau engine error di tengah jalan.
      if (isCancelled()) return null;
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
    onProgress(i + 1, fens.length);
  }

  const analyzed: AnalyzedMove[] = [];
  const counts: Record<Color, Record<Classification, number>> = {
    w: emptyCounts(),
    b: emptyCounts(),
  };
  const losses: Record<Color, number[]> = { w: [], b: [] };

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]!;
    const before = evals[i]!;
    const after = evals[i + 1]!;
    const cpBeforeMover = scoreToCp(before.score, before.sideToMove, move.color);
    const cpAfterMover = scoreToCp(after.score, after.sideToMove, move.color);
    const cpLoss = Math.max(0, cpBeforeMover - cpAfterMover);
    const isBest = move.uci === before.bestMove;
    // Korban materi: materi bersih si penggerak berkurang >= 200 cp
    // akibat langkahnya sendiri (misal korban kuda ambil pion).
    const sacrificed =
      materialOf(after.fen, move.color) - materialOf(before.fen, move.color) <=
      -200;
    const onlyMove = legalMoveCount(before.fen) === 1;
    const classification = classify(
      cpLoss,
      isBest,
      sacrificed,
      onlyMove,
      cpBeforeMover,
      cpAfterMover,
    );
    counts[move.color][classification]++;
    losses[move.color].push(cpLoss);
    analyzed.push({
      ply: i,
      san: move.san,
      uci: move.uci,
      color: move.color,
      cpLoss,
      classification,
      bestMoveSan: before.bestLineSan[0] ?? "",
      bestLineSan: before.bestLineSan,
      evalBeforeCpWhite: scoreToCp(before.score, before.sideToMove, "w"),
      evalAfterCpWhite: scoreToCp(after.score, after.sideToMove, "w"),
      fenAfter: after.fen,
    });
  }

  return {
    moves: analyzed,
    evals,
    whiteAccuracy: accuracyFromLosses(losses.w),
    blackAccuracy: accuracyFromLosses(losses.b),
    counts,
  };
}
