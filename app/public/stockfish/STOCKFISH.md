# Stockfish di miniGame

File `stockfish-19-single.js` (28 KB) adalah loader Emscripten dari
**Stockfish.js 19.0.1** (Stockfish 19 FULL single-threaded) oleh
Nathan Rugg / Chess.com, dari paket npm `stockfish@19.0.1`
(https://github.com/nmrugg/stockfish.js). Lisensi **GPLv3** (lihat
header di dalam file). File ini di-vendor langsung ke repo (bukan
lewat npm) supaya `node_modules` tidak membengkak 200 MB hanya untuk
satu file 28 KB; saat update versi, ganti file ini + sesuaikan URL
.wasm di `src/games/chess/lib/engine.ts`.

File `.wasm` full (~99 MB) TIDAK ada di repo dan TIDAK dibundel ke
deploy Pages (batas 25 MB/file). .wasm di-load saat runtime dari CDN
unpkg saat user masuk mode catur, lewat URL yang diselipkan di hash
URL worker (mekanisme resmi stockfish.js). Detail pemilihan CDN ada
di `src/games/chess/lib/engine.ts`.

Atribusi lain di modul catur:
- Aturan: chess.js 1.4.0 (BSD-2-Clause), via npm.
- Bidak: set cburnett (CC BY-SA 3.0), dari lichess lila, di
  `public/pieces/`.
