---
version: alpha
name: "miniGame"
description: "miniGame: cozy multiplayer mini-games di web, game pertama jigsaw puzzle. Kanvas krem hangat (#fffaf0) ala clay, aksen coral hangat, papan felt biru dusty (#87a8c8) seperti di reel referensi; sudut lembut, tombol pill, gerak halus. Plus Jakarta Sans + Inter."
sources:
  colors: "clay + mintlify + formo-club"
  shape: "airbnb + cal"
  layout: "cal"
  type: "pairing #11 Plus Jakarta Sans + Inter"

colors:
  primary: "#ff6b5a"
  on-primary: "#ffffff"
  primary-hover: "#f25947"
  primary-pressed: "#e04a38"
  ink: "#0a0a0a"
  body: "#3a3a3a"
  ink-muted: "#6a6a6a"
  ink-subtle: "#9a9a9a"
  canvas: "#fffaf0"
  surface-1: "#faf5e8"
  surface-2: "#f5f0e0"
  surface-3: "#ebe6d6"
  hairline: "#e5e5e5"
  hairline-soft: "#f0f0f0"
  hairline-strong: "#c1c1c1"
  focus-ring: "#ff6b5a"
  board-felt: "#87a8c8"
  board-frame: "#1a3d4a"
  accent-ochre: "#e8b94a"
  accent-peach: "#ffb084"
  accent-mint: "#a4d4c5"
  accent-lavender: "#b8a4ed"
  accent-pink: "#ff4d8b"
  accent-sky: "#0099e1"
  semantic-success: "#22c55e"
  semantic-warning: "#f59e0b"
  semantic-danger: "#ef4444"

typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: -0.02em
  h1:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.02em
  h2:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  h3:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  body-strong:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: 0
  small:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  room-code:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0.18em

rounded:
  sm: 8px
  md: 12px
  lg: 16px
  pill: 999px

spacing:
  s4: 4px
  s8: 8px
  s12: 12px
  s16: 16px
  s24: 24px
  s32: 32px
  s48: 48px
  s64: 64px
  s96: 96px

motion:
  duration-fast: 150ms
  duration-base: 220ms
  duration-slow: 320ms
  duration-snap: 120ms
  ease-standard: "cubic-bezier(0.2, 0, 0, 1)"
  ease-enter: "cubic-bezier(0, 0, 0.2, 1)"
  ease-exit: "cubic-bezier(0.4, 0, 1, 1)"
  ease-snap: "cubic-bezier(0.34, 1.56, 0.64, 1)"
  distance: 8px

shadow:
  card: "0 2px 10px rgba(10, 10, 10, 0.06)"
  raised: "0 8px 24px rgba(10, 10, 10, 0.10)"
  piece-drag: "0 10px 20px rgba(10, 10, 10, 0.18)"
---

# miniGame: Design System

## Overview

Warna dari clay (kanvas krem hangat, aksen coral/peach/ochre/mint), biru papan dari mintlify (felt dusty blue, frame teal gelap), bentuk dari airbnb dan cal (tombol pill, kartu sudut lembut). Font dari pairing studio #11: Plus Jakarta Sans untuk judul, Inter untuk UI. Suasananya cozy dan hangat seperti main puzzle di meja ruang tamu, bukan arcade yang berisik. Satu-satunya permukaan biru adalah papan; sisanya krem hangat. Setiap nilai di implementasi harus dari token di front matter; kalau tidak ada di sana, tidak boleh dipakai.

## Colors

