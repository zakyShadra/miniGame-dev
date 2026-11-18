# Puzzle Game - ROADMAP (contekan milestone)

> Game jigsaw puzzle multiplayer di web, buat main bareng (Zaky + Dindha).
> Referensi: reel Instagram @oftwominds._ (jigsawplanet.com + Google Meet di pojok,
> puzzle sunset pantai, lalu collage kartun, lalu toko "CANDY SHOPPE").
> File ini sumber kebenaran buat lanjutan sesi: baca dulu sebelum kerja,
> update checklist tiap milestone selesai.

## Status

| Milestone | Status | Selesai | Catatan |
| --- | --- | --- | --- |
| M0 Scaffold dan tooling | ✅ selesai | 2026-11-18 | Scaffold + build + wrangler dev terverifikasi; 8 commit di-push |
| M1 Mesin jigsaw (single player) | ✅ selesai | 2026-11-18 | Mesin jigsaw + board + lobby terverifikasi (screenshot QA); 6 commit di-push |
| M2 Room dan realtime multiplayer | ✅ selesai | 2026-11-18 | PartyServer + DO SQLite; tes integrasi 22/22 lolos (lokal + workers.dev); live di puzzle-game-avl.pages.dev; 5 commit di-push |
| M3 Chat dan polish UX | ✅ selesai | 2026-11-18 | Chat + pesan sistem, timer via jam server, Rapikan, suara snap + mute, rail responsif; tes integrasi 14/14 (lokal + live); audit di docs/ui-audit-m3.md; 11 commit di-push |
| M4 Galeri dan upload gambar | ✅ selesai | 2026-11-18 | 6 preset, upload + kompres client, gambar di KV (bukan R2), ganti gambar host, piece custom 12-500 + pembulatan grid; tes WS 10/10 + cutter 14/14 (lokal + live); 8 commit di-push |
| M5 Piece grouping | ✅ selesai | 2026-11-18 | Grouping drop-only + snap grup, server authoritative; tes unit 15/15, WS 15/15 (lokal + live), QA browser 3/3 + screenshot; 6 commit di-push |
| M6 Deploy, share, CV | ⏳ belum mulai | - | - |

Legenda: ⏳ belum mulai, 🔨 jalan, ✅ selesai.

## Keputusan yang sudah dikunci (2026-11-18)

- Lokasi: `/home/ice/Projects/puzzle-game` di laptop (pakai strip, bukan spasi,
  biar gampang di command line; Zaky bilang "~/Projects/puzzle game").
- Repo GitHub: `github.com/zakyShadra/puzzleGame` (public, dibuat 2026-11-18).
- Frontend: Vue 3 (`<script setup>`) + Vite + TypeScript + Tailwind CSS + Pinia.
- Board: Canvas 2D (bukan DOM per piece, bukan Three.js/Phaser) biar enteng
  di laptop kentang (Zaky dan Dindha sama-sama low-spec).
- Multiplayer: PartyServer di Cloudflare Workers + Durable Objects (SQLite),
  client pakai partysocket. PartyKit hosted SUDAH TUTUP 23 Okt 2026, jangan
  pakai PartyKit lagi, penerusnya PartyServer.
- Gambar: galeri preset + upload foto sendiri ke R2 (M4).
- Hosting: Cloudflare Pages (frontend) + Workers (PartyServer). Semua free
  tier, tanpa VPS, tanpa server yang harus nyala terus.
- Room: tanpa login, cukup nickname + warna cursor. Join via kode 6 huruf
  atau link share. 1 room = 1 Durable Object.
- Video call: TIDAK dibangun. Pakai Google Meet / WA call terpisah,
  persis seperti di reel.
- Desain: DESIGN.md dari design-md-studio dulu sebelum bangun UI
  (aturan studio, berlaku untuk semua yang visual).
