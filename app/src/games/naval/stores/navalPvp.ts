// Store naval PvP (Pinia): koneksi WebSocket ke PartyServer, state
// room PvP 1v1, dan instance NavalRemoteGame yang disimpan NON-reaktif
// (seperti store co-op). HUD di-sync lewat callback ~10 Hz dari game
// loop. PvP independen dari progresi solo/co-op: tanpa level bot,
// tanpa unlock; host memilih map.

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type PartySocket from "partysocket";
import { getShipDef } from "../../../../../shared/naval/ships";
import type { ShipId, ShipInput } from "../../../../../shared/naval/types";
import type { ClientMessage, ServerMessage } from "../../../../../shared/protocol";
import type { NavalRoomState, PlayerState } from "../../../../../shared/types";
import { createPartySocket, generateRoomCode } from "../../../lib/party";
import { MATCH_DURATION, type DamageNumber, type NavalHud } from "../lib/game";
import { NavalRemoteGame } from "../lib/remote";
import type { DamageNum } from "./naval";

export type NavalPvpPhase = "form" | "waiting" | "playing" | "over";
export type NavalPvpStatus = "idle" | "connecting" | "connected" | "error";
export type NavalPvpWinner = "win" | "lose" | "draw";

const PLAYER_KEY = "minigame:player-key";

/** UUID stabil per browser (kursi room diikat ke key ini). */
function loadPlayerKey(): string {
  try {
    let k = localStorage.getItem(PLAYER_KEY);
    if (!k) {
      k = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, k);
    }
    return k;
  } catch {
    return crypto.randomUUID();
  }
}

/** HUD awal dari stats kapal yang dipilih + kapal lawan. */
function freshHud(myShipId: ShipId, foeShipId: ShipId, foeName: string): NavalHud {
  const me = getShipDef(myShipId);
  const foe = getShipDef(foeShipId);
  return {
    speed: 0,
    maxSpeed: me.maxSpeed,
    headingDeg: 90,
    hp: me.hp,
    maxHp: me.hp,
    dummyHp: foe.hp,
    dummyMaxHp: foe.hp,
    dummyVisible: false,
    px: -270,
    pz: 0,
    dx: 270,
    dz: 0,
    distance: 0,
    timeLeft: MATCH_DURATION,
    reloadFrac: 1,
    reloadLeft: 0,
    abilityFrac: 1,
    abilityLeft: 0,
    abilityName: me.abilityName,
    shipName: me.name,
    dummyName: foeName,
    aimDist: -1,
    aimLead: -1,
    aimBlocked: false,
    aimOutOfRange: false,
  };
}

