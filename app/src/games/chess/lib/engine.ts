// Manajer engine Stockfish 19 FULL single-threaded (Web Worker + UCI).
//
// Arsitektur file:
// - Loader .js (28 KB) dibundel lokal di public/stockfish/.
// - File .wasm full (~99 MB) TIDAK dibundel: Pages membatasi 25 MB/file.
//   .wasm di-load saat runtime dari CDN unpkg. unpkg dipilih karena
//   mengirim CORS `Access-Control-Allow-Origin: *` dan MIME
//   application/wasm (wajib buat instantiateStreaming). GitHub release
//   TIDAK mengirim header CORS dan MIME-nya octet-stream (gagal di
//   browser); jsdelivr menolak file 99 MB (403); esm.sh 404. Jadi
//   unpkg satu-satunya CDN yang berfungsi, sudah diverifikasi empiris
//   di browser nyata.
// - Caching: HTTP cache TIDAK menyimpan file 99 MB ini (diverifikasi
//   empiris: fetch ke-2 tetap download penuh 22 detik). Karena itu
//   .wasm disimpan eksplisit ke Cache Storage setelah download pertama
//   (dengan cek ukuran 99.169.054 byte), dan load berikutnya memakai
//   blob URL dari cache. Kalau Cache Storage tidak tersedia, fallback
//   ke URL CDN langsung (download ulang tiap load, tapi tetap jalan).
// - URL .wasm (blob atau CDN) diselipkan di hash URL worker (mekanisme
//   resmi stockfish.js: loader membaca self.location.hash).
// - Progress download diukur sendiri saat fetch (ReadableStream),
//   karena progress bawaan loader hanya jalan saat loader yang fetch.
//
// Lisensi: Stockfish.js GPLv3, lihat public/stockfish/STOCKFISH.md.

export const STOCKFISH_WASM_URL =
  "https://unpkg.com/stockfish@19.0.1/bin/stockfish-19-single.wasm";

// Ukuran pasti stockfish-19-single.wasm (byte), buat cek integritas cache.
export const STOCKFISH_WASM_SIZE = 99169054;

const CACHE_NAME = "minigame-stockfish-v1";

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface EngineProgress {
  percent: number;
  loaded: number;
  total: number;
  speedText: string;
  etaText: string;
}

// Skor dari engine, relatif terhadap giliran jalan di posisi itu.
export interface EngineScore {
  type: "cp" | "mate";
  value: number;
}

export interface GoResult {
  bestMove: string;
  // Skor + PV per multipv (indeks 0 = PV utama).
  lines: { score: EngineScore; pv: string[] }[];
}

interface PendingGo {
  resolve: (r: GoResult) => void;
  reject: (e: Error) => void;
  multiPv: number;
  lines: Map<number, { score: EngineScore; pv: string[] }>;
}

const LOAD_TIMEOUT_MS = 10 * 60 * 1000;

export class StockfishEngine {
  status: EngineStatus = "idle";
  progress: EngineProgress | null = null;
  onProgress: ((p: EngineProgress) => void) | null = null;
  onStatusChange: ((s: EngineStatus) => void) | null = null;

  private worker: Worker | null = null;
  private loadPromise: Promise<void> | null = null;
  private pendingGo: PendingGo | null = null;
  private readyWaiters: Array<() => void> = [];
  private uciokSeen = false;
  private wasmBlobUrl: string | null = null;

  private setStatus(s: EngineStatus) {
    this.status = s;
    this.onStatusChange?.(s);
  }

