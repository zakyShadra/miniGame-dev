// Koneksi PartyServer: host, kode room, warna cursor.
import PartySocket from "partysocket";

export function getPartyHost(): string {
  return import.meta.env.VITE_PARTY_HOST ?? "localhost:8787";
}

// Origin Worker untuk HTTP biasa (upload gambar): localhost pakai
// http, host lain https.
export function getWorkerOrigin(): string {
  const host = getPartyHost();
  const protocol =
    host.startsWith("localhost") || host.startsWith("127.")
      ? "http"
      : "https";
  return `${protocol}://${host}`;
}

// Alfabet kode room: tanpa I, O, 0, 1 supaya gampang dibaca dan didikte.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (b) => CODE_ALPHABET[b % CODE_ALPHABET.length],
  ).join("");
}

// Warna cursor pemain (dari DESIGN.md).
export const CURSOR_COLORS = [
  "#ff6b5a", // coral
  "#0099e1", // sky
  "#e8b94a", // ochre
  "#22c55e", // green
  "#ff4d8b", // pink
  "#b8a4ed", // lavender
];

export function createPartySocket(code: string): PartySocket {
  return new PartySocket({
    host: getPartyHost(),
    room: code,
    party: "room",
  });
}

// Kunci pemain yang stabil antar reconnect (UUID di localStorage).
// Dipakai server buat menautkan ulang koneksi baru ke kursi yang
// sama (kursi catur Putih/Hitam), karena conn.id PartySocket berubah
// tiap koneksi baru. Kalau localStorage tidak tersedia, pakai UUID
// sekali pakai (rejoin tidak akan menautkan kursi).
const PLAYER_KEY_STORAGE = "minigame:player-key";

export function getPlayerKey(): string {
  try {
    let key = localStorage.getItem(PLAYER_KEY_STORAGE);
    if (!key) {
      key = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY_STORAGE, key);
    }
    return key;
  } catch {
    return crypto.randomUUID();
  }
}