- Bahasa UI: Bahasa Indonesia kasual. Kode dan komentar: Inggris seperlunya.
- Alasan stack (buat CV): Cloudflare Workers + Durable Objects + WebSocket
  adalah keyword hiring yang nyata; Convex/Liveblocks bagus buat demo tapi
  jarang muncul di loker. Vue dipilih karena combo standar dengan Laravel
  (proyek koperasi MBG Zaky), dan Zaky sudah punya React jadi kombinasinya
  "Vue + React".

## Struktur folder target

```text
puzzle-game/
  ROADMAP.md          # file ini, contekan milestone
  README.md           # cara jalanin + gambaran proyek
  DESIGN.md           # token desain dari design-md-studio (dibuat di M0)
  package.json        # workspaces: app + party
  app/                # Vue 3 + Vite (frontend, deploy ke Pages)
    src/
      components/     # BoardCanvas, Lobby, ChatBox, PlayerList, ...
      game/           # mesin jigsaw: cutter, renderer, drag, snap
      stores/         # Pinia: room, game
      lib/            # partysocket client, helpers
  party/              # PartyServer worker (deploy ke Workers)
    src/
      server.ts       # class Room: onConnect/onMessage/broadcast
    wrangler.jsonc
  shared/             # tipe TS bareng: pesan, state piece, room
  docs/               # screenshot QA + catatan playtest
```

## M0 - Scaffold dan tooling

Tujuan: proyek bisa jalan (dev + build) dan siap diisi game.

Masuk scope:

- `npm create vue` (Vue 3 + TypeScript), tambah Tailwind CSS + Pinia.
- Install `partyserver`, `partysocket`, `wrangler` (dev).
- `wrangler.jsonc` + binding Durable Object (SQLite) untuk class Room.
- Struktur `app/` + `party/` + `shared/` seperti di atas.
- DESIGN.md via design-md-studio (nuansa cozy/warm seperti reel,
  board biru, tombol besar yang ramah).
- README.md, `.gitignore`, `git init` + commit pertama.
- Repo GitHub (opsional di M0, buat kalau `gh` sudah login di laptop,
  kalau belum, Zaky yang buat manual).

Tidak masuk scope: logika game, logika multiplayer.

File kunci: `package.json`, `app/package.json`, `app/vite.config.ts`,
`party/wrangler.jsonc`, `party/src/server.ts` (kerangka kosong),
`DESIGN.md`, `README.md`.

Selesai kalau:

- `npm run dev` tampil halaman hello di `localhost:5173`.
- `npm run build` lolos tanpa error.
- `wrangler dev` (di `party/`) jalan tanpa error.
- DESIGN.md sudah ada dan dipakai sebagai acuan warna/komponen.

Status: ✅ selesai 2026-11-18. Terverifikasi: `npm run build` lolos
(type-check + vite build, JS 65.81 kB / gzip 25.99 kB), dev server
melayani halaman hello di localhost:5173 (HTTP 200), `wrangler dev`
siap di localhost:8787 dengan binding Room DO, `tsc --noEmit` di
party/ bersih. Catatan: npm 12 memblokir install script bawaan,
esbuild + workerd harus di-approve dulu
(`npm install-scripts approve esbuild workerd` lalu rebuild).

## M1 - Mesin jigsaw (single player, lokal)

Tujuan: puzzle bisa dimainkan sampai selesai di satu browser, tanpa server.

Masuk scope:

- Jigsaw cutter: potong gambar jadi piece interlocking (kurva bezier
  tabs/blanks), pakai seeded PRNG jadi seed yang sama menghasilkan
  potongan yang persis sama (penting buat multiplayer nanti).
- Renderer Canvas 2D: gambar piece, bayangan, highlight saat dipilih.
- Drag pakai Pointer Events (mouse + touch), snap ke posisi benar
  dengan toleransi, piece yang sudah benar terkunci.
