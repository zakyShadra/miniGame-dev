// Protokol WebSocket client <-> PartyServer Room.
// Pesan selalu JSON: { type, ...payload }.

import type { PieceState, PlayerState, RoomState } from "./types";

export type ClientMessage =
  | { type: "join"; name: string; color: string }
  | { type: "cursor"; x: number; y: number }
  | { type: "grab"; pieceId: number }
  | { type: "move"; pieceId: number; x: number; y: number }
  | { type: "drop"; pieceId: number; x: number; y: number }
  | { type: "chat"; text: string };

export type ServerMessage =
  | { type: "hello"; id: string }
  | { type: "state"; state: RoomState }
  | { type: "player-joined"; player: PlayerState }
  | { type: "player-left"; playerId: string }
  | { type: "cursor"; playerId: string; x: number; y: number }
  | { type: "piece-moved"; piece: PieceState }
  | { type: "piece-locked"; pieceId: number; playerId: string | null }
  | { type: "chat"; playerId: string; name: string; text: string; at: number }
  | { type: "system"; text: string }
  | { type: "solved"; at: number };
