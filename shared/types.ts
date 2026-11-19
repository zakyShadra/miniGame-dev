// Tipe state room. Dipakai app/ (Vue) dan party/ (Worker) lewat import relatif.
// JANGAN tambah dependency di sini: file ini harus tetap murni TypeScript.

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
  // Jenis room: puzzle (jigsaw) atau catur. Room lama di SQLite
  // belum punya field ini, dinormalisasi jadi "puzzle" saat load.
  kind: "puzzle" | "chess"
  // State catur; null di room puzzle.
  chess: ChessRoomState | null
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