- Pilih jumlah piece: 24 / 48 / 100 / 200 (grid disesuaikan rasio gambar).
- Acak posisi awal (scatter) di luar area target.
- Timer, progress persen, deteksi menang + selebrasi sederhana.
- Preview gambar kecil (toggle), zoom/pan board.
- 3 gambar preset lokal (di `app/public/images/`).

Tidak masuk scope: multiplayer, upload gambar, chat.

File kunci: `app/src/game/cutter.ts`, `app/src/game/renderer.ts`,
`app/src/game/engine.ts`, `app/src/components/BoardCanvas.vue`,
`app/src/stores/game.ts`.

Selesai kalau:

- Puzzle 24 piece bisa dimainkan sampai menang di browser.
- Snap bekerja, piece yang benar terkunci dan tidak bisa digeser lagi.
- Ganti jumlah piece (48/100) jalan, gambar tidak pecah.
- Screenshot QA dicek: piece tidak tumpang tindih aneh, board rapi.
- Tidak ada error di console.

Status: ✅ selesai 2026-11-18. Terverifikasi: cutter deterministik
(seed sama = potongan sama, 24/48/100/200 piece pas), scatter strip
(0 piece di atas target, 0 di luar board), screenshot QA board 24/48/100
piece rapi, alur menang end-to-end (24/24, 100%, overlay "Puzzle
selesai!"), `npm run build` lolos (JS 89,72 kB / gzip 34,86 kB).
Catatan: z-order harus di-init immediate (BoardCanvas mount setelah
piece dibuat); scatter strip empat sisi gantikan grid + keep-out
(margin terlalu sempit buat sel, fallback acak menaruh piece di atas
target); hook QA dev-only `?autostart=1&pieces=N&solve=1` di LobbyPanel.

## M2 - Room dan realtime multiplayer

Status: ✅ selesai 2026-11-18. Terverifikasi: tes integrasi 22/22
lolos lawan wrangler dev lokal DAN worker live (create/join, cursor,
drag lock + grab-denied, move tanpa echo, drop + snap server, lepas
lock saat disconnect, persistensi SQLite, error room tidak ada);
screenshot QA lobby dua kartu rapi; deploy live
(https://puzzle-game-avl.pages.dev/ +
https://puzzle-game-party.zakyshadra.workers.dev).
Catatan: board logis tetap 1280x800 (posisi piece konsisten di semua
layar); logika game pindah ke shared/game/ supaya server dan client
pakai cut + scatter + snap yang identik; layout watcher BoardCanvas
harus immediate (layout tidak lagi bergantung ukuran container).

Tujuan: dua orang bisa susun puzzle yang sama bareng-bareng, real-time.

Masuk scope:

- PartyServer class Room: `onConnect`, `onMessage`, `broadcast`.
- Buat room (kode 6 huruf + link share) dan join room.
- Nickname + warna cursor per pemain, daftar pemain yang online.
- State piece dipegang server (authoritative): posisi, rotasi (kalau ada),
  status terkunci. Klien kirim intent, server siarkan state.
- Drag lock: piece yang sedang di-drag pemain A terkunci buat pemain B,
  lepas otomatis saat drop atau saat pemain disconnect.
- Live cursor: posisi cursor tiap pemain tampil di board lawan
  (nama + warna).
- Persistensi: state room tersimpan di SQLite Durable Object, jadi
  refresh browser atau rejoin tidak menghilangkan progres.
- Throttle broadcast drag (maks sekitar 30/detik, atau kirim saat
  posisi berubah signifikan).

Tidak masuk scope: chat, upload gambar, akun.

File kunci: `party/src/server.ts`, `shared/protocol.ts`,
`shared/types.ts`, `app/src/lib/party.ts`, `app/src/components/Lobby.vue`,
`app/src/components/PlayerList.vue`.

Selesai kalau:

- Dua jendela browser (atau laptop + HP) join room yang sama.
- Geser piece di satu layar, muncul di layar satunya kurang dari 1 detik.
- Cursor lawan terlihat dengan nama dan warna yang benar.
- Piece yang sedang di-drag tidak bisa direbut pemain lain.
- Refresh salah satu browser, progres tetap ada, bisa lanjut main.
- Deploy dev ke Workers dan tes lewat URL workers.dev (bukan cuma lokal).

## M3 - Chat dan polish UX

Status: ✅ selesai 2026-11-18. Terverifikasi: chat dua arah + pesan
sistem (join/leave/sort/selesai), timer tersinkron via jam server
(`now` di pesan state), tombol Rapikan (server re-scatter piece belum
terpasang + lokal single-player), suara snap WebAudio + mute
(localStorage), layout responsif (rail 320px desktop, bottom sheet
HP), audit red-flag UI di docs/ui-audit-m3.md. Tes integrasi 14/14
lolos lawan wrangler dev lokal DAN worker live; screenshot QA desktop
1280px + HP 390px rapi. Deploy gabungan dengan M4 di
https://puzzle-game-avl.pages.dev/.
Catatan: indikator AFK sempat dibuat lalu dibatalkan Zaky (revert
12236bb); pesan sistem per-piece sengaja tidak dibuat (terlalu
berisik di 200 piece); riwayat chat tidak disimpan di server.

Tujuan: main bareng terasa nyaman dan hangat, bukan sekadar bisa.

Masuk scope:

- Chat di dalam room (broadcast via PartyServer), termasuk pesan
  sistem ("Rina join", "Budi menyelesaikan piece tepi").
- Timer dan progress tersinkron di semua pemain.
- Tombol sortir: kumpulkan piece ke tepi / tray bawah.
- Preview gambar (toggle) + tombol "lihat gambar asli".
- Suara snap halus saat piece terpasang (bisa di-mute).
- Layout responsif: HP portrait tetap bisa main (board + tray).
- Terapkan DESIGN.md penuh + audit red-flag UI, perbaiki yang ketemu.

Tidak masuk scope: upload gambar, akun, video call.

File kunci: `app/src/components/ChatBox.vue`,
`app/src/components/Toolbar.vue`, `party/src/server.ts` (pesan chat).

Selesai kalau:

- Chat dua arah jalan, pesan sistem muncul.
- QA screenshot mobile (390px) dan desktop (1440px) dicek dan rapi.
- Audit red-flag UI dicatat di `docs/` dan temuan diperbaiki.
- Suara bisa di-mute dan tidak autoplay sebelum interaksi user.

## M4 - Galeri dan upload gambar

Status: ✅ selesai 2026-11-18. Terverifikasi: galeri 6 preset
picsum 1200x800, upload foto (kompres client maks 1600px sisi
panjang, target <500 KB, validasi MIME + maks 10 MB), Worker
POST /upload + GET /images/:key (byte-identik, dites curl lokal
+ live), host ganti gambar (reset puzzle + konfirmasi, non-host
ditolak), piece custom 12-500 dengan pembulatan nearest-good-grid
(97 -> 98, dites unit 14/14 + end-to-end browser). Tes integrasi
change-image 10/10 lolos lawan wrangler dev lokal DAN worker live;
screenshot QA lobby + upload + ganti gambar rapi.
Catatan: R2 TIDAK diaktifkan di akun Cloudflare Zaky (butuh
dashboard + billing), penyimpanan gambar pakai Workers KV
(namespace puzzle-game-images, id 84b2744e90684ebb9cf47455443af212);
kontrak API sama (POST /upload, GET /images/:key).

Tujuan: bisa main pakai foto sendiri dan jumlah piece sesuai keinginan,
terutama foto berdua.

Masuk scope:

- Galeri preset 6-8 gambar (kurasi: pemandangan, kota, ilustrasi cozy).
- Upload foto sendiri: kompres di browser dulu (maks 1600px sisi
  panjang, target di bawah 500 KB), lalu simpan ke R2 via Worker.
- Gambar room tersimpan sebagai URL, pemain yang join memuat URL yang sama.
- Host room bisa ganti gambar (reset puzzle, konfirmasi dulu).
- Batas ukuran file + pesan error yang jelas kalau gagal.
- Jumlah piece custom (permintaan Zaky 2026-11-18): selain preset
  24/48/100/200, user bisa isi angka sendiri (12-500); grid dipilih
  yang paling dekat dengan rasio gambar dan jumlah yang diminta
  (angka yang gridnya jelek, misal prima, dibulatkan ke jumlah
  terdekat yang punya grid bagus, dan jumlah akhirnya ditampilkan).

Tidak masuk scope: akun user, galeri publik, edit foto.

File kunci: `app/src/components/ImagePicker.vue`,
`app/src/lib/image.ts`, `party/src/server.ts` (endpoint upload),
binding R2 di `party/wrangler.jsonc`.

Selesai kalau:

- Upload foto dari laptop, join dari browser kedua, gambarnya sama.
- Foto 5 MB terkompres sebelum upload (cek ukuran yang sampai ke R2).
- Ganti gambar me-reset puzzle dengan konfirmasi.
- File bukan gambar ditolak dengan pesan yang jelas.
- Jumlah piece custom jalan (misalnya 60 dan 150 piece, grid rapi,
  jumlah akhir yang dipakai ditampilkan kalau dibulatkan).

## M5 - Piece grouping

Status: ✅ selesai 2026-11-18. Terverifikasi: tes unit grouping 15/15
(tetangga benar jadi grup, offset salah/diagonal tidak, rantai
transitif, gabung dua grup, snap grup, placed tidak ikut, data lama
tanpa groupId); tes integrasi WS 15/15 lawan wrangler dev lokal DAN
worker live (grup terbentuk saat drop, grab mengunci grup, drag grup
tersinkron, snap grup, grab-denied anggota grup, sort membubarkan
grup, groupId tersimpan di SQLite); QA browser Playwright 3/3
(blok 2x2 satu groupId, drag menggerakkan keempat piece bersama)
+ screenshot m5-group-2x2.png dan m5-group-dragged.png.
Catatan: grouping HANYA saat drop (tanpa magnet/preview); Rapikan
membubarkan grup; trySnap dihapus (diganti trySnapGroup); hook QA
dev-only ?groupdemo=1 di LobbyPanel + window.__puzzleGame.

Tujuan: piece yang sudah benar-benar bersebelahan menempel jadi satu
kelompok yang bisa digeser bareng, tanpa membuat game jadi terlalu mudah
(permintaan Zaky 2026-11-18).

Masuk scope:

- `groupId` di PieceState (shared, server authoritative, tersimpan di
  DO SQLite sebagai bagian dari JSON RoomState, tanpa ubah skema tabel).
- Grouping HANYA saat drop: tetangga grid (atas/bawah/kiri/kanan) yang
  offset relatifnya sudah pas (dalam snapTolerance) bergabung; union
  transitif (fixpoint), grup tidak pernah pecah sampai terpasang.
- Drag anggota grup menggerakkan semua anggota dengan delta yang sama;
  grab mengunci seluruh grup; move server meng-update semua anggota
  (broadcast piece-moved per anggota).
- Snap grup: anggota yang di-drop masuk toleransi targetnya, seluruh
  anggota snap ke posisi solved masing-masing dan menjadi placed.
- Single-player dan multiplayer pakai logika yang sama (shared/game).
- Rapikan (sort) membubarkan grup: piece yang di-scatter ulang
  kehilangan groupId (kalau tidak, anggota yang terpencar tetap
  bergerak bersama).

Tidak masuk scope: magnet/preview/highlight saat drag, petunjuk visual
tetangga yang benar, suara grouping, PWA, voice/video.

File kunci: `shared/types.ts`, `shared/game/engine.ts` (tryGroup,
trySnapGroup, groupMembers), `app/src/stores/game.ts`,
`app/src/components/BoardCanvas.vue`, `party/src/server.ts`
(grab/move/drop grup).

Selesai kalau:

- Dua piece tetangga yang posisinya pas jadi satu grup saat drop;
  tetangga yang posisinya salah TIDAK jadi grup (tes unit).
- Drag anggota grup menggerakkan semua anggota; drop + snap grup
  tersinkron ke pemain lain (tes integrasi WS).
- Grup tidak terbentuk saat drag (tidak ada magnet/preview).
- Screenshot QA board dengan kelompok piece rapi.

## M6 - Deploy, share, CV

Status: 🔨 jalan (sebagian, 2026-11-18). Selesai: README final +
screenshot (docs/screenshots/), draf CV + LinkedIn
(docs/cv-linkedin.md), verifikasi production (Pages menyajikan build
terbaru index-DteCjp_q.js berisi marker M3+M4+M5; worker live, tes
integrasi WS 22/22 lolos lawan worker live dengan room baru).
Menunggu Zaky: domain kustom puzzle.ices.my.id (butuh persetujuan +
setting DNS oleh Zaky) dan playtest final dengan Dindha. M6 tetap
terbuka sampai dua itu beres. Catatan: tes WS lawan worker live harus
pakai kode room baru tiap jalan; room lama (misal TEST01) sudah ada
di DO dan create-nya gagal, bukan regresi.

Tujuan: game live di URL publik dan siap dipajang di CV.

Masuk scope:

- Frontend deploy ke Cloudflare Pages (atau Workers Static Assets).
- PartyServer deploy ke Workers production.
- Domain kustom (misal `puzzle.ices.my.id`), perlu persetujuan Zaky
  + setting DNS (ini langkah Zaky, bukan otomatis).
- README final: link demo, screenshot, cara main, stack.
- Draf bullet CV + draf postingan LinkedIn (simpel, faktual).
- Playtest final: Zaky + Dindha main satu puzzle sampai selesai.

Tidak masuk scope: video call built-in, akun, monetisasi.

File kunci: `README.md`, `docs/playtest-final.md`.

Selesai kalau:

- URL publik bisa dibuka di laptop dan HP, room bisa dibuat dan di-join.
- Cold start room masih nyaman (kurang dari 3 detik sampai board tampil).
- Playtest Zaky + Dindha selesai tanpa bug yang menghambat.
- README + draf CV sudah ditulis.

## Backlog (v2, bukan sekarang)

- Voice/video embed (Jitsi) di dalam room.
- PWA (install ke HP).
- Riwayat room + akun (login).
- Papan skor / waktu tercepat.
- Mode kompetitif (siapa paling banyak pasang piece).

## Protokol sesi (biar context tidak putus)

1. Baca file ini + README.md dulu sebelum kerja.
2. Kerjakan SATU milestone sampai kriteria selesainya terpenuhi, baru lanjut.
3. Tiap milestone selesai: centang status di atas, isi tanggal + catatan,
   lalu push. Commit selama milestone mengikuti Konvensi commit di bawah
   (kecil-kecil, pesan conventional commits dengan scope milestone,
   contoh `feat(m1): add jigsaw cutter`).
4. Kalau ada keputusan baru, tulis di "Keputusan" + tanggalnya.
5. Verifikasi visual dengan screenshot sebelum serah terima
   (aturan: selalu check and recheck).
6. Jangan sentuh scope milestone lain di tengah jalan; kalau ada ide baru,
   masukkan ke Backlog.

## Konvensi commit (aturan keras, dari Zaky 2026-11-18)

- Commit kecil-kecil, satu commit = satu tugas kecil yang utuh. Jangan
  pernah 1 commit berisi seabrek perubahan. Patokan: usahakan di bawah
  300 baris per commit, maksimal sekitar 500 baris. Jangan sampai 5k/10k
  baris dalam satu commit.
- File generated dipisah: lockfile (`package-lock.json` / `pnpm-lock.yaml`)
  commit sendiri dengan pesan `chore:`, jangan dicampur dengan kode.
  `dist/` dan `node_modules/` jangan pernah di-commit.
- Pesan pakai conventional commits + scope milestone:
  `feat(m1):`, `fix(m2):`, `docs:`, `style:`, `refactor:`, `chore:`,
  `debug:`, `test:`. Contoh: `feat(m1): add seeded jigsaw cutter`,
  `fix(m2): release drag lock on disconnect`, `docs: update roadmap M2`.
- Timestamp dimanipulasi biar manusiawi: set `GIT_AUTHOR_DATE` dan
  `GIT_COMMITTER_DATE` di tiap commit (lewat `env`, karena shell fish
  tidak bisa sintaks `VAR=x cmd`). Aturan jeda, disesuaikan ukuran tugas
  di commit tersebut: tugas kecil 10-25 menit, tugas sedang 30-90 menit,
  tugas besar 2-5 jam (boleh nyebrang hari kalau wajar). MINIMAL 9-10
  menit antar commit, tidak boleh kurang (koreksi Zaky 2026-11-18:
  commit M0 terlalu rapat, cuma selisih 3 menitan). MODE NGEBUT
  (Zaky, 2026-11-18 sore): aturan jeda TIDAK lagi menghalangi kerja,
  commit langsung saat tugas selesai dan push seperti biasa, nanti
  history dirapikan dengan rebase (repo baru kalau perlu). Prioritas
  sekarang adalah gamenya cepat jadi dan bisa dimainkan bareng.
- Jangan pakai timestamp bulat: variasikan menit dan detik, jangan
  `:00:00` terus dan jangan menit kelipatan 5/10 terus. Jangan commit
  di jam tidur (00:00-06:00 WIB) kecuali memang masuk akal. Commit
  berurutan harus urut waktunya, tidak boleh mundur.
- Push tiap milestone selesai (atau tiap beberapa commit), jangan
  menumpuk puluhan commit lokal tanpa push.

## Perintah contekan

```bash
cd ~/Projects/puzzle-game
npm run dev            # frontend di localhost:5173
npm run build          # build frontend
cd party && npx wrangler dev    # PartyServer lokal
cd party && npx wrangler deploy # PartyServer production
```

## Risiko dan catatan

- RAM laptop 5,6 GB dan sering 89 persen terpakai: jangan jalankan banyak
  dev server barengan, tutup yang tidak dipakai.
- Drag 60fps jangan siarkan mentah: throttle, kalau tidak boros request
  dan bikin lag.
- Hibernation Durable Object: room idle berhenti bayar durasi, tapi state
  wajib tersimpan di SQLite DO biar survive setelah bangun.
- Dindha pakai laptop kentang juga: jaga bundle kecil, gambar dikompres.
- PartyKit mati, pakai PartyServer. Jangan install `partykit` hosted.
- Semua harus gratis: jangan aktifkan add-on berbayar tanpa izin Zaky.

## Log keputusan

- 2026-11-18: Stack dikunci (Vue 3 + Vite + TS + Canvas 2D, PartyServer +
  Durable Objects, Cloudflare Pages + Workers + R2). Alasan: relevan buat
  CV (Cloudflare + WebSocket + realtime), serverless tanpa VPS, Vue nyambung
  dengan Laravel (koperasi MBG). Referensi reel @oftwominds._.
- 2026-11-18: Folder `puzzle-game` (strip) sebagai ganti "puzzle game"
  (spasi) biar gampang di command line.
- 2026-11-18: Konvensi commit: commit kecil (maks sekitar 500 baris,
  file generated dipisah), pesan conventional commits (feat:, fix:,
  docs:, debug:, dll) dengan scope milestone, timestamp dimanipulasi
  biar manusiawi (jeda sesuai ukuran tugas, tidak bulat). Repo GitHub
  `zakyShadra/puzzleGame` (public).
