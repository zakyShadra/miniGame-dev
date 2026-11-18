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
}

export interface PlayerState {
  id: string
  name: string
  color: string
  cursor: { x: number; y: number } | null
  connected: boolean
  lastSeen: number
}

export interface RoomState {
  code: string
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
