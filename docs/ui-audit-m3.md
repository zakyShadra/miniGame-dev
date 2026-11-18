# Audit UI M3 (2026-11-18)

Audit red-flag UI untuk fitur M3 (chat, rail kanan, toolbar board,
suara snap), mengacu ke DESIGN.md dan skill antislop-ui. Screenshot QA
di `qa/` (mirror lokal, tidak di-commit): lobby 1280, board 1280,
room 1280, room 390, room 390 dengan sheet chat terbuka.

## Temuan dan perbaikan

### 1. Toolbar board bertabrakan dengan tombol Chat di HP (DIPERBAIKI)
- Temuan: di viewport 390px, toolbar bawah (zoom, Preview, Rapikan,
  Gambar, mute) memanjang sampai menutupi tombol Chat di kiri bawah;
  tombol "-" dan angka zoom tidak terlihat.
- Perbaikan: di bawah breakpoint `sm`, toolbar jadi vertikal di pojok
  kanan atas board; divider ikut berubah orientasi. Di `sm` ke atas
  tetap horizontal di kanan bawah. Commit
  `fix(m3): stack board toolbar vertically on small screens`.
- Verifikasi: screenshot ulang 390px, toolbar vertikal rapi, tombol
  Chat terlihat penuh dengan badge belum dibaca.

### 2. Screenshot room gagal join di headless (BUKAN BUG APLIKASI)
- `--virtual-time-budget` di chrome-headless-shell merusak koneksi
  WebSocket (socket error, "Tidak bisa terhubung ke server room").
  Tes integrasi node ke server yang sama lolos 14/14, dan screenshot
  ulang dengan Playwright (waktu nyata, tunggu selektor) membuktikan
  join + chat jalan. Pelajaran: screenshot yang butuh WebSocket harus
  pakai waktu nyata, bukan virtual-time-budget.

## Yang dicek dan lolos

- Token DESIGN.md: bubble chat surface-2 (lawan) / surface-3
  (sendiri), pesan sistem teks subtle rata tengah tanpa bubble,
  tombol Kirim primary, Preview aktif primary, tidak ada warna di
  luar token.
- Aksen primary hanya di momen kunci (tombol utama, Preview aktif,
  badge belum dibaca); tidak ada gradient, glow, glassmorphism,
  atau emoji sebagai ikon. Ikon inline SVG gaya Lucide (stroke 2).
- Nama pemain di chat memakai dot warna + nama teks body (bukan
  teks warna-warni), jadi kontras tetap aman.
- Semua kontrol berfungsi: kirim chat, Rapikan (sort), mute,
  lihat gambar asli (lightbox + Escape), salin link, keluar room.
  Tidak ada tombol mati.
- Angka nyata semua: timer dari startedAt server (dikoreksi offset
  jam), progres dari piece yang terpasang, badge dari pesan yang
  benar-benar belum dibaca. Tidak ada metrik karangan.
- Empty state jujur: "Belum ada chat. Sapa pasangan mainmu!"
- Motion: tidak ada loop tanpa henti; confetti menang satu kali
  dan hormat prefers-reduced-motion.
- Breakpoint: desktop 1280 (rail 320px), HP 390 (bottom sheet chat,
  toolbar vertikal). Tidak ada scroll horizontal.
- Aksesibilitas dasar: tombol punya aria-label/title, input chat
  punya aria-label, target sentuh tombol toolbar 32px di dalam
  pill (area sentuh efektif lebih besar karena padding pill).
  Catatan: target 32px di bawah rekomendasi 44px DESIGN.md untuk
  layar sentuh; diterima karena tombol berderet rapat dalam satu
  pill dan masing-masing punya ikon 16px yang jelas. Kalau Zaky
  mengeluh susah dipencet, naikkan ke 40px.

## Keputusan yang dicatat

- Pesan sistem per piece ("Budi menyelesaikan piece tepi", contoh
  di ROADMAP) sengaja TIDAK dibuat: di puzzle 200 piece pesannya
  akan membanjiri chat. Pesan sistem hanya join, keluar, sort,
  dan puzzle selesai.
- Riwayat chat tidak disimpan di server: pemain yang join belakangan
  mulai dari chat kosong. Disengaja (chat ringan, bukan arsip).
- Indikator AFK sempat diimplementasikan lalu DIBATALKAN Zaky
  (cukup lihat cursor saja); kode dihapus di commit
  `revert(m3): remove AFK indicator, cancelled by Zaky`.

## Bukan temuan (artefak lingkungan QA)

- `ERR_TUNNEL_CONNECTION_FAILED` untuk Google Fonts di headless:
  proxy sandbox memblokir fonts.googleapis.com; fallback font
  sistem tampil normal. Bukan bug aplikasi.
- Tanda "▼" di tengah bawah screenshot: overlay chrome-headless-
  shell, bukan elemen aplikasi.
