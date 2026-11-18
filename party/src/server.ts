import { routePartykitRequest, Server } from "partyserver";
import type { Connection } from "partyserver";

type Env = {
  Room: DurableObjectNamespace<Room>;
};

// Satu room = satu Durable Object. Nama room = kode 6 karakter (M2).
// State disimpan di SQLite DO supaya refresh tidak menghilangkan progres (M2).
export class Room extends Server<Env> {
  onConnect(conn: Connection) {
    // M2: kirim state room ke pemain baru + broadcast presence.
    conn.send(JSON.stringify({ type: "hello", id: conn.id }));
  }

  onMessage(_conn: Connection, _message: string | ArrayBuffer) {
    // M2: validasi aksi, terapkan ke state, broadcast ke room.
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
