// Store room (Pinia): koneksi WebSocket ke PartyServer, daftar pemain,
// cursor lawan, dan pengiriman aksi drag. Satu-satunya tempat yang
// berbicara dengan server; game store hanya menerima state darinya.

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type PartySocket from "partysocket";
import type { ClientMessage, ServerMessage } from "../../../shared/protocol";
import type { PlayerState } from "../../../shared/types";
import { createPartySocket, getPlayerKey } from "../lib/party";
import { useGameStore } from "./game";
import { useChessStore } from "../games/chess/stores/chess";

export type RoomStatus = "idle" | "connecting" | "connected" | "error";

// Pesan chat di room. Disimpan di store (bukan RoomState) supaya
// riwayat tidak ikut tersimpan di server; rejoin mulai dari kosong.
export interface ChatMessage {
  kind: "chat" | "system";
  playerId?: string;
  name?: string;
  color?: string;
  text: string;
  at: number;
}

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
  const messages = ref<ChatMessage[]>([]);
  const hostId = ref<string | null>(null);
  const isHost = computed(
    () => hostId.value !== null && hostId.value === myId.value,
  );
  // Kunci pemain stabil (buat kursi catur + rejoin). Dibuat sekali
  // per browser, disimpan di localStorage.
  const playerKey = getPlayerKey();
  // Jenis room yang sedang tersambung (puzzle/catur). null = belum
  // tersambung. Dipakai UI buat membedakan perilaku per game.
  const roomKind = ref<"puzzle" | "chess" | "naval" | "frog" | null>(null);
  // Grab yang ditolak server (piece direbut pemain lain). BoardCanvas
  // mengawasi ini untuk membatalkan drag.
  const grabDenied = ref<{ pieceId: number; at: number } | null>(null);

  let socket: PartySocket | null = null;
  let mode: "create" | "join" | "create-chess" | "join-chess" = "join";
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
    send({
      type: "join",
      name: myName.value,
      color: myColor.value,
      playerKey,
    });
  }

  function pushMessage(msg: ChatMessage) {
    messages.value.push(msg);
    // Batasi riwayat: 100 pesan terakhir saja.
    if (messages.value.length > 100) {
      messages.value.splice(0, messages.value.length - 100);
    }
  }

  function sendCreate() {
    if (!createConfig) return;
    send({
      type: "create",
      ...createConfig,
      name: myName.value,
      color: myColor.value,
      playerKey,
    });
  }

  function sendCreateChess() {
    send({
      type: "create-chess",
      name: myName.value,
      color: myColor.value,
      playerKey,
    });
  }

  function sendJoinChess() {
    send({
      type: "join-chess",
      name: myName.value,
      color: myColor.value,
      playerKey,
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
        // Berlaku buat puzzle maupun catur.
        if (mode === "create" && !joined && createConfig) {
          mode = "join";
          sendJoin();
          break;
        }
        if (mode === "create-chess" && !joined) {
          mode = "join-chess";
          sendJoinChess();
          break;
        }
        status.value = "error";
        error.value = msg.message;
        break;
      case "state": {
        joined = true;
        status.value = "connected";
        error.value = "";
        players.value = msg.state.players;
        hostId.value = msg.state.hostId;
        roomKind.value = msg.state.kind;
        // Room catur: state diteruskan ke chess store (replay langkah
        // + status game). Jangan panggil game store puzzle.
        if (msg.state.kind === "chess" && msg.state.chess) {
          useChessStore().applyOnlineState(msg.state.chess, playerKey);
          break;
        }
        game.loadRoomState(msg.state, msg.now);
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
      }
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
      case "chat": {
        const sender = players.value.find((p) => p.id === msg.playerId);
        pushMessage({
          kind: "chat",
          playerId: msg.playerId,
          name: msg.name,
          color: sender?.color ?? "#9a9a9a",
          text: msg.text,
          at: msg.at,
        });
        break;
      }
      case "system":
        pushMessage({ kind: "system", text: msg.text, at: Date.now() });
        break;
      default:
        break;
    }
  }

  function connect(
    roomCode: string,
    opts: {
      mode: "create" | "join" | "create-chess" | "join-chess";
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
    try {
      history.replaceState(null, "", `/?room=${code.value}`);
    } catch {
      // Bukan browser: abaikan.
    }
    status.value = "connecting";
    error.value = "";
    joined = false;
    players.value = [];
    messages.value = [];

    const ws = createPartySocket(code.value);
    socket = ws;
    ws.addEventListener("open", () => {
      // Reconnect otomatis (partySocket): kalau sudah pernah join,
      // kirim join lagi; kalau create belum berhasil, coba create lagi.
      // Catur dan puzzle punya pesan join/create sendiri-sendiri.
      if (mode === "create-chess" || mode === "join-chess") {
        if (joined || mode === "join-chess") sendJoinChess();
        else sendCreateChess();
      } else if (joined || mode === "join") {
        sendJoin();
      } else {
        sendCreate();
      }
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
    messages.value = [];
    hostId.value = null;
    error.value = "";
    roomKind.value = null;
    joined = false;
    createConfig = null;
    try {
      history.replaceState(null, "", "/");
    } catch {
      // Bukan browser: abaikan.
    }
  }

  // Keluar dari game (single atau multiplayer): putus room + reset game.
  function leaveGame() {
    disconnect();
    useGameStore().backToLobby();
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

  function sendChat(text: string) {
    if (!text.trim()) return;
    send({ type: "chat", text: text.trim().slice(0, 500) });
  }

  function sendSort() {
    send({ type: "sort" });
  }

  function sendChangeImage(config: {
    imageUrl: string;
    imageName: string;
    imageW: number;
    imageH: number;
    pieceCount: number;
  }) {
    send({ type: "change-image", ...config });
  }

  // Catur online: langkah (UCI), menyerah, rematch. Server
  // memvalidasi dan menyiarkan state penuh sebagai balasan.
  function sendChessMove(uci: string) {
    send({ type: "chess-move", uci });
  }

  function sendChessResign() {
    send({ type: "chess-resign" });
  }

  function sendChessRematch() {
    send({ type: "chess-rematch" });
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
    messages,
    hostId,
    isHost,
    grabDenied,
    playerKey,
    roomKind,
    connect,
    disconnect,
    leaveGame,
    sendCursor,
    sendGrab,
    sendMove,
    sendDrop,
    sendChat,
    sendSort,
    sendChangeImage,
    sendChessMove,
    sendChessResign,
    sendChessRematch,
  };
});
