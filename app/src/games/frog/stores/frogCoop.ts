// Store katak co-op (Pinia): koneksi WebSocket ke PartyServer, state
// room co-op (2 pemain, oranye + hijau), dan instance FrogRemoteGame
// yang disimpan NON-reaktif. HUD di-sync lewat callback ~10 Hz dari
// game loop. Meniru navalCoop.ts.

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type PartySocket from "partysocket";
import {
  getLevel,
  getLevelMeta,
  LEVEL_PACK,
  packIdOfDef,
} from "../../../../../shared/frog/levels";
import type { FrogInput, Vec3 } from "../../../../../shared/frog/types";
import type { ClientMessage, ServerMessage } from "../../../../../shared/protocol";
import type { FrogRoomState, PlayerState } from "../../../../../shared/types";
import {
  createPartySocket,
  generateRoomCode,
  getPlayerKey,
} from "../../../lib/party";
import { markCompleted, readCompleted, readUnlocked } from "../lib/progress";
import { HIGH_CAM_KEY, readPref } from "../lib/preferences";
import { FrogRemoteGame, type FrogCoopHud } from "../lib/remote";

export type FrogCoopPhase = "form" | "waiting" | "playing" | "over";
export type FrogCoopStatus = "idle" | "connecting" | "connected" | "error";
export type FrogCoopWinner = "players" | "abandoned";

function freshHud(): FrogCoopHud {
  return {
    fliesGot: 0,
    fliesTotal: 7,
    orbsGot: 0,
    orbsTotal: 0,
    coinsGot: 0,
    coinsTotal: 0,
    tongueMode: "idle",
    partnerTongueMode: "idle",
    time: 0,
    fps: 0,
    calls: 0,
    triangles: 0,
    doorOpen: false,
    buttonDown: false,
    atGoalMe: false,
    atGoalPartner: false,
    croakMe: null,
    croakPartner: null,
  };
}