- `canvas` #fffaf0 adalah halaman. `surface-1..3` #faf5e8 / #f5f0e0 / #ebe6d6 adalah panel, kartu, dan state terpilih.
- `ink` #0a0a0a untuk judul, `body` #3a3a3a untuk teks isi, `ink-muted` untuk teks sekunder, `ink-subtle` hanya untuk caption dan placeholder (bukan bacaan wajib).
- `primary` #ff6b5a (coral clay) adalah satu-satunya aksen aksi: tombol utama, link, focus ring, navigasi aktif. Hover `primary-hover`, pressed `primary-pressed` (keduanya turunan gelap dari primary), teks di atasnya `on-primary`.
- `board-felt` #87a8c8 adalah permukaan papan puzzle; `board-frame` #1a3d4a adalah bingkai dan tray. Papan adalah satu-satunya area biru di layar.
- `accent-ochre` #e8b94a untuk progres dan timer; `accent-peach` #ffb084 untuk highlight sekunder; `accent-mint` #a4d4c5 untuk piece yang sudah terpasang.
- Warna kursor pemain (dipilih saat masuk room, selalu ditemani label nama, tidak pernah warna saja): coral `primary`, ochre `accent-ochre`, pink `accent-pink`, lavender `accent-lavender`, sky `accent-sky`, mint `accent-mint`.
- `hairline` #e5e5e5 pemisah; `hairline-strong` #c1c1c1 (airbnb) untuk border input dan tombol sekunder.
- Semantic (`semantic-success`, `semantic-warning`, `semantic-danger`) hanya untuk status, selalu ditemani teks atau ikon, tidak pernah warna saja.
- Contrast floor: teks isi 4.5:1, teks besar dan batas UI 3:1. Teks di atas `board-felt` harus putih dengan bayangan tipis atau label gelap.

## Typography

- Judul: **Plus Jakarta Sans** (geometric-humanist, ramah dan sedikit membulat). Isi dan UI: **Inter**. Tidak ada font mono; kode room dan timer memakai `room-code` dan `font-variant-numeric: tabular-nums`.
- `display`: 40px / 1.05, weight 700. Dipakai di judul lobby.
- `h1`: 32px / 1.1, weight 700.
- `h2`: 24px / 1.2, weight 700.
- `h3`: 18px / 1.3, weight 600.
- `body`: 14px / 1.6, weight 400.
- `body-strong`: 14px / 1.6, weight 600.
- `small`: 12px / 1.5, weight 400.
- `room-code`: 28px / 1.2, weight 700, letter-spacing 0.18em.
- Maksimal 2 weight per layar. Sentence case di semua tempat; tidak ada judul all-caps. Bahasa UI: Indonesia kasual.

## Layout

- Container max-width **1280px**, **12-column** grid, 24px gutter, basis spacing 4px. Hanya pakai token `spacing`.
- Layar game (board-first): canvas papan mengisi ruang fleksibel di tengah, rail kanan **320px** berisi pemain, progres, dan chat. Di bawah 1024px rail pindah ke bawah papan.
- Lobby: kartu tengah max-width **480px**, satu kolom, tombol utama full-width.
- Galeri gambar: grid 3 kolom di desktop, 2 di tablet, 1 di mobile; rasio kartu 4:3; jarak 16px.
- Section vertical padding: 48px sampai 64px (`{spacing.s48}` ke `{spacing.s64}`).

## Elevation & Depth

- Permukaan istirahat: `surface-1` dengan border 1px `hairline`, tanpa bayangan.
- Kartu dan panel mengambang: `surface-1`, shadow `{shadow.card}`.
- Dialog dan menu: `surface-1`, shadow `{shadow.raised}`.
- Piece yang sedang di-drag: shadow `{shadow.piece-drag}` di canvas.
- Tidak pernah menumpuk dua bayangan, tidak pernah mewarnai bayangan dengan primary, tidak ada blur dekoratif (laptop spek rendah: `backdrop-filter` dihindari).

## Shapes

- Radius: sm 8px, md 12px, lg 16px, pill bulat penuh.
- Tombol memakai `{rounded.pill}` (airbnb). Input memakai `{rounded.md}`. Kartu dan panel memakai `{rounded.lg}` (cal/airbnb). Tag, avatar, dan dot pemain memakai `{rounded.pill}`.
- Radius bersarang mengecil: radius elemen dalam adalah radius luar dikurangi padding di antaranya.
- Border 1px solid; tidak ada border dashed, double, atau gradient.

## Surfaces

