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
  IMAGES: R2Bucket;
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
      }
    }
    this.persist();
    this.sendAll(this.stateMessage());
    this.sendSystem(`${player.name} merapikan piece`);
  }

  async onClose(conn: Connection) {
    await this.ensureLoaded();
    if (!this.state) return;
    const idx = this.state.players.findIndex((p) => p.id === conn.id);
    if (idx === -1) return;
    const name = this.state.players[idx]!.name;
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
// menerima maks 1 MB dan menyimpannya ke R2. Gambar disajikan lewat
// GET /images/:key dari Worker yang sama (tanpa public bucket).

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
    httpMetadata: { contentType },
  });
  const origin = new URL(request.url).origin;
  return Response.json(
    { url: `${origin}/images/${key}` },
    { headers: CORS_HEADERS },
  );
}

async function handleImage(key: string, env: Env): Promise<Response> {
  const obj = await env.IMAGES.get(key);
  if (!obj) {
    return new Response("Gambar tidak ditemukan.", {
      status: 404,
      headers: CORS_HEADERS,
    });
  }
  const headers = new Headers(CORS_HEADERS);
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers });
}
