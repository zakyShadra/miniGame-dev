// PartyServer Room: satu room = satu Durable Object (nama = kode room).
// Server memegang state piece secara authoritative: posisi, lock, snap,
// dan deteksi menang. State disimpan di SQLite DO supaya refresh atau
// rejoin tidak menghilangkan progres.

import { routePartykitRequest, Server } from "partyserver";
import type { Connection } from "partyserver";
import type { ClientMessage, ServerMessage } from "../../shared/protocol";
import type { PieceState, PlayerState, RoomState } from "../../shared/types";
import { cutPuzzle, type CutResult } from "../../shared/game/cutter";
import {
  computeLayout,
  isSolved,
  LOGICAL_BOARD_H,
  LOGICAL_BOARD_W,
  scatterPieces,
  snapTolerance,
  trySnap,
  type BoardLayout,
} from "../../shared/game/engine";
import { mulberry32 } from "../../shared/game/prng";

type Env = {
  Room: DurableObjectNamespace<Room>;
};

export class Room extends Server<Env> {
  private state: RoomState | null = null;
  private cut: CutResult | null = null;
  private layout: BoardLayout | null = null;
  private loaded: Promise<void> | null = null;
  private lastPersist = 0;

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
  private deriveGame() {
    if (!this.state) {
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
      default:
        break; // chat: M3
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
    };
    this.state = {
      code: this.name,
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
    this.send(conn, { type: "state", state: this.state });
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
    const existing = this.state.players.find((p) => p.id === conn.id);
    if (existing) {
      existing.name = msg.name.trim().slice(0, 20) || existing.name;
      existing.color = msg.color;
      existing.connected = true;
      existing.lastSeen = Date.now();
    } else {
      const player: PlayerState = {
        id: conn.id,
        name: msg.name.trim().slice(0, 20) || "Pemain",
        color: msg.color,
        cursor: null,
        connected: true,
        lastSeen: Date.now(),
      };
      this.state.players.push(player);
      this.sendAll({ type: "player-joined", player }, [conn.id]);
    }
    this.persist();
    this.send(conn, { type: "state", state: this.state });
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
    if (
      !piece ||
      piece.placed ||
      (piece.lockedBy && piece.lockedBy !== conn.id)
    ) {
      this.send(conn, { type: "grab-denied", pieceId: msg.pieceId });
      return;
    }
    piece.lockedBy = conn.id;
    piece.lockedAt = Date.now();
    this.sendAll({
      type: "piece-locked",
      pieceId: piece.id,
      playerId: conn.id,
    });
  }

  private handleMove(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "move" }>,
  ) {
    const piece = this.findPiece(msg.pieceId);
    if (!piece || piece.placed || piece.lockedBy !== conn.id) return;
    piece.x = msg.x;
    piece.y = msg.y;
    this.sendAll({ type: "piece-moved", piece }, [conn.id]);
    this.maybePersist();
  }

  private handleDrop(
    conn: Connection,
    msg: Extract<ClientMessage, { type: "drop" }>,
  ) {
    const piece = this.findPiece(msg.pieceId);
    if (!piece || piece.lockedBy !== conn.id) return;
    piece.x = msg.x;
    piece.y = msg.y;
    piece.lockedBy = null;
    piece.lockedAt = null;
    const spec = this.cut?.pieces.find((s) => s.id === piece.id);
    if (spec && this.layout && this.cut && !piece.placed) {
      trySnap(piece, spec, this.layout, snapTolerance(this.cut, this.layout));
    }
    this.persist();
    this.sendAll({ type: "piece-moved", piece });
    if (
      this.state &&
      isSolved(this.state.pieces) &&
      !this.state.solvedAt
    ) {
      this.state.solvedAt = Date.now();
      this.persist();
      this.sendAll({ type: "solved", at: this.state.solvedAt });
    }
  }

  async onClose(conn: Connection) {
    await this.ensureLoaded();
    if (!this.state) return;
    const idx = this.state.players.findIndex((p) => p.id === conn.id);
    if (idx === -1) return;
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
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