export const useFrogCoopStore = defineStore("frog-coop", () => {
  const status = ref<FrogCoopStatus>("idle");
  const phase = ref<FrogCoopPhase>("form");
  const code = ref("");
  const myId = ref("");
  const myKey = ref(getPlayerKey());
  const myIndex = ref<0 | 1 | null>(null);
  const room = ref<FrogRoomState | null>(null);
  const players = ref<PlayerState[]>([]);
  const error = ref("");
  const hud = ref<FrogCoopHud>(freshHud());
  /** Kamera sudut tinggi aktif (F6.13, cermin state game). */
  const highCam = ref(readPref(HIGH_CAM_KEY));
  const winner = ref<FrogCoopWinner | null>(null);
  const winTime = ref(0);
  const winFlies = ref(0);
  const winFliesTotal = ref(7);
  /** Id pack level pilihan host di form (F3). */
  const selectedLevel = ref("bengkel");
  /** Progresi (localStorage, sama dengan solo). */
  const unlocked = ref(readUnlocked());
  const completed = ref<string[]>(readCompleted());
  /** Naik tiap match baru (termasuk rematch): komponen me-remount game. */
  const gameKey = ref(0);

  // Kursi saya (buat warna katak + rematch).
  const mySeat = computed(
    () => room.value?.seats.find((s) => s.key === myKey.value) ?? null,
  );
  // Kursi pasangan (buat nama + warna di HUD).
  const partnerSeat = computed(
    () => room.value?.seats.find((s) => s.key !== myKey.value) ?? null,
  );
  // Saya sudah minta rematch, menunggu partner menyetujui.
  const rematchWaiting = computed(
    () => room.value?.rematchPendingBy === myKey.value,
  );
  // Partner sudah minta rematch, giliran saya menyetujui.
  const rematchOffered = computed(
    () =>
      room.value !== null &&
      room.value.rematchPendingBy !== null &&
      room.value.rematchPendingBy !== myKey.value,
  );
  // Partner terputus (match dijeda, menunggu 60 detik).
  const partnerGone = computed(
    () =>
      room.value?.status === "paused" &&
      players.value.some((p) => p.key !== myKey.value && !p.connected),
  );
  /** Nama level room saat ini (buat layar waiting + menang). */
  const roomLevelName = computed(() =>
    room.value ? getLevel(room.value.levelId).name : "",
  );
  /** Saya host (p1): yang memilih level berikutnya. */
  const isHost = computed(() => mySeat.value?.seatKey === "p1");
  /** Ada level berikutnya setelah level room saat ini. */
  const hasNext = computed(() => {
    if (!room.value) return false;
    const idx = LEVEL_PACK.findIndex((m) => m.coopId === room.value!.levelId);
    return idx >= 0 && idx + 1 < LEVEL_PACK.length;
  });

  /** Pilih level di form (hanya yang sudah terbuka). */
  function selectLevel(id: string): void {
    const idx = LEVEL_PACK.findIndex((m) => m.id === id);
    if (idx >= 0 && idx < unlocked.value) selectedLevel.value = id;
  }

  let socket: PartySocket | null = null;
  let remote: FrogRemoteGame | null = null;
  let mode: "create" | "join" = "join";
  let joined = false;
  let pending: { name: string; color: string; levelId: string } | null = null;
  let lastInputSent = 0;
  let inputSeq = 0;
  let seenGameNumber = 0;

  function send(msg: ClientMessage) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  function sendCreateOrJoin() {
    if (!pending) return;
    if (mode === "create" && !joined) {
      send({
        type: "create-frog",
        name: pending.name,
        color: pending.color,
        playerKey: myKey.value,
        levelId: pending.levelId,
      });
    } else {
      // Join (atau rejoin setelah reconnect otomatis).
      send({
        type: "join-frog",
        name: pending.name,
        color: pending.color,
        playerKey: myKey.value,
      });
    }
  }

  function finishMatch(w: FrogCoopWinner): void {
    if (phase.value === "over") return;
    winner.value = w;
    // Menang = level selesai: simpan progresi (buka level berikutnya).
    if (w === "players" && room.value) {
      winFliesTotal.value = getLevel(room.value.levelId).flies.length;
      const p = markCompleted(packIdOfDef(room.value.levelId));
      unlocked.value = p.unlocked;
      completed.value = p.completed;
    }
    phase.value = "over";
  }

  function handleMessage(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "hello":
        myId.value = msg.id;
        break;
      case "error":
        status.value = "error";
        error.value = msg.message;
        break;
      case "frog-room": {
        joined = true;
        status.value = "connected";
        error.value = "";
        room.value = msg.room;
        players.value = msg.players;
        myIndex.value = mySeat.value?.seatKey === "p2" ? 1 : 0;
        if (msg.room.status === "waiting") {
          if (phase.value !== "playing") phase.value = "waiting";
        } else if (msg.room.status === "playing") {
          // Match baru (termasuk rematch): gameNumber naik.
          if (msg.room.gameNumber !== seenGameNumber) {
            seenGameNumber = msg.room.gameNumber;
            gameKey.value++;
            winner.value = null;
          }
          phase.value = "playing";
        } else if (msg.room.status === "over") {
          const w = msg.room.winner;
          if (w === "players" || w === "abandoned") {
            finishMatch(w);
          }
        }
        // paused: phase tetap playing, komponen menampilkan banner jeda.
        break;
      }
      case "frog-snapshot":
        remote?.applySnapshot(msg.snap);
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
      case "system":
        // Pesan sistem (gabung/mulai/rematch) tidak ditampilkan di
        // layar co-op; status room sudah tercermin di HUD.
        break;
      default:
        break;
    }
  }

  function connect(
    roomCode: string,
    opts: { mode: "create" | "join"; name: string; color: string },
  ) {
    disconnect();
    mode = opts.mode;
    pending = {
      name: opts.name,
      color: opts.color,
      levelId: getLevelMeta(selectedLevel.value).coopId,
    };
    code.value = roomCode.toUpperCase();
    hud.value = freshHud();
    status.value = "connecting";
    error.value = "";
    joined = false;
    players.value = [];
    room.value = null;
    winner.value = null;
    seenGameNumber = 0;

    const ws = createPartySocket(code.value);
    socket = ws;
    ws.addEventListener("open", () => {
      // Reconnect otomatis (partySocket): kirim join lagi dengan
      // playerKey yang sama supaya kursi + match tersambung lagi.
      sendCreateOrJoin();
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

  function connectCreate(name: string, color: string) {
    connect(generateRoomCode(), { mode: "create", name, color });
  }

  function connectJoin(roomCode: string, name: string, color: string) {
    connect(roomCode, { mode: "join", name, color });
  }

  /** Pasang game remote ke container yang sudah ter-render. */
  function attachGame(container: HTMLElement): void {
    disposeRemote();
    const r = room.value;
    const seat = mySeat.value;
    if (!r || !seat) return;
    hud.value = freshHud();
    const myIdx = (seat.seatKey === "p2" ? 1 : 0) as 0 | 1;
    remote = new FrogRemoteGame(container, {
      onInput: (input: FrogInput) => sendInput(input),
      onFire: (origin: Vec3, dir: Vec3) =>
        send({
          type: "frog-fire",
          ox: origin.x,
          oy: origin.y,
          oz: origin.z,
          dx: dir.x,
          dy: dir.y,
          dz: dir.z,
        }),
      onRelease: () => send({ type: "frog-release" }),
      onCroak: () => send({ type: "frog-croak" }),
      onHud: (h: FrogCoopHud) => {
        hud.value = h;
      },
      onWin: (time: number, flies: number) => {
        winTime.value = time;
        winFlies.value = flies;
        finishMatch("players");
      },
    });
    remote.start({
      myIndex: myIdx,
      myColor: seat.color,
      partnerColor: seat.color === "orange" ? "green" : "orange",
      levelId: r.levelId,
    });
  }

  function disposeRemote(): void {
    remote?.dispose();
    remote = null;
  }

  function disconnect(): void {
    disposeRemote();
    if (socket) {
      socket.close();
      socket = null;
    }
    status.value = "idle";
    phase.value = "form";
    code.value = "";
    myId.value = "";
    myIndex.value = null;
    room.value = null;
    players.value = [];
    error.value = "";
    winner.value = null;
    joined = false;
    pending = null;
    seenGameNumber = 0;
  }

  /** Input kendali: kirim maks 20/detik (remote sudah throttle 50 ms,
   * ini lapis kedua supaya tidak ada burst). */
  function sendInput(input: FrogInput): void {
    const now = Date.now();
    if (now - lastInputSent < 50) return;
    lastInputSent = now;
    send({
      type: "frog-input",
      moveX: input.moveX,
      moveZ: input.moveZ,
      jump: input.jump,
      seq: ++inputSeq,
    });
  }

  function sendRematch(): void {
    send({ type: "frog-rematch" });
  }

  /** Minta level berikutnya (hanya host, server yang memvalidasi). */
  function sendNextLevel(): void {
    send({ type: "frog-next-level" });
  }

  /** Input sentuh (dari FrogTouchControls, diteruskan ke game remote). */
  function touchMove(x: number, y: number): void {
    remote?.setTouchMove(x, y);
  }

  function touchJump(): void {
    remote?.queueJump();
  }

  function touchTongue(): void {
    remote?.toggleTongue();
  }

  function touchCroak(): void {
    remote?.croak();
  }

  function touchOrbit(dx: number): void {
    remote?.orbitBy(dx);
  }

  /** Toggle kamera sudut tinggi (F6.13, tombol HUD). */
  function toggleCamera(): void {
    remote?.toggleHighCam();
    highCam.value = remote?.highCam ?? highCam.value;
  }

  return {
    status,
    phase,
    code,
    myId,
    myKey,
    myIndex,
    mySeat,
    partnerSeat,
    room,
    players,
    error,
    hud,
    winner,
    winTime,
    winFlies,
    winFliesTotal,
    highCam,
    selectedLevel,
    unlocked,
    completed,
    roomLevelName,
    isHost,
    hasNext,
    gameKey,
    rematchWaiting,
    rematchOffered,
    partnerGone,
    selectLevel,
    connectCreate,
    connectJoin,
    attachGame,
    disconnect,
    sendRematch,
    sendNextLevel,
    touchMove,
    touchJump,
    touchTongue,
    touchCroak,
    touchOrbit,
    toggleCamera,
  };
});
