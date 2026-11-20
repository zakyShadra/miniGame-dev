// PartyServer Room: satu room = satu Durable Object (nama = kode room).
// Server memegang state piece secara authoritative: posisi, lock, snap,
// dan deteksi menang. State disimpan di SQLite DO supaya refresh atau
// rejoin tidak menghilangkan progres.

import { routePartykitRequest, Server } from "partyserver";
import type { Connection } from "partyserver";
import { Chess, type Color, type Square } from "chess.js";
import type { ClientMessage, ServerMessage } from "../../shared/protocol";
import type {
  ChessRoomState,
  FrogRoomState,
  FrogSnapshot,
  NavalRoomState,
  NavalShipSnap,
  NavalSnapshot,
  PieceState,
  PlayerState,
  RoomState,
} from "../../shared/types";
import {
  createCoopGame,
  releaseTongueCoop,
  stepCoop,
  TICK_DT as FROG_TICK_DT,
  tryFireCoop,
} from "../../shared/frog/sim";
import { getLevel, LEVEL_PACK } from "../../shared/frog/levels";
import type {
  CoopSimEvent,
  FrogCoopState,
  FrogInput,
} from "../../shared/frog/types";
import { BotController, BOT_LEVELS, type BotLevel } from "../../shared/naval/bot";
import { getMap, MAPS } from "../../shared/naval/maps";
import { SHIPS } from "../../shared/naval/ships";
import {
  canSee,
  createGame,
  fireVolley,
  getShip,
  stepGame,
  TICK_DT,
  useAbility,
} from "../../shared/naval/sim";
import type { GameState, ShipInput, SimEvent } from "../../shared/naval/types";
import { cutPuzzle, type CutResult } from "../../shared/game/cutter";
import {
  computeLayout,
  groupMembers,
  isSolved,
  LOGICAL_BOARD_H,
  LOGICAL_BOARD_W,
  scatterPieces,
  snapTolerance,
  tryGroup,
  trySnapGroup,
  type BoardLayout,
} from "../../shared/game/engine";
import { mulberry32 } from "../../shared/game/prng";

type Env = {
  Room: DurableObjectNamespace<Room>;
  IMAGES: KVNamespace;
};

/** Level angka (1-3) -> difficulty bot. */
const NAVAL_LEVEL_TO_BOT: Record<1 | 2 | 3, BotLevel> = {
  1: "medium",
  2: "hard",
  3: "extreme",
};

/** Durasi match naval (detik). Habis waktu = total HP tertinggi menang. */
const NAVAL_MATCH_DURATION = 300;
/** Interval tick game loop (20 Hz). */
const NAVAL_TICK_MS = 50;
/** Tenggang reconnect: match dijeda, lalu forfeit bila tak kembali. */
const NAVAL_DISCONNECT_GRACE_MS = 60_000;
/** Id kapal di sim: p1/p2 = pemain (sama dengan shipKey kursi). */
const NAVAL_BOT_ID = "bot";

/** Level co-op katak (F2): satu-satunya level co-op saat ini. */
const FROG_LEVEL_ID = "workshop-coop";
/** Interval tick game loop katak (20 Hz, 3 substep sim 60 Hz). */
const FROG_TICK_MS = 50;
/** Substep sim 60 Hz per tick server 20 Hz. */
const FROG_SUBSTEPS = 3;
/** Tenggang reconnect katak: match dijeda, lalu room bubar. */
const FROG_DISCONNECT_GRACE_MS = 60_000;
/** Durasi bubble kroak (detik). */
const FROG_CROAK_DURATION = 1.4;

export class Room extends Server<Env> {
  private state: RoomState | null = null;
  private cut: CutResult | null = null;
  private layout: BoardLayout | null = null;
  private loaded: Promise<void> | null = null;
  private lastPersist = 0;
  // Throttle chat per pemain (anti spam): pesan terakhir per conn id.
  private lastChatAt = new Map<string, number>();

  // State game naval co-op (in-memory saja, tidak di-persist: sim
  // 20 Hz terlalu berat buat SQLite per tick). Kalau DO restart di
  // tengah match, match ditandai seri saat load (lihat ensureLoaded).
  private navalGame: GameState | null = null;
  private navalBot: BotController | null = null;
  private navalTimer: ReturnType<typeof setInterval> | null = null;
  // Input terakhir per kapal pemain ("p1"/"p2").
  private navalInputs = new Map<string, ShipInput>();
  private navalDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Event di luar tick (tembakan pemain/bot) yang ikut snapshot berikut.
  private navalPendingEvents: SimEvent[] = [];

  // State game katak co-op (in-memory saja, tidak di-persist: sim
  // 20 Hz terlalu berat buat SQLite per tick). Kalau DO restart di
  // tengah match, match ditandai bubar saat load (lihat ensureLoaded).
  private frogGame: FrogCoopState | null = null;
  private frogTimer: ReturnType<typeof setInterval> | null = null;
  // Input terakhir per kursi ("p1"/"p2").
  private frogInputs = new Map<string, FrogInput>();
  private frogDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Event di luar tick (tembakan lidah) yang ikut snapshot berikut.
  private frogPendingEvents: CoopSimEvent[] = [];
  // Jam game saat bubble kroak hilang, per katak (indeks 0/1).
  private frogCroakUntil: [number, number] = [0, 0];

