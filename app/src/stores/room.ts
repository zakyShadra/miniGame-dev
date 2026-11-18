// Store room (Pinia): koneksi WebSocket ke PartyServer, daftar pemain,
// cursor lawan, dan pengiriman aksi drag. Satu-satunya tempat yang
// berbicara dengan server; game store hanya menerima state darinya.

import { ref } from "vue";
import { defineStore } from "pinia";
import type PartySocket from "partysocket";
import type { ClientMessage, ServerMessage } from "../../../shared/protocol";
import type { PlayerState } from "../../../shared/types";
import { createPartySocket } from "../lib/party";
import { useGameStore } from "./game";

export type RoomStatus = "idle" | "connecting" | "connected" | "error";

export interface LastRoom {
  code: string;
  name: string;
  color: string;
}

const LAST_ROOM_KEY = "puzzlegame:last-room";

function loadLastRoom(): LastRoom | null {
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    return raw ? (JSON.parse(raw) as LastRoom) : null;
  } catch {
    return null;
  }
}

export const useRoomStore = defineStore("room", () => {
  const status = ref<RoomStatus>("idle");
  const code = ref("");
  const myId = ref("");
  const myName = ref("");
  const myColor = ref("");
  const players = ref<PlayerState[]>([]);
  const error = ref("");
  const lastRoom = ref<LastRoom | null>(loadLastRoom());
  // Grab yang ditolak server (piece direbut pemain lain). BoardCanvas
  // mengawasi ini untuk membatalkan drag.
  const grabDenied = ref<{ pieceId: number; at: number } | null>(null);

  let socket: PartySocket | null = null;
  let mode: "create" | "join" = "join";
  let joined = false;
  let createConfig: {
    imageUrl: string;
    imageName: string;
    imageW: number;
    imageH: number;
    pieceCount: number;
  } | null = null;
  let lastCursorSent = 0;
  let lastMoveSent = 0;

  function send(msg: ClientMessage) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  function sendJoin() {
    send({ type: "join", name: myName.value, color: myColor.value });
  }

  function sendCreate() {
    if (!createConfig) return;
    send({
      type: "create",
      ...createConfig,
      name: myName.value,
      color: myColor.value,
    });
  }

  function handleMessage(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    const game = useGameStore();
    switch (msg.type) {
      case "hello":
        myId.value = msg.id;
        break;
      case "error":
        // Tabrakan kode saat create (room sudah ada): coba join saja.
        if (mode === "create" && !joined && createConfig) {
          mode = "join";
          sendJoin();
          break;
        }
        status.value = "error";
        error.value = msg.message;
        break;
      case "state":
        joined = true;
        status.value = "connected";
        error.value = "";
        players.value = msg.state.players;
        game.loadRoomState(msg.state);
        lastRoom.value = {
          code: code.value,
          name: myName.value,
          color: myColor.value,
        };
        try {
          localStorage.setItem(LAST_ROOM_KEY, JSON.stringify(lastRoom.value));
        } catch {
          // localStorage penuh/nonaktif: abaikan, bukan fatal.
        }
        break;
      case "player-joined": {
        const i = players.value.findIndex((p) => p.id === msg.player.id);
        if (i === -1) players.value.push(msg.player);
        else players.value[i] = msg.player;
        break;
      }
      case "player-left":
        players.value = players.value.filter((p) => p.id !== msg.playerId);
        break;
      case "cursor": {
        const p = players.value.find((pl) => pl.id === msg.playerId);
        if (p) p.cursor = { x: msg.x, y: msg.y };
        break;
      }
      case "piece-moved":
        game.applyRemotePiece(msg.piece);
        break;
      case "piece-locked":
        game.applyRemoteLock(msg.pieceId, msg.playerId);
        break;
      case "grab-denied":
        grabDenied.value = { pieceId: msg.pieceId, at: Date.now() };
        break;
      case "solved":
        game.markSolved(msg.at);
        break;
      default:
        break; // chat/system: M3
    }
  }

  function connect(
    roomCode: string,
    opts: {
      mode: "create" | "join";
      name: string;
      color: string;
      createConfig?: {
        imageUrl: string;
        imageName: string;
        imageW: number;
        imageH: number;
        pieceCount: number;
      };
    },
  ) {
    disconnect();
    mode = opts.mode;
    createConfig = opts.createConfig ?? null;
    code.value = roomCode.toUpperCase();
    myName.value = opts.name;
    myColor.value = opts.color;
    status.value = "connecting";
    error.value = "";
    joined = false;
    players.value = [];

    const ws = createPartySocket(code.value);
    socket = ws;
    ws.addEventListener("open", () => {
      // Reconnect otomatis (partySocket): kalau sudah pernah join,
      // kirim join lagi; kalau create belum berhasil, coba create lagi.
      if (joined || mode === "join") sendJoin();
      else sendCreate();
    });
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") handleMessage(ev.data);
    });
    ws.addEventListener("close", () => {
      if (status.value === "connected") status.value = "connecting";
    });
    ws.addEventListener("error", () => {
      if (!joined) {
        status.value = "error";
        error.value = "Tidak bisa terhubung ke server room.";
      }
    });
  }

  function disconnect() {
    if (socket) {
      socket.close();
      socket = null;
    }
    status.value = "idle";
    code.value = "";
    myId.value = "";
    players.value = [];
    error.value = "";
    joined = false;
    createConfig = null;
  }

  // Cursor: kirim maks ~30/detik.
  function sendCursor(x: number, y: number) {
    const now = Date.now();
    if (now - lastCursorSent < 33) return;
    lastCursorSent = now;
    send({ type: "cursor", x, y });
  }

  function sendGrab(pieceId: number) {
    send({ type: "grab", pieceId });
  }

  // Drag: kirim maks ~30/detik.
  function sendMove(pieceId: number, x: number, y: number) {
    const now = Date.now();
    if (now - lastMoveSent < 33) return;
    lastMoveSent = now;
    send({ type: "move", pieceId, x, y });
  }

  function sendDrop(pieceId: number, x: number, y: number) {
    send({ type: "drop", pieceId, x, y });
  }

  return {
    status,
    code,
    myId,
    myName,
    myColor,
    players,
    error,
    lastRoom,
    grabDenied,
    connect,
    disconnect,
    sendCursor,
    sendGrab,
    sendMove,
    sendDrop,
  };
});
