// Protokol WebSocket client <-> PartyServer Room.
// Pesan selalu JSON: { type, ...payload }.

import type { ShipId } from "./naval/types";
import type {
  FrogRoomState,
  FrogSnapshot,
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
  | { type: "naval-rematch" }
  // Katak co-op (2 pemain, server authoritative, tick 20 Hz, sim 60 Hz
  // dengan 3 substep per tick). p1 = katak oranye (spawn A), p2 = katak
  // ungu (spawn B). Level dipilih host saat buat room (F3); tamu ikut.
  | {
      type: "create-frog"
      name: string
      color: string
      playerKey: string
      /** Id definisi level co-op (default workshop-coop). */
      levelId?: string
    }
  | {
      type: "join-frog"
      name: string
      color: string
      playerKey: string
    }
  // Input kendali katak (20 Hz). moveX/moveZ = arah gerak di ruang
  // dunia (sudah relatif kamera, dihitung client). jump = tepi naik
  // (server memakai sekali lalu membersihkan). seq = nomor urut client.
  | {
      type: "frog-input"
      moveX: number
      moveZ: number
      jump: boolean
      seq: number
    }
  // Tembak lidah (dikirim segera, tidak menunggu tick input): sinar
  // bidik dari kamera (origin + arah). Server yang menentukan target
  // (anchor / katak pasangan) dan menolak bila tidak kena.
  | {
      type: "frog-fire"
      ox: number
      oy: number
      oz: number
      dx: number
      dy: number
      dz: number
      /** Mode jilat saja (F6.15): lidah ke pasangan tanpa menarik. */
      lick?: boolean
    }
  | { type: "frog-release" }
  | { type: "frog-croak" }
  // Rematch: dua pemain setuju -> match baru, kursi + warna tetap.
  | { type: "frog-rematch" }
  // Level berikutnya (F3): hanya host (p1), dari layar menang. Room
  // pindah ke level berikutnya di pack, match baru langsung mulai.
  | { type: "frog-next-level" };

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
  | { type: "naval-snapshot"; snap: NavalSnapshot }
  // Katak co-op: state room (kursi, status, pemenang) + snapshot sim.
  | { type: "frog-room"; room: FrogRoomState; players: PlayerState[] }
  | { type: "frog-snapshot"; snap: FrogSnapshot };