  // Muat state dari SQLite sekali per aktivasi DO. Dipanggil di awal
  // tiap handler supaya tidak ada balapan antar pesan.
  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        this.sql`CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, data TEXT)`;
        const rows =
          this.sql<{ data: string }>`SELECT data FROM room WHERE id = 1`;
        const data = rows[0]?.data;
        if (data) {
          try {
            this.state = JSON.parse(data) as RoomState;
            // Normalisasi groupId: state lama belum punya field ini.
            for (const p of this.state.pieces) p.groupId ??= null;
            // Normalisasi room catur: state lama belum punya kind/chess.
            this.state.kind ??= "puzzle";
            this.state.chess ??= null;
            // Normalisasi room naval: state lama belum punya naval/mode.
            this.state.naval ??= null;
            if (this.state.naval) this.state.naval.mode ??= "coop";
            // Normalisasi room katak: state lama belum punya frog.
            this.state.frog ??= null;
            // Match naval yang sedang jalan tidak selamat dari restart
            // DO (sim hanya di memori): tandai seri supaya room tidak
            // macet di status playing tanpa game loop.
            if (
              this.state.kind === "naval" &&
              this.state.naval &&
              (this.state.naval.status === "playing" ||
                this.state.naval.status === "paused")
            ) {
              this.state.naval.status = "over";
              this.state.naval.winner = "draw";
              this.state.naval.rematchPendingBy = null;
              this.persist();
            }
            // Match katak yang sedang jalan juga tidak selamat dari
            // restart DO: tandai bubar supaya room tidak macet.
            if (
              this.state.kind === "frog" &&
              this.state.frog &&
              (this.state.frog.status === "playing" ||
                this.state.frog.status === "paused")
            ) {
              this.state.frog.status = "over";
              this.state.frog.winner = "abandoned";
              this.state.frog.rematchPendingBy = null;
              this.persist();
            }
            this.deriveGame();
          } catch {
            this.state = null;
          }
        }
      })();
    }
    return this.loaded;
  }

  // Turunkan cut + layout dari state (deterministik, tidak disimpan).
  // Room catur tidak punya puzzle: lewati (imageW 0 akan merusak cut).
  private deriveGame() {
    if (!this.state || this.state.kind !== "puzzle") {
      this.cut = null;
      this.layout = null;
      return;
    }
    const s = this.state;
    this.cut = cutPuzzle(s.imageW, s.imageH, s.pieceCount, s.seed);
    this.layout = computeLayout(
      s.imageW,
      s.imageH,
      LOGICAL_BOARD_W,
      LOGICAL_BOARD_H,
    );
  }

  private persist() {
    if (!this.state) return;
    this.sql`INSERT OR REPLACE INTO room (id, data) VALUES (1, ${JSON.stringify(this.state)})`;
    this.lastPersist = Date.now();
  }

  // Simpan paling sering 2 detik sekali (buat drag); event penting
  // (create/join/drop/selesai) selalu persist langsung.
  private maybePersist() {
    if (Date.now() - this.lastPersist > 2000) this.persist();
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private sendAll(msg: ServerMessage, without?: string[]) {
    this.broadcast(JSON.stringify(msg), without);
  }

  // Pesan state lengkap + jam server (buat sinkron timer client).
  private stateMessage(): ServerMessage {
    return { type: "state", state: this.state!, now: Date.now() };
  }

  private sendSystem(text: string) {
    this.sendAll({ type: "system", text });
  }

  async onConnect(conn: Connection) {
    await this.ensureLoaded();
    this.send(conn, { type: "hello", id: conn.id });
  }

  async onMessage(conn: Connection, message: string | ArrayBuffer) {
    await this.ensureLoaded();
    if (typeof message !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "create":
        this.handleCreate(conn, msg);
        break;
      case "join":
        this.handleJoin(conn, msg);
        break;
      case "cursor":
        this.handleCursor(conn, msg);
        break;
      case "grab":
        this.handleGrab(conn, msg);
        break;
      case "move":
        this.handleMove(conn, msg);
        break;
      case "drop":
        this.handleDrop(conn, msg);
        break;
      case "chat":
        this.handleChat(conn, msg);
        break;
      case "sort":
        this.handleSort(conn);
        break;
      case "change-image":
        this.handleChangeImage(conn, msg);
        break;
      case "create-chess":
        this.handleCreateChess(conn, msg);
        break;
      case "join-chess":
        this.handleJoinChess(conn, msg);
        break;
      case "chess-move":
        this.handleChessMove(conn, msg);
        break;
      case "chess-resign":
        this.handleChessResign(conn);
        break;
      case "chess-rematch":
        this.handleChessRematch(conn);
        break;
      case "create-naval":
        this.handleCreateNaval(conn, msg);
        break;
      case "join-naval":
        this.handleJoinNaval(conn, msg);
        break;
      case "naval-input":
        this.handleNavalInput(conn, msg);
        break;
      case "naval-fire":
        this.handleNavalFire(conn, msg);
        break;
      case "naval-ability":
        this.handleNavalAbility(conn);
        break;
      case "naval-rematch":
        this.handleNavalRematch(conn);
        break;
      case "create-frog":
        this.handleCreateFrog(conn, msg);
        break;
      case "join-frog":
        this.handleJoinFrog(conn, msg);
        break;
      case "frog-input":
        this.handleFrogInput(conn, msg);
        break;
      case "frog-fire":
        this.handleFrogFire(conn, msg);
        break;
      case "frog-release":
        this.handleFrogRelease(conn);
        break;
      case "frog-croak":
        this.handleFrogCroak(conn);
        break;
      case "frog-rematch":
        this.handleFrogRematch(conn);
        break;
      case "frog-next-level":
        this.handleFrogNextLevel(conn);
        break;
      default:
        break;
    }
  }

  private handleCreate(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "create" }>,
  ) {
    if (this.state) {
      this.send(conn, {
        type: "error",
        message: "Room sudah ada, coba kode lain.",
      });
      return;
    }
    const pieceCount = Math.floor(msg.pieceCount);
    if (
      !msg.imageUrl ||
      !msg.imageName ||
      !(msg.imageW > 0) ||
      !(msg.imageH > 0) ||
      pieceCount < 12 ||
      pieceCount > 500
    ) {
      this.send(conn, { type: "error", message: "Data room tidak valid." });
      return;
    }
    const seed = (Math.random() * 0x7fffffff) | 0;
    const cut = cutPuzzle(msg.imageW, msg.imageH, pieceCount, seed);
    const layout = computeLayout(
      msg.imageW,
      msg.imageH,
      LOGICAL_BOARD_W,
      LOGICAL_BOARD_H,
    );
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const pieces = scatterPieces(cut, layout, rng);
    const player: PlayerState = {
      id: conn.id,
      name: msg.name.trim().slice(0, 20) || "Pemain",
      color: msg.color,
      cursor: null,
      connected: true,
      lastSeen: Date.now(),
      key: msg.playerKey || undefined,
    };
    this.state = {
      code: this.name,
      kind: "puzzle",
      chess: null,
      naval: null,
      frog: null,
      imageUrl: msg.imageUrl,
      imageName: msg.imageName,
      imageW: msg.imageW,
      imageH: msg.imageH,
      pieceCount,
      seed,
      pieces,
      players: [player],
      hostId: conn.id,
      startedAt: Date.now(),
      solvedAt: null,
    };
    this.cut = cut;
    this.layout = layout;
    this.persist();
    this.send(conn, this.stateMessage());
  }

  private handleJoin(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "join" }>,
  ) {
    if (!this.state) {
      this.send(conn, {
        type: "error",
        message: "Room tidak ditemukan, cek kodenya.",
      });
      return;
    }
    if (this.state.kind !== "puzzle") {
      this.send(conn, {
        type: "error",
        message: "Room ini untuk catur, bukan puzzle.",
      });
      return;
    }
    // Rejoin: cari dulu berdasarkan playerKey (stabil antar reconnect),
    // lalu berdasarkan conn.id (koneksi yang sama). Rejoin menautkan
    // ulang entri pemain ke conn.id baru supaya tidak ada duplikat.
    const existing =
      (msg.playerKey
        ? this.state.players.find((p) => p.key === msg.playerKey)
        : undefined) ?? this.state.players.find((p) => p.id === conn.id);
    if (existing) {
      existing.id = conn.id;
      existing.name = msg.name.trim().slice(0, 20) || existing.name;
      existing.color = msg.color;
      existing.connected = true;
      existing.lastSeen = Date.now();
      if (msg.playerKey) existing.key = msg.playerKey;
    } else {
      const player: PlayerState = {
        id: conn.id,
        name: msg.name.trim().slice(0, 20) || "Pemain",
        color: msg.color,
        cursor: null,
        connected: true,
        lastSeen: Date.now(),
        key: msg.playerKey || undefined,
      };
      this.state.players.push(player);
      this.sendAll({ type: "player-joined", player }, [conn.id]);
      this.sendSystem(`${player.name} bergabung`);
    }
    this.persist();
    this.send(conn, this.stateMessage());
  }

  private handleCursor(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "cursor" }>,
  ) {
    const player = this.state?.players.find((p) => p.id === conn.id);
    if (!player) return;
    player.cursor = { x: msg.x, y: msg.y };
    player.lastSeen = Date.now();
    this.sendAll(
      { type: "cursor", playerId: conn.id, x: msg.x, y: msg.y },
      [conn.id],
    );
  }

  private findPiece(pieceId: number): PieceState | undefined {
    return this.state?.pieces.find((p) => p.id === pieceId);
  }

  private handleGrab(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "grab" }>,
  ) {
    const piece = this.findPiece(msg.pieceId);
    if (!piece || piece.placed || !this.state) {
      this.send(conn, { type: "grab-denied", pieceId: msg.pieceId });
      return;
    }
    // Kunci seluruh grup; tolak kalau ada anggota yang dipegang pemain lain.
    const members = groupMembers(piece, this.state.pieces);
    if (members.some((m) => m.lockedBy && m.lockedBy !== conn.id)) {
      this.send(conn, { type: "grab-denied", pieceId: msg.pieceId });
      return;
    }
    for (const m of members) {
      m.lockedBy = conn.id;
      m.lockedAt = Date.now();
      this.sendAll({
        type: "piece-locked",
        pieceId: m.id,
        playerId: conn.id,
      });
    }
  }

  private handleMove(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "move" }>,
  ) {
    const piece = this.findPiece(msg.pieceId);
    if (!piece || piece.placed || piece.lockedBy !== conn.id || !this.state) {
      return;
    }
    // Geser seluruh grup dengan delta yang sama (client hanya mengirim
    // posisi piece yang dipegang).
    const dx = msg.x - piece.x;
    const dy = msg.y - piece.y;
    for (const m of groupMembers(piece, this.state.pieces)) {
      if (m.placed) continue;
      m.x += dx;
      m.y += dy;
      this.sendAll({ type: "piece-moved", piece: m }, [conn.id]);
    }
    this.maybePersist();
  }

  private handleDrop(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "drop" }>,
  ) {
    const piece = this.findPiece(msg.pieceId);
    if (!piece || piece.lockedBy !== conn.id || !this.state) return;
    // Terapkan posisi akhir ke seluruh grup (delta dari posisi terakhir
    // yang diketahui server; move terakhir bisa ter-throttle di client).
    const dx = msg.x - piece.x;
    const dy = msg.y - piece.y;
    const members = groupMembers(piece, this.state.pieces);
    for (const m of members) {
      if (m.placed) continue;
      m.x += dx;
      m.y += dy;
      m.lockedBy = null;
      m.lockedAt = null;
    }
    // Snap grup dulu; kalau tidak snap, coba gabung dengan tetangga (M5).
    let snapped = false;
    if (this.cut && this.layout && !piece.placed) {
      snapped = trySnapGroup(
        piece,
        this.state.pieces,
        this.cut,
        this.layout,
        snapTolerance(this.cut, this.layout),
      );
    }
    if (!snapped && this.cut && this.layout) {
      tryGroup(
        piece,
        this.state.pieces,
        this.cut,
        this.layout,
        snapTolerance(this.cut, this.layout),
      );
    }
    this.persist();
    // Siarkan semua anggota yang berubah: grup sebelum drop (bisa jadi
    // terpasang dan keluar dari grup) + grup setelah gabung (bisa
    // membesar karena tryGroup).
    const broadcastIds = new Set(members.map((m) => m.id));
    for (const m of groupMembers(piece, this.state.pieces)) {
      broadcastIds.add(m.id);
    }
    for (const id of broadcastIds) {
      const p = this.findPiece(id);
      if (p) this.sendAll({ type: "piece-moved", piece: p });
    }
    if (isSolved(this.state.pieces) && !this.state.solvedAt) {
      this.state.solvedAt = Date.now();
      this.persist();
      this.sendSystem("Puzzle selesai!");
      this.sendAll({ type: "solved", at: this.state.solvedAt });
    }
  }

  private handleChat(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "chat" }>,
  ) {
    const player = this.state?.players.find((p) => p.id === conn.id);
    if (!player) return;
    const text = msg.text.trim().slice(0, 500);
    if (!text) return;
    // Throttle: paling cepat 1 pesan per 500ms per pemain.
    const now = Date.now();
    if (now - (this.lastChatAt.get(conn.id) ?? 0) < 500) return;
    this.lastChatAt.set(conn.id, now);
    this.sendAll({
      type: "chat",
      playerId: conn.id,
      name: player.name,
      text,
      at: now,
    });
  }

  private handleSort(conn: Connection) {
    const player = this.state?.players.find((p) => p.id === conn.id);
    if (!player || !this.state || !this.cut || !this.layout) return;
    // Acak ulang posisi piece yang belum terpasang dan tidak sedang
    // dipegang siapa pun. Piece terpasang dan yang di-drag tidak bergerak.
    const rng = mulberry32((Date.now() ^ (Math.random() * 0x7fffffff)) | 0);
    const fresh = scatterPieces(this.cut, this.layout, rng);
    const freshById = new Map(fresh.map((p) => [p.id, p]));
    for (const piece of this.state.pieces) {
      if (piece.placed || piece.lockedBy) continue;
      const pos = freshById.get(piece.id);
      if (pos) {
        piece.x = pos.x;
        piece.y = pos.y;
        // Grup dibubarkan: anggota yang di-scatter ulang ke posisi acak
        // tidak lagi bergerak bersama (M5).
        piece.groupId = null;
      }
    }
    this.persist();
    this.sendAll(this.stateMessage());
    this.sendSystem(`${player.name} merapikan piece`);
  }

  // Ganti gambar room (host saja): reset puzzle dengan gambar baru.
  // Pemain, kode, dan host tetap; seed, potongan, dan timer baru.
  private handleChangeImage(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "change-image" }>,
  ) {
    if (!this.state || this.state.hostId !== conn.id) return;
    const pieceCount = Math.floor(msg.pieceCount);
    if (
      !msg.imageUrl ||
      !msg.imageName ||
      !(msg.imageW > 0) ||
      !(msg.imageH > 0) ||
      pieceCount < 12 ||
      pieceCount > 500
    ) {
      this.send(conn, { type: "error", message: "Data gambar tidak valid." });
      return;
    }
    const seed = (Math.random() * 0x7fffffff) | 0;
    const cut = cutPuzzle(msg.imageW, msg.imageH, pieceCount, seed);
    const layout = computeLayout(
      msg.imageW,
      msg.imageH,
      LOGICAL_BOARD_W,
      LOGICAL_BOARD_H,
    );
    const rng = mulberry32(seed ^ 0x9e3779b9);
    this.state = {
      ...this.state,
      imageUrl: msg.imageUrl,
      imageName: msg.imageName,
      imageW: msg.imageW,
      imageH: msg.imageH,
      pieceCount,
      seed,
      pieces: scatterPieces(cut, layout, rng),
      startedAt: Date.now(),
      solvedAt: null,
    };
    this.cut = cut;
    this.layout = layout;
    this.persist();
    this.sendAll(this.stateMessage());
    this.sendSystem("Host mengganti gambar, puzzle di-reset");
  }

  // ---------- Catur online ----------
  //
  // Server memegang daftar langkah (UCI) secara authoritative dan
  // memvalidasi tiap langkah dengan chess.js (giliran + legal).
  // Semua update catur sampai ke client lewat pesan "state" penuh,
  // jadi client yang terputus lalu rejoin langsung sinkron lagi.
  // Kursi Putih/Hitam diikat ke playerKey (stabil antar reconnect),
  // bukan conn.id yang berubah tiap koneksi baru.

  // Bangun posisi dari daftar langkah tersimpan. Langkah tersimpan
  // selalu hasil validasi server, jadi replay tidak mungkin gagal;
  // kalau toh gagal, kembalikan posisi awal supaya satu state rusak
  // tidak mematikan room.
  private chessGameFromMoves(moves: string[]): Chess {
    const game = new Chess();
    for (const uci of moves) {
      try {
        game.move({
          from: uci.slice(0, 2) as Square,
          to: uci.slice(2, 4) as Square,
          promotion:
            (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? undefined,
        });
      } catch {
        return new Chess();
      }
    }
    return game;
  }

  // Kunci pemain dari koneksi ini (disimpan di entri pemain saat join).
  private playerKeyOf(conn: Connection): string | null {
    return this.state?.players.find((p) => p.id === conn.id)?.key ?? null;
  }

  // Warna kursi yang dipegang koneksi ini di room catur.
  private chessColorOf(conn: Connection): Color | null {
    const cs = this.state?.chess;
    if (!cs) return null;
    const key = this.playerKeyOf(conn);
    if (!key) return null;
    if (key === cs.whiteKey) return "w";
    if (key === cs.blackKey) return "b";
    return null;
  }

  private handleCreateChess(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "create-chess" }>,
  ) {
    if (this.state) {
      this.send(conn, {
        type: "error",
        message: "Room sudah ada, coba kode lain.",
      });
      return;
    }
    if (!msg.playerKey) {
      this.send(conn, { type: "error", message: "Data room tidak valid." });
      return;
    }
    const name = msg.name.trim().slice(0, 20) || "Pemain";
    const player: PlayerState = {
      id: conn.id,
      name,
      color: msg.color,
      cursor: null,
      connected: true,
      lastSeen: Date.now(),
      key: msg.playerKey,
    };
    this.state = {
      code: this.name,
      kind: "chess",
      chess: {
        whiteKey: msg.playerKey,
        blackKey: null,
        whiteName: name,
        blackName: "",
        moves: [],
        status: "waiting",
        endKind: null,
        winner: null,
        rematchPendingBy: null,
        gameNumber: 1,
      },
      naval: null,
      frog: null,
      // Field puzzle tidak dipakai di room catur.
      imageUrl: "",
      imageName: "",
      imageW: 0,
      imageH: 0,
      pieceCount: 0,
      seed: 0,
      pieces: [],
      players: [player],
      hostId: conn.id,
      startedAt: Date.now(),
      solvedAt: null,
    };
    this.persist();
    this.send(conn, this.stateMessage());
  }

  private handleJoinChess(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "join-chess" }>,
  ) {
    if (!this.state || !this.state.chess) {
      this.send(conn, {
        type: "error",
        message: "Room tidak ditemukan, cek kodenya.",
      });
      return;
    }
    if (this.state.kind !== "chess") {
      this.send(conn, {
        type: "error",
        message: "Room ini untuk puzzle, bukan catur.",
      });
      return;
    }
    const cs = this.state.chess;
    const name = msg.name.trim().slice(0, 20) || "Pemain";
    // Rejoin kursi sendiri (refresh/reconnect): key cocok dengan kursi.
    if (msg.playerKey === cs.whiteKey || msg.playerKey === cs.blackKey) {
      const existing = this.state.players.find(
        (p) => p.key === msg.playerKey,
      );
      if (existing) {
        existing.id = conn.id;
        existing.name = name;
        existing.color = msg.color;
        existing.connected = true;
        existing.lastSeen = Date.now();
      }
      this.persist();
      this.send(conn, this.stateMessage());
      return;
    }
    // Kursi Hitam masih kosong: pemain kedua masuk, game dimulai.
    if (cs.blackKey === null) {
      cs.blackKey = msg.playerKey;
      cs.blackName = name;
      cs.status = "playing";
      const player: PlayerState = {
        id: conn.id,
        name,
        color: msg.color,
        cursor: null,
        connected: true,
        lastSeen: Date.now(),
        key: msg.playerKey,
      };
      this.state.players.push(player);
      this.persist();
      this.sendAll({ type: "player-joined", player }, [conn.id]);
      this.sendSystem(`${name} bergabung (Hitam), game dimulai!`);
      this.sendAll(this.stateMessage());
      return;
    }
    this.send(conn, {
      type: "error",
      message: "Room catur sudah penuh (2 pemain).",
    });
  }

  private handleChessMove(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "chess-move" }>,
  ) {
    const cs = this.state?.chess;
    if (!cs || this.state!.kind !== "chess" || cs.status !== "playing") return;
    const color = this.chessColorOf(conn);
    if (!color) return;
    const game = this.chessGameFromMoves(cs.moves);
    if (game.turn() !== color) return;
    const uci = msg.uci.trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return;
    try {
      game.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion:
          (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? undefined,
      });
    } catch {
      // Langkah ilegal: abaikan, jangan siarkan apa pun.
      return;
    }
    cs.moves.push(uci);
    // Deteksi akhir game (server authoritative, kedua client ikut).
    if (game.isCheckmate()) {
      cs.status = "over";
      cs.endKind = "checkmate";
      cs.winner = color;
    } else if (game.isStalemate()) {
      cs.status = "over";
      cs.endKind = "stalemate";
    } else if (game.isThreefoldRepetition()) {
      cs.status = "over";
      cs.endKind = "repetition";
    } else if (game.isInsufficientMaterial()) {
      cs.status = "over";
      cs.endKind = "insufficient";
    } else if (game.isDrawByFiftyMoves()) {
      cs.status = "over";
      cs.endKind = "fifty";
    }
    this.persist();
    this.sendAll(this.stateMessage());
    if (cs.status === "over") {
      this.sendSystem(
        cs.winner
          ? `${cs.winner === "w" ? cs.whiteName : cs.blackName} menang (skakmat)!`
          : "Game remis.",
      );
    }
  }

  private handleChessResign(conn: Connection) {
    const cs = this.state?.chess;
    if (!cs || this.state!.kind !== "chess" || cs.status !== "playing") return;
    const color = this.chessColorOf(conn);
    if (!color) return;
    const winner: Color = color === "w" ? "b" : "w";
    cs.status = "over";
    cs.endKind = "resign";
    cs.winner = winner;
    this.persist();
    this.sendAll(this.stateMessage());
    this.sendSystem(
      `${winner === "w" ? cs.whiteName : cs.blackName} menang (${color === "w" ? cs.whiteName : cs.blackName} menyerah).`,
    );
  }

  private handleChessRematch(conn: Connection) {
    const cs = this.state?.chess;
    if (!cs || this.state!.kind !== "chess" || cs.status !== "over") return;
    const color = this.chessColorOf(conn);
    if (!color) return;
    const other: Color = color === "w" ? "b" : "w";
    // Sudah minta: tunggu lawan, jangan duplikat.
    if (cs.rematchPendingBy === color) return;
    // Lawan sudah minta duluan: rematch jalan, warna ditukar.
    if (cs.rematchPendingBy === other) {
      const oldWhiteKey = cs.whiteKey;
      const oldWhiteName = cs.whiteName;
      cs.whiteKey = cs.blackKey;
      cs.whiteName = cs.blackName;
      cs.blackKey = oldWhiteKey;
      cs.blackName = oldWhiteName;
      cs.moves = [];
      cs.status = "playing";
      cs.endKind = null;
      cs.winner = null;
      cs.rematchPendingBy = null;
      cs.gameNumber += 1;
      this.persist();
      this.sendAll(this.stateMessage());
      this.sendSystem("Rematch! Warna ditukar, game baru dimulai.");
      return;
    }
    cs.rematchPendingBy = color;
    this.persist();
    this.sendAll(this.stateMessage());
    this.sendSystem(
      `${color === "w" ? cs.whiteName : cs.blackName} minta rematch.`,
    );
  }

  // ---------- Naval (co-op 2 pemain vs bot + PvP 1v1) ----------
  //
  // Server authoritative: sim murni (shared/naval) jalan di DO dengan
  // tick 20 Hz via setInterval (BUKAN alarm, supaya tidak hibernate
  // di tengah match). Client hanya mengirim input + aksi dan menerima
  // snapshot per tick. LoS server-side: kapal lawan (bot di co-op,
  // pemain lain di PvP) tidak dikirim ke pemain yang garis pandangnya
  // terhalang pulau.
  //
  // Kursi p1/p2 diikat ke playerKey (stabil antar reconnect), sama
  // seperti kursi catur. Match dijeda saat satu pemain putus (60 detik
  // tenggang reconnect), forfeit bila tidak kembali (co-op: bot menang;
  // PvP: pemain yang tersisa menang).

  private navalRoomMessage(): ServerMessage {
    return {
      type: "naval-room",
      room: this.state!.naval!,
      players: this.state!.players,
    };
  }

  // Kursi naval yang dipegang koneksi ini (null bila bukan pemain).
  private navalSeatOf(
    conn: Connection,
  ): NavalRoomState["seats"][number] | null {
    const naval = this.state?.naval;
    if (!naval) return null;
    const key = this.playerKeyOf(conn);
    if (!key) return null;
    return naval.seats.find((s) => s.key === key) ?? null;
  }

  private handleCreateNaval(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "create-naval" }>,
  ) {
    if (this.state) {
      this.send(conn, {
        type: "error",
        message: "Room sudah ada, coba kode lain.",
      });
      return;
    }
    if (
      !msg.playerKey ||
      !(msg.level === 1 || msg.level === 2 || msg.level === 3) ||
      !Object.hasOwn(SHIPS, msg.shipId) ||
      (msg.mode === "pvp" && !MAPS.some((m) => m.id === msg.mapId))
    ) {
      this.send(conn, { type: "error", message: "Data room tidak valid." });
      return;
    }
    // Client lama (sebelum PvP) tidak mengirim mode: anggap co-op.
    const mode = msg.mode === "pvp" ? "pvp" : "coop";
    const name = msg.name.trim().slice(0, 20) || "Pemain";
    const player: PlayerState = {
      id: conn.id,
      name,
      color: msg.color,
      cursor: null,
      connected: true,
      lastSeen: Date.now(),
      key: msg.playerKey,
    };
    const info = BOT_LEVELS[NAVAL_LEVEL_TO_BOT[msg.level]];
    this.state = {
      code: this.name,
      kind: "naval",
      chess: null,
      naval: {
        mode,
        // PvP: level tidak relevan (simpan 1), map pilihan host.
        // Co-op: map ikut level, mapId client diabaikan.
        level: mode === "pvp" ? 1 : msg.level,
        mapId: mode === "pvp" ? msg.mapId : info.mapId,
        status: "waiting",
        seats: [{ key: msg.playerKey, name, shipId: msg.shipId, shipKey: "p1" }],
        winner: null,
        rematchPendingBy: null,
        gameNumber: 1,
      },
      frog: null,
      // Field puzzle tidak dipakai di room naval.
      imageUrl: "",
      imageName: "",
      imageW: 0,
      imageH: 0,
      pieceCount: 0,
      seed: 0,
      pieces: [],
      players: [player],
      hostId: conn.id,
      startedAt: Date.now(),
      solvedAt: null,
    };
    this.persist();
    this.send(conn, this.navalRoomMessage());
  }

  private handleJoinNaval(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "join-naval" }>,
  ) {
    if (!this.state || !this.state.naval) {
      this.send(conn, {
        type: "error",
        message: "Room tidak ditemukan, cek kodenya.",
      });
      return;
    }
    if (this.state.kind !== "naval") {
      this.send(conn, {
        type: "error",
        message: "Room ini bukan room naval.",
      });
      return;
    }
    if (!msg.playerKey || !Object.hasOwn(SHIPS, msg.shipId)) {
      this.send(conn, { type: "error", message: "Data room tidak valid." });
      return;
    }
    const naval = this.state.naval;
    const name = msg.name.trim().slice(0, 20) || "Pemain";
    // Rejoin kursi sendiri (refresh/reconnect): key cocok dengan kursi.
    const seat = naval.seats.find((s) => s.key === msg.playerKey);
    if (seat) {
      const existing = this.state.players.find(
        (p) => p.key === msg.playerKey,
      );
      if (existing) {
        existing.id = conn.id;
        existing.name = name;
        existing.color = msg.color;
        existing.connected = true;
        existing.lastSeen = Date.now();
      }
      // Batalkan timer forfeit; match yang dijeda dilanjutkan hanya
      // bila SEMUA kursi sudah kembali (kalau tidak, timer baru jalan
      // untuk pemain yang masih putus).
      if (this.navalDisconnectTimer) {
        clearTimeout(this.navalDisconnectTimer);
        this.navalDisconnectTimer = null;
      }
      if (naval.status === "paused" && this.navalGame) {
        const allBack = naval.seats.every((s) => {
          const p = this.state!.players.find((pl) => pl.key === s.key);
          return p?.connected;
        });
        if (allBack) {
          naval.status = "playing";
          this.startNavalTick();
          this.sendSystem(`${name} kembali, match dilanjutkan!`);
        } else {
          this.scheduleNavalForfeit();
        }
      }
      this.persist();
      this.send(conn, this.navalRoomMessage());
      // Kirim snapshot terakhir supaya client langsung sinkron.
      if (this.navalGame && naval.status === "playing") {
        const snap = this.navalSnapshotFor(seat.shipKey, []);
        if (snap) this.send(conn, { type: "naval-snapshot", snap });
      }
      return;
    }
    // Kursi p2 masih kosong: pemain kedua masuk, match dimulai.
    if (naval.seats.length < 2) {
      naval.seats.push({
        key: msg.playerKey,
        name,
        shipId: msg.shipId,
        shipKey: "p2",
      });
      const player: PlayerState = {
        id: conn.id,
        name,
        color: msg.color,
        cursor: null,
        connected: true,
        lastSeen: Date.now(),
        key: msg.playerKey,
      };
      this.state.players.push(player);
      this.sendAll({ type: "player-joined", player }, [conn.id]);
      this.sendSystem(`${name} bergabung, match dimulai!`);
      this.startNavalMatch();
      this.sendAll(this.navalRoomMessage());
      return;
    }
    this.send(conn, {
      type: "error",
      message: "Room naval sudah penuh (2 pemain).",
    });
  }

  // Buat game baru dari kursi yang ada dan mulai tick. Dipakai saat
  // match pertama dan tiap rematch. Co-op: p1 spawn A, p2 spawn C,
  // bot spawn B. PvP: p1 spawn A, p2 spawn B, TANPA bot.
  private startNavalMatch(): void {
    const naval = this.state?.naval;
    if (!naval) return;
    const p1 = naval.seats.find((s) => s.shipKey === "p1");
    const p2 = naval.seats.find((s) => s.shipKey === "p2");
    if (!p1 || !p2) return;
    const map = getMap(naval.mapId);
    if (naval.mode === "pvp") {
      this.navalGame = createGame(map, [
        { id: "p1", defId: p1.shipId, spawn: "A" },
        { id: "p2", defId: p2.shipId, spawn: "B" },
      ]);
      this.navalBot = null;
    } else {
      const botLevel = NAVAL_LEVEL_TO_BOT[naval.level];
      this.navalGame = createGame(map, [
        { id: "p1", defId: p1.shipId, spawn: "A" },
        { id: "p2", defId: p2.shipId, spawn: "C" },
        { id: NAVAL_BOT_ID, defId: BOT_LEVELS[botLevel].botShip, spawn: "B" },
      ]);
      this.navalBot = new BotController(botLevel, NAVAL_BOT_ID);
    }
    this.navalInputs.clear();
    this.navalPendingEvents = [];
    naval.status = "playing";
    naval.winner = null;
    naval.rematchPendingBy = null;
    this.persist();
    this.startNavalTick();
  }

  private startNavalTick(): void {
    this.stopNavalTick();
    this.navalTimer = setInterval(() => this.navalTick(), NAVAL_TICK_MS);
  }

  private stopNavalTick(): void {
    if (this.navalTimer) {
      clearInterval(this.navalTimer);
      this.navalTimer = null;
    }
  }

  private navalTick(): void {
    const naval = this.state?.naval;
    const game = this.navalGame;
    const bot = this.navalBot;
    if (!naval || !game || naval.status !== "playing") {
      this.stopNavalTick();
      return;
    }
    const isPvp = naval.mode === "pvp";
    // Co-op tanpa bot = state rusak, hentikan tick. PvP memang tanpa bot.
    if (!isPvp && !bot) {
      this.stopNavalTick();
      return;
    }
    const inputs = new Map<string, ShipInput>();
    for (const seat of naval.seats) {
      inputs.set(
        seat.shipKey,
        this.navalInputs.get(seat.shipKey) ?? { throttle: 0, rudder: 0 },
      );
    }
    // Bot (co-op saja): keputusan + tembakan + kemampuan sebelum step.
    if (bot) {
      const decision = bot.update(game, TICK_DT);
      inputs.set(NAVAL_BOT_ID, decision.input);
      if (decision.fireAt) {
        const botShip = getShip(game, NAVAL_BOT_ID);
        if (
          botShip &&
          fireVolley(game, NAVAL_BOT_ID, decision.fireAt.x, decision.fireAt.z)
        ) {
          this.navalPendingEvents.push({
            type: "fire",
            shipId: NAVAL_BOT_ID,
            x: botShip.x,
            y: 4,
            z: botShip.z,
          });
        }
      }
      if (decision.useAbility) useAbility(game, NAVAL_BOT_ID);
    }

    const events = stepGame(game, inputs, TICK_DT);
    const allEvents = [...this.navalPendingEvents, ...events];
    this.navalPendingEvents = [];

    const p1 = getShip(game, "p1");
    const p2 = getShip(game, "p2");
    // PvP: kapal terakhir hidup menang; waktu habis = HP tertinggi
    // (seri bila sama); dua-duanya tenggelam di tick yang sama = seri.
    if (isPvp) {
      const p1Dead = p1 && !p1.alive;
      const p2Dead = p2 && !p2.alive;
      if (p1Dead && p2Dead) {
        this.endNavalMatch("draw", allEvents);
        return;
      }
      if (p1Dead) {
        this.endNavalMatch("p2", allEvents);
        return;
      }
      if (p2Dead) {
        this.endNavalMatch("p1", allEvents);
        return;
      }
      if (game.time >= NAVAL_MATCH_DURATION) {
        const h1 = p1?.hp ?? 0;
        const h2 = p2?.hp ?? 0;
        this.endNavalMatch(
          h1 > h2 ? "p1" : h2 > h1 ? "p2" : "draw",
          allEvents,
          "timeout",
        );
        return;
      }
      this.broadcastNavalSnapshot(allEvents, game.winnerId);
      return;
    }

    // Akhir match co-op (tim, bukan kapal tunggal): bot tenggelam ->
    // pemain menang; kedua pemain tenggelam -> bot menang; waktu habis
    // -> total HP pemain vs HP bot, seri bila sama.
    const botShip = getShip(game, NAVAL_BOT_ID);
    if (botShip && !botShip.alive) {
      this.endNavalMatch("players", allEvents);
      return;
    }
    if (p1 && p2 && !p1.alive && !p2.alive) {
      this.endNavalMatch("bot", allEvents);
      return;
    }
    if (game.time >= NAVAL_MATCH_DURATION) {
      const playersHp = (p1?.hp ?? 0) + (p2?.hp ?? 0);
      const botHp = botShip?.hp ?? 0;
      this.endNavalMatch(
        playersHp > botHp ? "players" : botHp > playersHp ? "bot" : "draw",
        allEvents,
        "timeout",
      );
      return;
    }

    this.broadcastNavalSnapshot(allEvents, game.winnerId);
  }

  private endNavalMatch(
    winner: "players" | "bot" | "draw" | "p1" | "p2",
    events: SimEvent[],
    cause: "sink" | "timeout" | "forfeit" = "sink",
  ): void {
    const naval = this.state?.naval;
    if (!naval) return;
    this.stopNavalTick();
    naval.status = "over";
    naval.winner = winner;
    this.persist();
    // Snapshot terakhir membawa hasil di winnerId (tim co-op, atau
    // shipKey pemenang PvP).
    this.broadcastNavalSnapshot(events, winner);
    this.sendAll(this.navalRoomMessage());
    // Forfeit: pemanggil sudah mengirim pesan sistemnya sendiri.
    if (cause === "forfeit") return;
    const winnerName =
      winner === "p1" || winner === "p2"
        ? (naval.seats.find((s) => s.shipKey === winner)?.name ?? "Pemain")
        : "";
    this.sendSystem(
      winner === "players"
        ? cause === "timeout"
          ? "Kalian menang! HP tim kalian lebih tinggi."
          : "Kalian menang! Kapal bot tenggelam."
        : winner === "bot"
          ? cause === "timeout"
            ? "Bot menang. HP bot lebih tinggi."
            : "Bot menang. Kapal kalian tenggelam."
          : winner === "draw"
            ? naval.mode === "pvp"
              ? "Seri! HP kedua kapal sama."
              : "Seri! HP kedua tim sama."
            : cause === "timeout"
              ? `${winnerName} menang! HP lebih tinggi saat waktu habis.`
              : `${winnerName} menang! Kapal lawan tenggelam.`,
    );
  }

  // Snapshot per pemain: kapal lawan dihilangkan bila tidak ada garis
  // pandang dari kapal pemain itu (co-op: bot; PvP: pemain lain).
  // Kapal yang sedang tenggelam/mati tetap dikirim supaya animasi
  // tenggelam terlihat. Radar (Sloop) dan menyelam (Kapal Selam)
  // ditangani canSee.
  private navalSnapshotFor(
    shipKey: "p1" | "p2",
    events: SimEvent[],
    winnerId: string | null = null,
  ): NavalSnapshot | null {
    const game = this.navalGame;
    const naval = this.state?.naval;
    if (!game || !naval) return null;
    const me = getShip(game, shipKey);
    const foeId =
      naval.mode === "pvp"
        ? shipKey === "p1"
          ? "p2"
          : "p1"
        : NAVAL_BOT_ID;
    const foe = getShip(game, foeId);
    let foeVisible = false;
    if (me && foe) {
      foeVisible = canSee(game, shipKey, foeId);
    }
    const ships: NavalShipSnap[] = [];
    for (const s of game.ships) {
      if (s.id === foeId && !foeVisible) continue;
      ships.push({
        id: s.id,
        defId: s.defId,
        x: s.x,
        z: s.z,
        heading: s.heading,
        speed: s.speed,
        hp: s.hp,
        maxHp: s.maxHp,
        alive: s.alive,
        sinking: s.sinking,
        sinkTime: s.sinkTime,
        heel: s.heel,
        turn: s.turn,
        lastFireAt: s.lastFireAt,
        abilityReadyAt: s.abilityReadyAt,
      });
    }
    // Event tembakan lawan dibuang bila lawan tidak terlihat (posisi
    // muzzle flash akan membocorkan lokasinya).
    const visibleEvents = foeVisible
      ? events
      : events.filter((e) => !(e.type === "fire" && e.shipId === foeId));
    return {
      t: game.time,
      timeLeft: Math.max(0, NAVAL_MATCH_DURATION - game.time),
      winnerId: winnerId ?? game.winnerId,
      ships,
      shells: game.shells
        .filter((s) => s.alive)
        .map((s) => ({ x: s.x, y: s.y, z: s.z })),
      events: visibleEvents,
      foeVisible,
    };
  }

  private broadcastNavalSnapshot(
    events: SimEvent[],
    winnerId: string | null,
  ): void {
    const naval = this.state?.naval;
    if (!naval) return;
    const conns = new Map<string, Connection>();
    for (const c of this.getConnections()) conns.set(c.id, c);
    for (const seat of naval.seats) {
      const player = this.state!.players.find((p) => p.key === seat.key);
      if (!player || !player.connected) continue;
      const conn = conns.get(player.id);
      if (!conn) continue;
      const snap = this.navalSnapshotFor(seat.shipKey, events, winnerId);
      if (snap) this.send(conn, { type: "naval-snapshot", snap });
    }
  }

  private handleNavalInput(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "naval-input" }>,
  ) {
    const naval = this.state?.naval;
    if (!naval || naval.status !== "playing") return;
    const seat = this.navalSeatOf(conn);
    if (!seat) return;
    if (!Number.isFinite(msg.throttle) || !Number.isFinite(msg.rudder)) {
      return;
    }
    // Jepit ke [-1, 1] (client nakal tidak bisa ngebut di luar batas).
    this.navalInputs.set(seat.shipKey, {
      throttle: Math.max(-1, Math.min(1, msg.throttle)),
      rudder: Math.max(-1, Math.min(1, msg.rudder)),
    });
  }

  private handleNavalFire(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "naval-fire" }>,
  ) {
    const naval = this.state?.naval;
    const game = this.navalGame;
    if (!naval || !game || naval.status !== "playing") return;
    const seat = this.navalSeatOf(conn);
    if (!seat) return;
    if (!Number.isFinite(msg.aimX) || !Number.isFinite(msg.aimZ)) return;
    const ship = getShip(game, seat.shipKey);
    if (ship && fireVolley(game, seat.shipKey, msg.aimX, msg.aimZ)) {
      this.navalPendingEvents.push({
        type: "fire",
        shipId: seat.shipKey,
        x: ship.x,
        y: 4,
        z: ship.z,
      });
    }
  }

  private handleNavalAbility(conn: Connection) {
    const naval = this.state?.naval;
    const game = this.navalGame;
    if (!naval || !game || naval.status !== "playing") return;
    const seat = this.navalSeatOf(conn);
    if (!seat) return;
    useAbility(game, seat.shipKey);
  }

  private handleNavalRematch(conn: Connection) {
    const naval = this.state?.naval;
    if (!naval || naval.status !== "over") return;
    const seat = this.navalSeatOf(conn);
    if (!seat) return;
    // Sudah minta: tunggu pemain lain, jangan duplikat.
    if (naval.rematchPendingBy === seat.key) return;
    // Pemain lain sudah minta duluan: rematch jalan, kursi tetap.
    if (naval.rematchPendingBy !== null) {
      naval.gameNumber += 1;
      this.startNavalMatch();
      this.sendAll(this.navalRoomMessage());
      this.sendSystem("Rematch! Match baru dimulai.");
      return;
    }
    naval.rematchPendingBy = seat.key;
    this.persist();
    this.sendAll(this.navalRoomMessage());
    this.sendSystem(`${seat.name} minta rematch.`);
  }

  // Timer forfeit: bila ada kursi yang masih putus setelah tenggang,
  // match yang dijeda berakhir (co-op: bot menang; PvP: pemain yang
  // tersisa menang). Dibatalkan saat semua pemain kembali (rejoin).
  private scheduleNavalForfeit(): void {
    if (this.navalDisconnectTimer) return;
    if (this.state?.naval?.status !== "paused") return;
    this.navalDisconnectTimer = setTimeout(() => {
      this.navalDisconnectTimer = null;
      const naval = this.state?.naval;
      if (!naval) return;
      const goneSeat = naval.seats.find((s) => {
        const p = this.state!.players.find((pl) => pl.key === s.key);
        return !p || !p.connected;
      });
      if (goneSeat && naval.status === "paused") {
        if (naval.mode === "pvp") {
          const winnerSeat = naval.seats.find((s) => s.key !== goneSeat.key);
          this.sendSystem(
            `${goneSeat.name} tidak kembali dalam 60 detik, ${winnerSeat?.name ?? "lawan"} menang (forfeit).`,
          );
          this.endNavalMatch(winnerSeat?.shipKey ?? "p1", [], "forfeit");
        } else {
          this.sendSystem(
            `${goneSeat.name} tidak kembali dalam 60 detik, bot menang (forfeit).`,
          );
          this.endNavalMatch("bot", [], "forfeit");
        }
      }
      // Room kosong total: bersihkan game dari memori.
      if (this.state!.players.every((p) => !p.connected)) {
        this.stopNavalTick();
        this.navalGame = null;
        this.navalBot = null;
      }
    }, NAVAL_DISCONNECT_GRACE_MS);
  }

  // ---------- Katak co-op (2 pemain, oranye + hijau) ----------
  //
  // Server authoritative: sim murni (shared/frog) jalan di DO dengan
  // tick 20 Hz via setInterval (BUKAN alarm, supaya tidak hibernate
  // di tengah match dan tidak membakar invocasi). Tiap tick server =
  // 3 substep sim 60 Hz. Client hanya mengirim input + aksi lidah dan
  // menerima snapshot per tick. Menang = kedua katak sampai portal.
  // Disconnect: match dijeda 60 detik, lalu room bubar (co-op murni,
  // tidak ada forfeit ke bot).

  private frogRoomMessage(): ServerMessage {
    return {
      type: "frog-room",
      room: this.state!.frog!,
      players: this.state!.players,
    };
  }

  // Kursi katak yang dipegang koneksi ini (null bila bukan pemain).
  private frogSeatOf(
    conn: Connection,
  ): FrogRoomState["seats"][number] | null {
    const frog = this.state?.frog;
    if (!frog) return null;
    const key = this.playerKeyOf(conn);
    if (!key) return null;
    return frog.seats.find((s) => s.key === key) ?? null;
  }

  private handleCreateFrog(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "create-frog" }>,
  ) {
    if (this.state) {
      this.send(conn, {
        type: "error",
        message: "Room sudah ada, coba kode lain.",
      });
      return;
    }
    if (!msg.playerKey) {
      this.send(conn, { type: "error", message: "Data room tidak valid." });
      return;
    }
    const name = msg.name.trim().slice(0, 20) || "Pemain";
    // Level dipilih host; id tidak dikenal / bukan level co-op (tanpa
    // spawn2) jatuh ke workshop-coop.
    const def = getLevel(msg.levelId ?? "");
    const levelId = def.spawn2 ? def.id : FROG_LEVEL_ID;
    const player: PlayerState = {
      id: conn.id,
      name,
      color: msg.color,
      cursor: null,
      connected: true,
      lastSeen: Date.now(),
      key: msg.playerKey,
    };
    this.state = {
      code: this.name,
      kind: "frog",
      chess: null,
      naval: null,
      frog: {
        levelId,
        status: "waiting",
        seats: [
          { key: msg.playerKey, name, seatKey: "p1", color: "orange" },
        ],
        winner: null,
        rematchPendingBy: null,
        gameNumber: 1,
      },
      // Field puzzle tidak dipakai di room katak.
      imageUrl: "",
      imageName: "",
      imageW: 0,
      imageH: 0,
      pieceCount: 0,
      seed: 0,
      pieces: [],
      players: [player],
      hostId: conn.id,
      startedAt: Date.now(),
      solvedAt: null,
    };
    this.persist();
    this.send(conn, this.frogRoomMessage());
  }

  private handleJoinFrog(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "join-frog" }>,
  ) {
    if (!this.state || !this.state.frog) {
      this.send(conn, {
        type: "error",
        message: "Room tidak ditemukan, cek kodenya.",
      });
      return;
    }
    if (this.state.kind !== "frog") {
      this.send(conn, {
        type: "error",
        message: "Room ini bukan room katak.",
      });
      return;
    }
    if (!msg.playerKey) {
      this.send(conn, { type: "error", message: "Data room tidak valid." });
      return;
    }
    const frog = this.state.frog;
    const name = msg.name.trim().slice(0, 20) || "Pemain";
    // Rejoin kursi sendiri (refresh/reconnect): key cocok dengan kursi.
    const seat = frog.seats.find((s) => s.key === msg.playerKey);
    if (seat) {
      const existing = this.state.players.find(
        (p) => p.key === msg.playerKey,
      );
      if (existing) {
        existing.id = conn.id;
        existing.name = name;
        existing.color = msg.color;
        existing.connected = true;
        existing.lastSeen = Date.now();
      }
      // Batalkan timer bubar; match yang dijeda dilanjutkan hanya
      // bila SEMUA kursi sudah kembali.
      if (this.frogDisconnectTimer) {
        clearTimeout(this.frogDisconnectTimer);
        this.frogDisconnectTimer = null;
      }
      if (frog.status === "paused" && this.frogGame) {
        const allBack = frog.seats.every((s) => {
          const p = this.state!.players.find((pl) => pl.key === s.key);
          return p?.connected;
        });
        if (allBack) {
          frog.status = "playing";
          this.startFrogTick();
          this.sendSystem(`${name} kembali, match dilanjutkan!`);
        } else {
          this.scheduleFrogAbandon();
        }
      }
      this.persist();
      // Siarkan ke SEMUA pemain (bukan hanya yang rejoin): partner yang
      // menunggu harus tahu match dilanjutkan lagi (banner jeda di
      // layarnya hilang). Tanpa ini partner tetap melihat status paused
      // meski snapshot sudah mengalir lagi.
      this.sendAll(this.frogRoomMessage());
      // Kirim snapshot terakhir supaya client yang rejoin langsung sinkron.
      if (this.frogGame && frog.status === "playing") {
        const snap = this.frogSnapshot([]);
        if (snap) this.send(conn, { type: "frog-snapshot", snap });
      }
      return;
    }
    // Kursi p2 masih kosong: pemain kedua masuk, match dimulai.
    if (frog.seats.length < 2) {
      frog.seats.push({
        key: msg.playerKey,
        name,
        seatKey: "p2",
        color: "green",
      });
      const player: PlayerState = {
        id: conn.id,
        name,
        color: msg.color,
        cursor: null,
        connected: true,
        lastSeen: Date.now(),
        key: msg.playerKey,
      };
      this.state.players.push(player);
      this.sendAll({ type: "player-joined", player }, [conn.id]);
      this.sendSystem(`${name} bergabung, match dimulai!`);
      this.startFrogMatch();
      this.sendAll(this.frogRoomMessage());
      return;
    }
    this.send(conn, {
      type: "error",
      message: "Room katak sudah penuh (2 pemain).",
    });
  }

  // Buat game baru dari kursi yang ada dan mulai tick. Dipakai saat
  // match pertama dan tiap rematch. p1 = oranye (spawn A), p2 = hijau
  // (spawn B). Level dari room (dipilih host, F3).
  private startFrogMatch(): void {
    const frog = this.state?.frog;
    if (!frog) return;
    if (frog.seats.length < 2) return;
    this.frogGame = createCoopGame(getLevel(frog.levelId));
    this.frogInputs.clear();
    this.frogPendingEvents = [];
    this.frogCroakUntil = [0, 0];
    frog.status = "playing";
    frog.winner = null;
    frog.rematchPendingBy = null;
    this.persist();
    this.startFrogTick();
  }

  private startFrogTick(): void {
    this.stopFrogTick();
    this.frogTimer = setInterval(() => this.frogTick(), FROG_TICK_MS);
  }

  private stopFrogTick(): void {
    if (this.frogTimer) {
      clearInterval(this.frogTimer);
      this.frogTimer = null;
    }
  }

  private frogTick(): void {
    const frog = this.state?.frog;
    const game = this.frogGame;
    if (!frog || !game || frog.status !== "playing") {
      this.stopFrogTick();
      return;
    }
    // Input per kursi; lompat hanya dipakai di substep pertama lalu
    // dibersihkan (tepi naik, bukan tahan).
    const inputs: [FrogInput, FrogInput] = [
      this.frogInputs.get("p1") ?? { moveX: 0, moveZ: 0, jump: false },
      this.frogInputs.get("p2") ?? { moveX: 0, moveZ: 0, jump: false },
    ];
    const events: CoopSimEvent[] = [...this.frogPendingEvents];
    this.frogPendingEvents = [];
    for (let s = 0; s < FROG_SUBSTEPS; s++) {
      events.push(
        ...stepCoop(
          game,
          s === 0
            ? inputs
            : ([
                { ...inputs[0], jump: false },
                { ...inputs[1], jump: false },
              ] as [FrogInput, FrogInput]),
          FROG_TICK_DT,
        ),
      );
      if (game.won) break;
    }
    // Bersihkan flag lompat yang sudah dipakai (bila ada input tersimpan).
    const in1 = this.frogInputs.get("p1");
    if (in1) in1.jump = false;
    const in2 = this.frogInputs.get("p2");
    if (in2) in2.jump = false;
    if (game.won) {
      this.endFrogMatch("players", events);
      return;
    }
    this.broadcastFrogSnapshot(events);
  }

  private endFrogMatch(
    winner: "players" | "abandoned",
    events: CoopSimEvent[],
  ): void {
    const frog = this.state?.frog;
    if (!frog) return;
    this.stopFrogTick();
    frog.status = "over";
    frog.winner = winner;
    this.persist();
    // Snapshot terakhir membawa status menang (won=true).
    this.broadcastFrogSnapshot(events);
    this.sendAll(this.frogRoomMessage());
    if (winner === "players") {
      this.sendSystem("Kalian menang! Kedua katak sampai portal.");
    }
  }

  private frogSnapshot(events: CoopSimEvent[]): FrogSnapshot | null {
    const game = this.frogGame;
    if (!game) return null;
    return {
      t: game.time,
      frogs: [0, 1].map((i) => {
        const f = game.frogs[i as 0 | 1];
        const t = game.tongues[i as 0 | 1];
        return {
          x: f.pos.x,
          y: f.pos.y,
          z: f.pos.z,
          vx: f.vel.x,
          vy: f.vel.y,
          vz: f.vel.z,
          facing: f.facing,
          onGround: f.onGround,
          tongue: {
            mode: t.mode,
            ax: t.anchor?.x ?? 0,
            ay: t.anchor?.y ?? 0,
            az: t.anchor?.z ?? 0,
            anchorFrog: t.anchorFrog,
            lick: t.lick,
          },
        };
      }) as FrogSnapshot["frogs"],
      fliesGot: [...game.fliesGot],
      ringsHit: [...game.ringsHit],
      orbsGot: [...game.orbsGot],
      coinsGot: [...game.coinsGot],
      usedAnchors: [...game.usedAnchors],
      buttonDown: game.buttonDown,
      doorOpen: game.doorOpen,
      pullProgress: { ...game.pullProgress },
      atGoal: [...game.atGoal] as [boolean, boolean],
      won: game.won,
      croakUntil: [...this.frogCroakUntil] as [number, number],
      events,
    };
  }

  private broadcastFrogSnapshot(events: CoopSimEvent[]): void {
    const frog = this.state?.frog;
    if (!frog) return;
    const snap = this.frogSnapshot(events);
    if (!snap) return;
    const conns = new Map<string, Connection>();
    for (const c of this.getConnections()) conns.set(c.id, c);
    for (const seat of frog.seats) {
      const player = this.state!.players.find((p) => p.key === seat.key);
      if (!player || !player.connected) continue;
      const conn = conns.get(player.id);
      if (conn) this.send(conn, { type: "frog-snapshot", snap });
    }
  }

  private handleFrogInput(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "frog-input" }>,
  ) {
    const frog = this.state?.frog;
    if (!frog || frog.status !== "playing") return;
    const seat = this.frogSeatOf(conn);
    if (!seat) return;
    if (!Number.isFinite(msg.moveX) || !Number.isFinite(msg.moveZ)) return;
    // Jepit ke [-1, 1] (client nakal tidak bisa ngebut di luar batas).
    this.frogInputs.set(seat.seatKey, {
      moveX: Math.max(-1, Math.min(1, msg.moveX)),
      moveZ: Math.max(-1, Math.min(1, msg.moveZ)),
      jump: msg.jump === true,
    });
  }

  private handleFrogFire(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "frog-fire" }>,
  ) {
    const frog = this.state?.frog;
    const game = this.frogGame;
    if (!frog || !game || frog.status !== "playing") return;
    const seat = this.frogSeatOf(conn);
    if (!seat) return;
    const nums = [msg.ox, msg.oy, msg.oz, msg.dx, msg.dy, msg.dz];
    if (!nums.every((n) => Number.isFinite(n))) return;
    const dl = Math.hypot(msg.dx, msg.dy, msg.dz);
    if (dl < 1e-6) return;
    const idx = (seat.seatKey === "p1" ? 0 : 1) as 0 | 1;
    const ok = tryFireCoop(
      game,
      idx,
      { x: msg.ox, y: msg.oy, z: msg.oz },
      { x: msg.dx / dl, y: msg.dy / dl, z: msg.dz / dl },
      msg.lick === true,
    );
    if (ok) {
      this.frogPendingEvents.push({
        type: "tongue-fire",
        anchorId: game.tongues[idx].anchorId ?? "",
        frog: idx,
      });
    }
  }

  private handleFrogRelease(conn: Connection) {
    const frog = this.state?.frog;
    const game = this.frogGame;
    if (!frog || !game || frog.status !== "playing") return;
    const seat = this.frogSeatOf(conn);
    if (!seat) return;
    const idx = (seat.seatKey === "p1" ? 0 : 1) as 0 | 1;
    if (releaseTongueCoop(game, idx)) {
      this.frogPendingEvents.push({ type: "tongue-release", frog: idx });
    }
  }

  private handleFrogCroak(conn: Connection) {
    const frog = this.state?.frog;
    const game = this.frogGame;
    if (!frog || !game || frog.status !== "playing") return;
    const seat = this.frogSeatOf(conn);
    if (!seat) return;
    const idx = seat.seatKey === "p1" ? 0 : 1;
    this.frogCroakUntil[idx] = game.time + FROG_CROAK_DURATION;
  }

  private handleFrogRematch(conn: Connection) {
    const frog = this.state?.frog;
    if (!frog || frog.status !== "over") return;
    const seat = this.frogSeatOf(conn);
    if (!seat) return;
    // Sudah minta: tunggu pemain lain, jangan duplikat.
    if (frog.rematchPendingBy === seat.key) return;
    // Pemain lain sudah minta duluan: rematch jalan, kursi tetap.
    if (frog.rematchPendingBy !== null) {
      frog.gameNumber += 1;
      this.startFrogMatch();
      this.sendAll(this.frogRoomMessage());
      this.sendSystem("Rematch! Match baru dimulai.");
      return;
    }
    frog.rematchPendingBy = seat.key;
    this.persist();
    this.sendAll(this.frogRoomMessage());
    this.sendSystem(`${seat.name} minta rematch.`);
  }

  // Level berikutnya (F3): hanya host (p1), hanya dari layar menang.
  // Room pindah ke level berikutnya di pack, match baru langsung mulai
  // (tamu mengikuti, tanpa persetujuan).
  private handleFrogNextLevel(conn: Connection) {
    const frog = this.state?.frog;
    if (!frog || frog.status !== "over") return;
    const seat = this.frogSeatOf(conn);
    if (!seat || seat.seatKey !== "p1") return;
    const idx = LEVEL_PACK.findIndex((m) => m.coopId === frog.levelId);
    if (idx < 0 || idx + 1 >= LEVEL_PACK.length) return;
    const next = LEVEL_PACK[idx + 1]!;
    frog.levelId = next.coopId;
    frog.gameNumber += 1;
    this.startFrogMatch();
    this.sendAll(this.frogRoomMessage());
    this.sendSystem(`Level berikutnya: ${next.name}!`);
  }

  // Timer bubar: bila ada kursi yang masih putus setelah tenggang,
  // match yang dijeda berakhir (room bubar, tidak ada pemenang).
  // Dibatalkan saat semua pemain kembali (rejoin).
  private scheduleFrogAbandon(): void {
    if (this.frogDisconnectTimer) return;
    if (this.state?.frog?.status !== "paused") return;
    this.frogDisconnectTimer = setTimeout(() => {
      this.frogDisconnectTimer = null;
      const frog = this.state?.frog;
      if (!frog) return;
      const goneSeat = frog.seats.find((s) => {
        const p = this.state!.players.find((pl) => pl.key === s.key);
        return !p || !p.connected;
      });
      if (goneSeat && frog.status === "paused") {
        this.sendSystem(
          `${goneSeat.name} tidak kembali dalam 60 detik, match bubar.`,
        );
        this.endFrogMatch("abandoned", []);
      }
      // Room kosong total: bersihkan game dari memori.
      if (this.state!.players.every((p) => !p.connected)) {
        this.stopFrogTick();
        this.frogGame = null;
      }
    }, FROG_DISCONNECT_GRACE_MS);
  }

  async onClose(conn: Connection) {
    await this.ensureLoaded();
    if (!this.state) return;
    const idx = this.state.players.findIndex((p) => p.id === conn.id);
    if (idx === -1) return;
    const name = this.state.players[idx]!.name;
    // Room catur: kursi diikat ke playerKey, jadi pemain yang putus
    // (refresh/jaringan) tidak dihapus, hanya ditandai terputus.
    // Rejoin dengan key yang sama menghidupkan lagi entrinya, dan
    // game-nya tetap menunggu di state. Siarkan state penuh supaya
    // lawan melihat status terputus.
    if (this.state.kind === "chess") {
      this.state.players[idx]!.connected = false;
      this.state.players[idx]!.cursor = null;
      this.persist();
      this.sendAll(this.stateMessage());
      this.sendSystem(`${name} terputus`);
      this.lastChatAt.delete(conn.id);
      return;
    }
    // Room naval: kursi diikat ke playerKey, pemain yang putus hanya
    // ditandai terputus. Match yang sedang jalan DIJEDA (tick berhenti)
    // dan dilanjutkan saat pemain reconnect; bila tidak kembali dalam
    // 60 detik, match berakhir forfeit (co-op: bot menang; PvP: pemain
    // yang tersisa menang).
    if (this.state.kind === "naval" && this.state.naval) {
      const naval = this.state.naval;
      this.state.players[idx]!.connected = false;
      this.state.players[idx]!.cursor = null;
      if (naval.status === "playing") {
        naval.status = "paused";
        this.stopNavalTick();
        this.sendSystem(`${name} terputus, match dijeda (60 detik).`);
      } else {
        this.sendSystem(`${name} terputus`);
      }
      this.persist();
      this.sendAll(this.navalRoomMessage());
      // Timer forfeit (satu saja, meski dua pemain putus berurutan).
      if (naval.status === "paused") this.scheduleNavalForfeit();
      this.lastChatAt.delete(conn.id);
      return;
    }
    // Room katak: sama seperti naval (kursi diikat ke playerKey,
    // match dijeda saat putus), tapi bila tidak kembali dalam 60 detik
    // room BUBAR (co-op murni, tidak ada forfeit ke bot).
    if (this.state.kind === "frog" && this.state.frog) {
      const frog = this.state.frog;
      this.state.players[idx]!.connected = false;
      this.state.players[idx]!.cursor = null;
      if (frog.status === "playing") {
        frog.status = "paused";
        this.stopFrogTick();
        this.sendSystem(`${name} terputus, match dijeda (60 detik).`);
      } else {
        this.sendSystem(`${name} terputus`);
      }
      this.persist();
      this.sendAll(this.frogRoomMessage());
      if (frog.status === "paused") this.scheduleFrogAbandon();
      this.lastChatAt.delete(conn.id);
      return;
    }
    this.state.players.splice(idx, 1);
    // Lepas semua lock yang dipegang pemain ini.
    for (const piece of this.state.pieces) {
      if (piece.lockedBy === conn.id) {
        piece.lockedBy = null;
        piece.lockedAt = null;
        this.sendAll({
          type: "piece-locked",
          pieceId: piece.id,
          playerId: null,
        });
      }
    }
    this.persist();
    this.sendAll({ type: "player-left", playerId: conn.id });
    this.sendSystem(`${name} keluar`);
    this.lastChatAt.delete(conn.id);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Preflight CORS untuk upload dari Pages (origin berbeda).
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (url.pathname === "/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }
    if (url.pathname.startsWith("/images/") && request.method === "GET") {
      const key = url.pathname.slice("/images/".length);
      // Cegah path traversal: key hanya boleh img/<uuid>.<ext>.
      if (!/^img\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(key)) {
        return new Response("Gambar tidak ditemukan.", {
          status: 404,
          headers: CORS_HEADERS,
        });
      }
      return handleImage(key, env);
    }
    return (
      (await routePartykitRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;

// Upload gambar (M4): client mengompres dulu (< 500 KB), server
// menerima maks 1 MB dan menyimpannya ke Workers KV. Gambar disajikan
// lewat GET /images/:key dari Worker yang sama (tanpa public bucket).
// Catatan: rencana awal pakai R2, tapi R2 belum aktif di akun Zaky
// (butuh enable lewat dashboard + billing, ditolak Zaky untuk proyek
// Sabun Palem); KV dibuat lewat CLI saja dan gratis untuk skala ini.

// Batas upload server: 1 MB (client menargetkan < 500 KB).
const MAX_UPLOAD_BYTES = 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function extFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.startsWith("image/")) {
    return Response.json(
      { error: "File harus berupa gambar." },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: "Ukuran gambar maksimal 1 MB." },
      { status: 413, headers: CORS_HEADERS },
    );
  }
  const key = `img/${crypto.randomUUID()}.${extFor(contentType)}`;
  await env.IMAGES.put(key, buf, {
    metadata: { contentType },
  });
  const origin = new URL(request.url).origin;
  return Response.json(
    { url: `${origin}/images/${key}` },
    { headers: CORS_HEADERS },
  );
}

async function handleImage(key: string, env: Env): Promise<Response> {
  const { value, metadata } = await env.IMAGES.getWithMetadata<{
    contentType: string;
  }>(key, "arrayBuffer");
  if (!value) {
    return new Response("Gambar tidak ditemukan.", {
      status: 404,
      headers: CORS_HEADERS,
    });
  }
  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", metadata?.contentType ?? "image/jpeg");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(value, { headers });
}
