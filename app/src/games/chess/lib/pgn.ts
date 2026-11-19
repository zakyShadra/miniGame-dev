// Parse PGN (format chess.com / standar) jadi game chess.js.
// Dipakai fitur import: user menempel PGN dari chess.com (Share >
// salin PGN) lalu gamenya bisa dianalisa seperti game biasa.
// Semua error dilempar sebagai Error dengan pesan Bahasa Indonesia.

import { Chess } from "chess.js";

export interface ImportedGameMeta {
  white: string;
  black: string;
  result: string;
  event: string;
  date: string;
}

export interface ParsedPgn {
  game: Chess;
  meta: ImportedGameMeta;
  // PGN berisi lebih dari satu game: hanya game pertama yang dipakai.
  multipleGames: boolean;
}

// Pisah PGN multi-game: game dipisahkan baris kosong sebelum tag
// [Event. PGN tanpa tag Event (movetext saja) = satu game.
function splitGames(text: string): string[] {
  const parts = text.split(/\n\s*\n(?=\[Event\s)/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export function parsePgn(text: string): ParsedPgn {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("PGN kosong. Tempel PGN dari chess.com dulu.");
  }
  const games = splitGames(trimmed);
  const first = games[0]!;
  const game = new Chess();
  try {
    game.loadPgn(first);
  } catch (e) {
    // Pesan chess.js sudah spesifik ("Invalid move in PGN: ..."),
    // teruskan supaya user tahu bagian mana yang rusak.
    const detail = e instanceof Error ? e.message : "format tidak dikenal";
    throw new Error(`PGN tidak valid (${detail}).`);
  }
  if (game.history().length === 0) {
    throw new Error("PGN tidak berisi langkah catur.");
  }
  const h = game.header();
  return {
    game,
    meta: {
      white: h.White ?? "?",
      black: h.Black ?? "?",
      result: h.Result ?? "*",
      event: h.Event ?? "",
      date: h.Date ?? "",
    },
    multipleGames: games.length > 1,
  };
}