export const useNavalPvpStore = defineStore("naval-pvp", () => {
  const status = ref<NavalPvpStatus>("idle");
  const phase = ref<NavalPvpPhase>("form");
  const code = ref("");
  const myId = ref("");
  const myKey = ref(loadPlayerKey());
  const myShipKey = ref<"p1" | "p2" | null>(null);
  const room = ref<NavalRoomState | null>(null);
  const players = ref<PlayerState[]>([]);
  const error = ref("");
  const hud = ref<NavalHud>(freshHud("frigate", "frigate", "Lawan"));
  const winner = ref<NavalPvpWinner | null>(null);
  const damageNums = ref<DamageNum[]>([]);
  const hitFlash = ref(0);
  /** Naik tiap match baru (termasuk rematch): komponen me-remount game. */
  const gameKey = ref(0);

  // Kursi saya (buat nama kapal + rematch).
  const mySeat = computed(
    () => room.value?.seats.find((s) => s.key === myKey.value) ?? null,
  );
  // Kursi lawan (buat HUD + nama pemenang).
  const foeSeat = computed(
    () => room.value?.seats.find((s) => s.key !== myKey.value) ?? null,
  );
  // Saya sudah minta rematch, menunggu lawan menyetujui.
  const rematchWaiting = computed(
    () => room.value?.rematchPendingBy === myKey.value,
  );
  // Lawan sudah minta rematch, giliran saya menyetujui.
  const rematchOffered = computed(
    () =>
      room.value !== null &&
      room.value.rematchPendingBy !== null &&
      room.value.rematchPendingBy !== myKey.value,
  );

  let socket: PartySocket | null = null;
  let remote: NavalRemoteGame | null = null;
  let mode: "create" | "join" = "join";
  let joined = false;
  let pending: {
    name: string;
    color: string;
    shipId: ShipId;
    mapId: string;
  } | null = null;
  let lastInputSent = 0;
  let inputSeq = 0;
  let dmgId = 0;
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
        type: "create-naval",
        name: pending.name,
        color: pending.color,
        playerKey: myKey.value,
        mode: "pvp",
        level: 1,
        mapId: pending.mapId,
        shipId: pending.shipId,
      });
    } else {
      // Join (atau rejoin setelah reconnect otomatis).
      send({
        type: "join-naval",
        name: pending.name,
        color: pending.color,
        playerKey: myKey.value,
        shipId: pending.shipId,
      });
    }
  }

  /** Petakan hasil mentah server ke menang/kalah/seri buat saya. */
  function mapWinner(winnerId: string): NavalPvpWinner {
    if (winnerId === "draw") return "draw";
    return winnerId === myShipKey.value ? "win" : "lose";
  }

  function finishMatch(w: NavalPvpWinner): void {
    if (phase.value === "over") return;
    winner.value = w;
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
      case "naval-room": {
        joined = true;
        status.value = "connected";
        error.value = "";
        room.value = msg.room;
        players.value = msg.players;
        myShipKey.value = mySeat.value?.shipKey ?? null;
        if (msg.room.status === "waiting") {
          if (phase.value !== "playing") phase.value = "waiting";
        } else if (msg.room.status === "playing") {
          // Match baru (termasuk rematch): gameNumber naik.
          if (msg.room.gameNumber !== seenGameNumber) {
            seenGameNumber = msg.room.gameNumber;
            gameKey.value++;
            winner.value = null;
            damageNums.value = [];
          }
          phase.value = "playing";
        } else if (msg.room.status === "over") {
          // Hasil PvP: shipKey pemenang ("p1"/"p2") atau "draw".
          const w = msg.room.winner;
          if (w === "p1" || w === "p2" || w === "draw") {
            finishMatch(mapWinner(w));
          }
        }
        // paused: phase tetap playing, komponen menampilkan banner jeda.
        break;
      }
      case "naval-snapshot":
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
        // Pesan sistem naval (gabung/mulai/rematch) tidak ditampilkan
        // di layar PvP; status room sudah tercermin di HUD.
        break;
      default:
        break;
    }
  }

  function connect(
    roomCode: string,
    opts: {
      mode: "create" | "join";
      name: string;
      color: string;
      shipId: ShipId;
      mapId: string;
    },
  ) {
    disconnect();
    mode = opts.mode;
    pending = {
      name: opts.name,
      color: opts.color,
      shipId: opts.shipId,
      mapId: opts.mapId,
    };
    code.value = roomCode.toUpperCase();
    hud.value = freshHud(opts.shipId, "frigate", "Lawan");
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

  function connectCreate(
    name: string,
    color: string,
    shipId: ShipId,
    mapId: string,
  ) {
    connect(generateRoomCode(), { mode: "create", name, color, shipId, mapId });
  }

  function connectJoin(
    roomCode: string,
    name: string,
    color: string,
    shipId: ShipId,
  ) {
    // Map ikut room (dibuat host); nilai di sini hanya placeholder.
    connect(roomCode, { mode: "join", name, color, shipId, mapId: "teluk" });
  }

  /** Pasang game remote ke container yang sudah ter-render. */
  function attachGame(container: HTMLElement): void {
    disposeRemote();
    const r = room.value;
    const seat = mySeat.value;
    const foe = foeSeat.value;
    if (!r || !seat || !foe) return;
    const foeName = `${foe.name} · ${getShipDef(foe.shipId).name}`;
    hud.value = freshHud(seat.shipId, foe.shipId, foeName);
    const ships = r.seats.map((s) => ({
      key: s.shipKey,
      defId: s.shipId,
      name: s.name,
    }));
    remote = new NavalRemoteGame(container, {
      onInput: (input: ShipInput) => sendInput(input),
      onFire: (aimX, aimZ) => sendFire(aimX, aimZ),
      onAbility: () => sendAbility(),
      onHud: (h: NavalHud) => {
        hud.value = h;
      },
      onMatchEnd: (winnerId: string) => {
        finishMatch(mapWinner(winnerId));
      },
      onDamage: (d: DamageNumber) => {
        const id = ++dmgId;
        damageNums.value.push({ ...d, id });
        setTimeout(() => {
          damageNums.value = damageNums.value.filter((n) => n.id !== id);
        }, 1000);
      },
      onPlayerHit: () => {
        hitFlash.value++;
      },
    });
    remote.start({
      mode: "pvp",
      mapId: r.mapId,
      myShipId: seat.shipId,
      myShipKey: seat.shipKey,
      ships,
      opponent: { key: foe.shipKey, defId: foe.shipId, name: foeName },
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
    myShipKey.value = null;
    room.value = null;
    players.value = [];
    error.value = "";
    winner.value = null;
    damageNums.value = [];
    joined = false;
    pending = null;
    seenGameNumber = 0;
  }

  /** Input kendali: kirim maks 20/detik (remote sudah throttle 50 ms,
   * ini lapis kedua supaya tidak ada burst). */
  function sendInput(input: ShipInput): void {
    const now = Date.now();
    if (now - lastInputSent < 50) return;
    lastInputSent = now;
    send({
      type: "naval-input",
      throttle: input.throttle,
      rudder: input.rudder,
      seq: ++inputSeq,
    });
  }

  function sendFire(aimX: number, aimZ: number): void {
    send({ type: "naval-fire", aimX, aimZ });
  }

  function sendAbility(): void {
    send({ type: "naval-ability" });
  }

  function sendRematch(): void {
    send({ type: "naval-rematch" });
  }

  return {
    status,
    phase,
    code,
    myId,
    myKey,
    myShipKey,
    mySeat,
    foeSeat,
    room,
    players,
    error,
    hud,
    winner,
    damageNums,
    hitFlash,
    gameKey,
    rematchWaiting,
    rematchOffered,
    connectCreate,
    connectJoin,
    attachGame,
    disconnect,
    sendInput,
    sendFire,
    sendAbility,
    sendRematch,
  };
});
