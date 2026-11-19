// Tipe state room. Dipakai app/ (Vue) dan party/ (Worker) lewat import relatif.
// JANGAN tambah dependency di sini: file ini harus tetap murni TypeScript.

import type { ShipId, SimEvent } from "./naval/types";

export interface PieceState {
  id: number
  x: number
  y: number
  rotation: number
  placed: boolean
  lockedBy: string | null
  lockedAt: number | null
  // Id grup (M5): piece dengan groupId sama bergerak bersama. null =
  // belum bergabung. Data lama di SQLite belum punya field ini
  // (undefined), diperlakukan sama seperti null.
  groupId: string | null
}

export interface PlayerState {
  id: string
  name: string
  color: string
  cursor: { x: number; y: number } | null
  connected: boolean
  lastSeen: number
  // Kunci pemain yang stabil antar reconnect (UUID di localStorage
  // client). Server memakai ini buat menautkan ulang koneksi baru ke
  // kursi yang sama (kursi catur Putih/Hitam), karena conn.id berubah
  // tiap reconnect. Pemain lama (sebelum field ini) tidak punya key.
  key?: string
}

// State game catur online di satu room. Server memegang daftar
// langkah (UCI) secara authoritative; client me-replay daftar ini
// buat membangun posisi. Kursi diikat ke playerKey (bukan conn.id)
// supaya refresh/reconnect tidak kehilangan warna.
export interface ChessRoomState {
  whiteKey: string | null
  blackKey: string | null
  whiteName: string
  blackName: string
  // Langkah dalam notasi UCI (e2e4, e7e8q). Posisi = replay dari awal.
  moves: string[]
  status: "waiting" | "playing" | "over"
  endKind:
    | "checkmate"
    | "stalemate"
    | "repetition"
    | "insufficient"
    | "fifty"
    | "resign"
    | null
  winner: "w" | "b" | null
  // Warna yang sudah minta rematch (menunggu lawan menyetujui).
  rematchPendingBy: "w" | "b" | null
  // Naik tiap rematch; client pakai ini buat deteksi game baru.
  gameNumber: number
}

export interface RoomState {
  code: string
  // Jenis room: puzzle (jigsaw), catur, atau naval co-op. Room lama di
  // SQLite belum punya field ini, dinormalisasi jadi "puzzle" saat load.
  kind: "puzzle" | "chess" | "naval"
  // State catur; null di room puzzle/naval.
  chess: ChessRoomState | null
  // State naval co-op; null di room puzzle/catur.
  naval: NavalRoomState | null
  imageUrl: string
  imageName: string
  imageW: number
  imageH: number
  pieceCount: number
  seed: number
  pieces: PieceState[]
  players: PlayerState[]
  hostId: string | null
  startedAt: number
  solvedAt: number | null
}

// State room naval (co-op 2 pemain vs bot, atau PvP 1v1). Kursi
// diikat ke playerKey (stabil antar reconnect), sama seperti kursi
// catur. Co-op: level = difficulty bot + map (1 = Medium/Teluk,
// 2 = Hard/Kepulauan, 3 = Extreme/Labirin). PvP: level selalu 1
// (tidak dipakai), mapId dipilih host. Pemenang PvP = shipKey
// ("p1"/"p2") kapal yang selamat / HP tertinggi saat waktu habis.
export interface NavalRoomState {
  mode: "coop" | "pvp"
  level: 1 | 2 | 3
  mapId: string
  status: "waiting" | "playing" | "paused" | "over"
  seats: Array<{
    key: string
    name: string
    shipId: ShipId
    shipKey: "p1" | "p2"
  }>
  winner: "players" | "bot" | "draw" | "p1" | "p2" | null
  // playerKey yang sudah minta rematch (menunggu pemain lain).
  rematchPendingBy: string | null
  // Naik tiap rematch; client pakai ini buat deteksi game baru.
  gameNumber: number
}

// Satu kapal dalam snapshot (subset ShipState yang perlu dirender).
export interface NavalShipSnap {
  id: string
  defId: ShipId
  x: number
  z: number
  heading: number
  speed: number
  hp: number
  maxHp: number
  alive: boolean
  sinking: boolean
  sinkTime: number
  heel: number
  turn: number
  lastFireAt: number
  abilityReadyAt: number
}

// Snapshot sim per tick (20 Hz). winnerId = id kapal pemenang dari sim
// selama match jalan; begitu match selesai server menggantinya dengan
// hasil tim ("players" | "bot" | "draw") atau shipKey pemenang PvP
// ("p1" | "p2"). Kapal lawan (bot di co-op, pemain lain di PvP)
// dihilangkan dari ships bila tidak ada garis pandang dari kapal
// pemain penerima (kecuali sedang tenggelam/mati).
export interface NavalSnapshot {
  /** Waktu game (detik) sejak match mulai. */
  t: number
  timeLeft: number
  winnerId: string | null
  ships: NavalShipSnap[]
  shells: Array<{ x: number; y: number; z: number }>
  events: SimEvent[]
  /** Kapal lawan terlihat dari kapal penerima (LoS jelas). */
  foeVisible: boolean
}
