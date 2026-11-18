// Protokol WebSocket client <-> PartyServer Room.
// Pesan selalu JSON: { type, ...payload }.

import type { PieceState, PlayerState, RoomState } from "./types";

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
    }
  | { type: "join"; name: string; color: string }
  | { type: "cursor"; x: number; y: number }
  | { type: "grab"; pieceId: number }
  | { type: "move"; pieceId: number; x: number; y: number }
  | { type: "drop"; pieceId: number; x: number; y: number }
  | { type: "chat"; text: string }
  | { type: "sort" };

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
  | { type: "solved"; at: number };