- Material: **Normal**. Permukaan kertas hangat, bukan kaca dan bukan brutalist. Alasan teknis: game berjalan di laptop spek rendah, efek kaca (`backdrop-filter`) dan bayangan keras menambah beban render.
- Papan: `board-felt` dengan pola titik halus (dot putih 8% opacity, grid 24px) supaya piece terlihat kontras di atasnya. Pola digambar di canvas, bukan CSS.
- Tray piece: `board-frame` dengan piece tersusun rapi di atasnya.

## Components

**`button-primary`**: background `{colors.primary}`, teks `{colors.on-primary}`, `{typography.body-strong}`, padding 10px 20px, rounded `{rounded.pill}`. Hover `{colors.primary-hover}`, pressed `{colors.primary-pressed}`, focus ring 2px `{colors.focus-ring}` dengan offset 2px, disabled opacity 40% tanpa hover.

**`button-secondary`**: background `{colors.surface-1}`, teks `{colors.ink}`, border 1px `{colors.hairline-strong}`, ukuran dan radius sama dengan primary. Hover border jadi `{colors.ink-subtle}`.

**`button-ghost`**: transparan, teks `{colors.ink-muted}`; hover teks `{colors.ink}` di atas `{colors.surface-1}`.

**`input`**: background `{colors.canvas}`, border 1px `{colors.hairline-strong}`, rounded `{rounded.md}`, tinggi 40px (44px di sentuh). Focus ganti border ke `{colors.primary}` plus focus ring. Error memakai border `{colors.semantic-danger}` dan pesan di bawah; placeholder `{colors.ink-subtle}`.

**`card`**: background `{colors.surface-1}`, border 1px `{colors.hairline}`, rounded `{rounded.lg}`, padding 16px, shadow `{shadow.card}`. Kartu interaktif naik 2px saat hover dalam `duration-fast`; tidak membesar.

**`player-chip`**: dot warna pemain 10px + nama `{typography.body-strong}` + status (online/mengetik). Dot memakai warna kursor pemain.

**`cursor-label`**: label nama mengikuti kursor pasangan di canvas: background warna pemain, teks putih `{typography.small}`, rounded `{rounded.pill}`, padding 2px 8px. Kursor sendiri tidak berlabel.

**`chat-bubble`**: background `{colors.surface-2}`, rounded `{rounded.md}`, padding 8px 12px. Pesan sendiri memakai `surface-3`. Pesan sistem (pemain masuk, puzzle selesai) teks `{colors.ink-subtle}` rata tengah tanpa bubble.

**`progress-bar`**: track `{colors.surface-3}` tinggi 8px rounded pill, isi `{colors.accent-ochre}`, transisi lebar `duration-base`.

**`timer`**: `{typography.h3}` dengan `font-variant-numeric: tabular-nums`; berhenti saat puzzle selesai.

**`room-code`**: `{typography.room-code}` di atas `{colors.surface-2}`, rounded `{rounded.md}`, padding 12px 16px, dengan tombol salin di samping.

## Motion & Behavior

- Karakter: **Smooth**. Durasi: fast 150ms (hover, press, focus), base 220ms (menu, tab, toggle), slow 320ms (dialog, transisi halaman). Easing standar `cubic-bezier(0.2, 0, 0, 1)`. Jarak gerak 8px.
- Snap piece: saat piece terkunci ke tempatnya, scale 1.06 kembali ke 1 dalam `duration-snap` (120ms) dengan `ease-snap` (overshoot lembut), ditemani bunyi klik halus (M3, bisa di-mute).
- Drag piece: tanpa transisi selama di-drag (mengikuti pointer 1:1); transisi hanya untuk snap dan kembali ke tray.
- Kursor pasangan: tanpa transisi (posisi live dari WebSocket, di-throttle ~30/detik).
- Entrance: section fade + naik 8px sekali saat pertama muncul, dalam `duration-slow`. Stagger maksimal 5 item @40ms.
- Loading: skeleton block `surface-2` untuk konten, spinner inline untuk aksi; ukuran layout dijaga stabil.
- Empty: satu kalimat tentang apa yang seharusnya ada di sini, satu aksi utama; tanpa ilustrasi.
- Error: pesan inline di sebelah penyebab, `semantic-danger`, dengan aksi pemulihan; tidak ada toast pemblokir untuk error field.
- Success: konfirmasi tenang di tempat (centang atau ganti teks 2 detik); puzzle selesai boleh rayakan dengan animasi confetti ringan satu kali (pengecualian untuk momen menang).
- Hormati `prefers-reduced-motion`: hapus translate dan scale, sisakan opacity dan perubahan warna. Snap tetap jalan tanpa scale.
- Semua elemen interaktif bisa dijangkau keyboard dan punya focus state terlihat; target sentuh minimal 44px di layar sentuh.

