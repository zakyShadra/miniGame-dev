// Protokol WebSocket client <-> PartyServer Room.
// Pesan selalu JSON: { type, ...payload }.

import type { ShipId } from "./naval/types";
import type {
  NavalRoomState,
  NavalSnapshot,
  PieceState,
  PlayerState,
  RoomState,
} from "./types";

export type ClientMessage =
  | {
      type: "create"
      imageUrl: string
      imageName: string
      imageW: number
      imageH: number
      pieceCount: number
      name: string
      color: string
      playerKey?: string
    }
  | { type: "join"; name: string; color: string; playerKey?: string }
  | { type: "cursor"; x: number; y: number }
  | { type: "grab"; pieceId: number }
  | { type: "move"; pieceId: number; x: number; y: number }
  | { type: "drop"; pieceId: number; x: number; y: number }
  | { type: "chat"; text: string }
  | { type: "sort" }
  | {
      type: "change-image"
      imageUrl: string
      imageName: string
      imageW: number
      imageH: number
      pieceCount: number
    }
  // Catur online: room catur dibuat/join terpisah dari room puzzle.
  // playerKey = kunci stabil client (bukan conn.id yang berubah tiap
  // reconnect); kursi Putih/Hitam diikat ke key ini.
  | {
      type: "create-chess"
      name: string
      color: string
      playerKey: string
    }
  | {
      type: "join-chess"
      name: string
      color: string
      playerKey: string
    }
  // Langkah catur notasi UCI (e2e4, e7e8q). Server memvalidasi
  // (giliran + legal) lalu menyiarkan state penuh.
  | { type: "chess-move"; uci: string }
  | { type: "chess-resign" }
  // Rematch: permintaan pertama dicatat (menunggu lawan), permintaan
  // dari warna lawan mengonfirmasi dan memulai game baru (warna
  // ditukar). Tidak ada pesan server khusus: semua update catur
  // sampai lewat pesan "state" penuh.
  | { type: "chess-rematch" }
  // Naval co-op (2 pemain vs bot) atau PvP (1v1). Server authoritative
  // (tick 20 Hz); client hanya mengirim input + aksi, menerima snapshot
  // per tick. Co-op: level 1 = Medium, 2 = Hard, 3 = Extreme (bot + map
  // ikut level, mapId diabaikan server). PvP: level tidak dipakai
  // (kirim 1), mapId dipilih host dan divalidasi ke daftar map.
  | {
      type: "create-naval"
      name: string
      color: string
      playerKey: string
      mode: "coop" | "pvp"
      level: 1 | 2 | 3
      mapId: string
      shipId: ShipId
    }
  | {
      type: "join-naval"
      name: string
      color: string
      playerKey: string
      shipId: ShipId
    }
  // Input kendali kapal (10-20 Hz). seq = nomor urut client, buat
  // debugging (server pakai input terakhir yang diterima).
  | { type: "naval-input"; throttle: number; rudder: number; seq: number }
  | { type: "naval-fire"; aimX: number; aimZ: number }
  | { type: "naval-ability" }
  // Rematch: dua pemain setuju -> match baru, kursi tetap, level sama.
  | { type: "naval-rematch" };

export type ServerMessage =
  | { type: "hello"; id: string }
  | { type: "error"; message: string }
  | { type: "grab-denied"; pieceId: number }
  // now = jam server saat state dikirim; client pakai ini untuk
  // mengoreksi selisih jam (timer tersinkron, M3).
  | { type: "state"; state: RoomState; now: number }
  | { type: "player-joined"; player: PlayerState }
  | { type: "player-left"; playerId: string }
  | { type: "cursor"; playerId: string; x: number; y: number }
  | { type: "piece-moved"; piece: PieceState }
  | { type: "piece-locked"; pieceId: number; playerId: string | null }
  | { type: "chat"; playerId: string; name: string; text: string; at: number }
  | { type: "system"; text: string }
  | { type: "solved"; at: number }
  // Naval co-op: state room (kursi, status, pemenang) + snapshot sim.
  | { type: "naval-room"; room: NavalRoomState; players: PlayerState[] }
  | { type: "naval-snapshot"; snap: NavalSnapshot };
