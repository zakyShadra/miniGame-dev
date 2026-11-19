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
  PieceState,
  PlayerState,
  RoomState,
} from "../../shared/types";
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

export class Room extends Server<Env> {
  private state: RoomState | null = null;
  private cut: CutResult | null = null;
  private layout: BoardLayout | null = null;
  private loaded: Promise<void> | null = null;
  private lastPersist = 0;
  // Throttle chat per pemain (anti spam): pesan terakhir per conn id.
  private lastChatAt = new Map<string, number>();

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
            // Normalisasi room naval: state lama belum punya naval.
            this.state.naval ??= null;
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