## Responsive Behavior

- Breakpoint: 640px, 1024px, 1280px. Di bawah 640px grid jadi satu kolom dengan gutter samping 16px; tidak ada scroll horizontal halaman.
- Di bawah 1024px rail kanan pindah ke bawah papan; chat jadi panel yang bisa di-collapse.
- Type turun satu level (`display` ke `h1`) di bawah 640px.
- Canvas papan menyesuaikan lebar layar; pinch-zoom dan pan didukung di sentuh (M1).

## Screens

- **Lobby**: judul `display`, kartu tengah (nama panggilan, warna kursor, kode room atau tombol buat room baru, pilih jumlah piece), galeri gambar preset di bawah. Satu aksi utama per kartu.
- **Room/Game**: header (kode room + tombol salin, timer, progres, tombol keluar), papan canvas di tengah, rail kanan (daftar pemain, chat). Tombol aksi papan: preview gambar, zoom, sortir piece, mute.
- **Galeri (M4)**: grid gambar preset + kartu upload foto sendiri. Upload mengompres di client sebelum kirim.

## Do's and Don'ts

### Do
- Hanya pakai token dari front matter: warna, type, radius, spacing, motion, shadow.
- Satu elemen per layar membawa warna primary.
- Tulis copy nyata dan spesifik dalam Bahasa Indonesia kasual. Pakai bentuk data nyata di contoh, bukan placeholder.
- Cek kontras setiap pasangan teks dan background, di kedua state (default dan hover).
- Jaga frame rate di laptop kentang: animasi murah (transform + opacity saja), tanpa blur dan tanpa bayangan berlapis.

### Don't (the generic AI look)
- Tidak ada gradient ungu-biru atau gradient dekoratif apa pun, tidak ada glow, tidak ada glassmorphism atau panel blur.
- Tidak ada emoji sebagai ikon atau bullet. Ikon: inline SVG gaya Lucide (grid 24px, stroke 2px, round linecap/join).
- Tidak ada grid kartu tiga kolom yang identik (ikon, judul tebal, dua baris teks) sebagai cara default menampilkan fitur.
- Tidak ada radius besar seragam plus bayangan lembut di semua container.
- Tidak ada layout rata-tengah semuanya, tidak ada hero oversized dengan blob gradient.
- Tidak ada "Lorem ipsum", "Acme", "John Doe", atau angka placeholder bulat seperti 10.000+ atau 99.9%.
- Tidak ada hover scale-up, bouncing, floating, atau animasi dekoratif berulang (kecuali snap piece dan confetti menang).
- Tidak ada warna, ukuran font, radius, atau bayangan di luar token, walau "cuma sekali ini".
- Tidak lebih dari satu warna aksen; warna semantic hanya untuk status.

## Known Gaps

- Ikon: inline SVG gaya Lucide (grid 24px, stroke 2px, round linecap/join); tidak ada emoji sebagai ikon.
- Dark mode tidak dibuat; game ini light-only by design (suasana meja hangat).
- Font tidak di-bundle; muat Plus Jakarta Sans (500/700) dan Inter (400/600) dari Google Fonts.
- Desain bunyi (klik snap, selesai) didefinisikan di M3.