  // Cari .wasm di Cache Storage; kalau tidak ada, download dengan
  // progress lalu simpan. Mengembalikan blob URL (atau URL CDN kalau
  // Cache Storage tidak tersedia). Error download dilempar ke pemanggil.
  private async resolveWasmUrl(): Promise<string> {
    const report = (loaded: number, total: number, t0: number) => {
      const secs = Math.max((performance.now() - t0) / 1000, 0.1);
      const speed = loaded / secs;
      const speedText =
        speed < 1048576
          ? `${(speed / 1024).toFixed(0)} KB/s`
          : `${(speed / 1048576).toFixed(1)} MB/s`;
      const eta =
        speed > 0 ? Math.max(Math.ceil((total - loaded) / speed), 0) : 0;
      const p: EngineProgress = {
        percent: total > 0 ? loaded / total : 0,
        loaded,
        total,
        speedText,
        etaText: eta > 0 ? `${eta} detik` : "",
      };
      this.progress = p;
      this.onProgress?.(p);
    };

    let cache: Cache | null = null;
    try {
      cache = await caches.open(CACHE_NAME);
    } catch {
      cache = null;
    }
    if (cache) {
      try {
        const hit = await cache.match(STOCKFISH_WASM_URL);
        if (hit) {
          const blob = await hit.blob();
          if (blob.size === STOCKFISH_WASM_SIZE) {
            return URL.createObjectURL(
              new Blob([blob], { type: "application/wasm" }),
            );
          }
          // Entri rusak (ukuran tidak cocok): hapus, download ulang.
          await cache.delete(STOCKFISH_WASM_URL);
        }
      } catch {
        // Cache rusak: lanjut download seperti biasa.
      }
    }

    const res = await fetch(STOCKFISH_WASM_URL);
    if (!res.ok || !res.body) {
      throw new Error(`Download engine gagal (HTTP ${res.status}).`);
    }
    const total = Number(res.headers.get("content-length")) || STOCKFISH_WASM_SIZE;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const t0 = performance.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      report(loaded, total, t0);
    }
    const blob = new Blob(chunks as BlobPart[], { type: "application/wasm" });
    if (blob.size !== STOCKFISH_WASM_SIZE) {
      throw new Error("Ukuran engine tidak sesuai, download mungkin rusak.");
    }
    if (cache) {
      try {
        await cache.put(
          STOCKFISH_WASM_URL,
          new Response(blob, {
            headers: { "Content-Type": "application/wasm" },
          }),
        );
      } catch {
        // Kuota penuh: lanjut tanpa cache.
      }
    }
    return URL.createObjectURL(blob);
  }

  // Buat worker + handshake UCI. Aman dipanggil berkali-kali (sekali load).
  load(): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      this.setStatus("loading");
      const wasmUrl = await this.resolveWasmUrl();
      this.wasmBlobUrl = wasmUrl.startsWith("blob:") ? wasmUrl : null;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.setStatus("error");
          reject(new Error("Engine timeout (10 menit). Cek koneksi internet."));
        }, LOAD_TIMEOUT_MS);

        const worker = new Worker(
          `/stockfish/stockfish-19-single.js#${encodeURIComponent(wasmUrl)}`,
        );
        this.worker = worker;

        // Port khusus buat progress download .wasm versi loader. Tidak
        // terpakai saat URL blob (fetch instan), tapi tetap dipasang.
        const channel = new MessageChannel();
        channel.port1.onmessage = (e: MessageEvent<EngineProgress>) => {
          this.progress = e.data;
          this.onProgress?.(e.data);
        };
        worker.postMessage({ progressPort: channel.port2 }, [channel.port2]);

        worker.onmessage = (e: MessageEvent) => {
          const line = e.data;
          if (typeof line !== "string") return;
          if (line === "uciok" && !this.uciokSeen) {
            this.uciokSeen = true;
            worker.postMessage("isready");
            return;
          }
          if (line === "readyok") {
            clearTimeout(timeout);
            // Worker sudah fetch + compile .wasm; blob URL boleh dilepas.
            if (this.wasmBlobUrl) {
              URL.revokeObjectURL(this.wasmBlobUrl);
              this.wasmBlobUrl = null;
            }
            this.setStatus("ready");
            this.readyWaiters.splice(0).forEach((w) => w());
            resolve();
            return;
          }
          if (line.startsWith("bestmove")) {
            this.handleBestmove(line);
            return;
          }
          if (line.startsWith("info") && this.pendingGo) {
            this.handleInfo(line);
          }
        };
        worker.onerror = (e) => {
          clearTimeout(timeout);
          this.setStatus("error");
          reject(new Error(`Worker engine error: ${e.message}`));
        };
        worker.postMessage("uci");
      });
    })();
    return this.loadPromise;
  }

  private handleBestmove(line: string) {
    const pending = this.pendingGo;
    if (!pending) return;
    this.pendingGo = null;
    const m = /^bestmove (\S+)/.exec(line);
    if (!m) {
      pending.reject(new Error("bestmove tidak bisa diparse: " + line));
      return;
    }
    const lines = Array.from(pending.lines.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);
    pending.resolve({ bestMove: m[1]!, lines });
  }

  private handleInfo(line: string) {
    const pending = this.pendingGo;
    if (!pending) return;
    // Contoh: info depth 12 seldepth 18 multipv 1 score cp 34 ... pv e2e4 ...
    // atau: info depth 12 ... score mate 3 ... pv ...
    const multiPv = Number(/multipv (\d+)/.exec(line)?.[1] ?? 1);
    const cp = /score cp (-?\d+)/.exec(line);
    const mate = /score mate (-?\d+)/.exec(line);
    const pv = / pv (.+)$/.exec(line)?.[1]?.trim().split(/\s+/) ?? [];
    let score: EngineScore | null = null;
    if (cp) score = { type: "cp", value: Number(cp[1]) };
    else if (mate) score = { type: "mate", value: Number(mate[1]) };
    if (!score) return;
    // Hanya simpan info depth terdalam per multipv (info datang berurutan,
    // jadi timpa saja: yang terakhir = depth tertinggi).
    pending.lines.set(multiPv, { score, pv });
  }

  private send(cmd: string) {
    if (!this.worker) throw new Error("Engine belum di-load.");
    this.worker.postMessage(cmd);
  }

  setOption(name: string, value: string | number) {
    this.send(`setoption name ${name} value ${value}`);
  }

  // Minta langkah terbaik di posisi FEN. Satu go dalam satu waktu.
  async go(
    fen: string,
    opts: {
      depth?: number;
      movetimeMs?: number;
      multiPv?: number;
      skill?: number;
    },
  ): Promise<GoResult> {
    await this.load();
    if (this.pendingGo) throw new Error("Engine sedang berpikir.");
    const multiPv = opts.multiPv ?? 1;
    if (opts.skill !== undefined) {
      this.setOption("Skill Level", opts.skill);
    }
    this.setOption("MultiPV", multiPv);
    const result = new Promise<GoResult>((resolve, reject) => {
      this.pendingGo = {
        resolve,
        reject,
        multiPv,
        lines: new Map(),
      };
    });
    this.send("ucinewgame");
    this.send(`position fen ${fen}`);
    const parts = ["go"];
    if (opts.depth !== undefined) parts.push(`depth ${opts.depth}`);
    if (opts.movetimeMs !== undefined) parts.push(`movetime ${opts.movetimeMs}`);
    this.send(parts.join(" "));
    return result;
  }

  // Evaluasi cepat satu posisi (buat eval bar live). Depth rendah.
  async evaluate(fen: string, depth = 7): Promise<EngineScore | null> {
    const r = await this.go(fen, { depth, multiPv: 1, skill: 20 });
    return r.lines[0]?.score ?? null;
  }

  stop() {
    if (this.pendingGo) {
      this.pendingGo.reject(new Error("Dibatalkan."));
      this.pendingGo = null;
    }
    try {
      this.send("stop");
    } catch {
      // Engine belum jalan, abaikan.
    }
  }

  quit() {
    try {
      this.send("quit");
    } catch {
      // Abaikan.
    }
    this.worker?.terminate();
    this.worker = null;
    this.status = "idle";
    this.loadPromise = null;
    this.pendingGo = null;
    this.uciokSeen = false;
  }
}

// Satu engine untuk seluruh app (worker berat, jangan dibuat ganda).
export const stockfish = new StockfishEngine();
