// Ambil game dari API publik chess.com (tanpa login, tanpa API key).
// Endpoint /pub/player/{username}/games/{yyyy}/{mm} mengembalikan
// daftar game bulan itu beserta PGN lengkap tiap game. API ini
// mengirim CORS Access-Control-Allow-Origin: *, jadi bisa di-fetch
// langsung dari browser (diverifikasi 19 Nov 2026: HTTP 200 +
// access-control-allow-origin *). Tidak perlu proxy Worker.

export interface ChessComGame {
  url: string;
  pgn: string;
  white: string;
  black: string;
  whiteResult: string;
  blackResult: string;
  timeClass: string;
  eco: string;
  // Waktu berakhir game (epoch detik, dari field end_time).
  endTime: number;
  rated: boolean;
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

export async function fetchMonthlyGames(
  username: string,
  year: number,
  month: number,
): Promise<ChessComGame[]> {
  const name = username.trim();
  if (!USERNAME_RE.test(name)) {
    throw new Error("Username chess.com tidak valid (3-25 karakter).");
  }
  const mm = String(month).padStart(2, "0");
  const url = `https://api.chess.com/pub/player/${encodeURIComponent(name)}/games/${year}/${mm}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Gagal terhubung ke chess.com, cek koneksi internet.");
  }
  if (res.status === 404) {
    throw new Error(`Username "${name}" tidak ditemukan di chess.com.`);
  }
  if (!res.ok) {
    throw new Error(`chess.com mengembalikan error (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { games?: unknown[] };
  const games = Array.isArray(data.games) ? data.games : [];
  return games.map((g) => {
    const o = g as Record<string, unknown>;
    const white = (o.white ?? {}) as Record<string, unknown>;
    const black = (o.black ?? {}) as Record<string, unknown>;
    return {
      url: String(o.url ?? ""),
      pgn: String(o.pgn ?? ""),
      white: String(white.username ?? "?"),
      black: String(black.username ?? "?"),
      whiteResult: String(white.result ?? ""),
      blackResult: String(black.result ?? ""),
      timeClass: String(o.time_class ?? ""),
      eco: String(o.eco ?? ""),
      endTime: Number(o.end_time ?? 0),
      rated: o.rated === true,
    };
  });
}

// Label hasil dari sudut pandang pemain yang dicari (username).
// Nilai result chess.com: win, checkmated, agreed, repetition,
// timeout, resigned, stalemate, lose, insufficient, 50move,
// abandoned, timevsinsufficient, dll.
export function resultLabel(game: ChessComGame, username: string): string {
  const lower = username.trim().toLowerCase();
  const mine =
    game.white.toLowerCase() === lower
      ? game.whiteResult
      : game.black.toLowerCase() === lower
        ? game.blackResult
        : "";
  switch (mine) {
    case "win":
      return "Menang";
    case "checkmated":
    case "resigned":
    case "timeout":
    case "lose":
    case "abandoned":
      return "Kalah";
    case "agreed":
    case "stalemate":
    case "repetition":
    case "insufficient":
    case "50move":
    case "timevsinsufficient":
      return "Remis";
    default:
      return mine || "-";
  }
}
