<!-- Papan catur DOM 8x8. Klik bidak sendiri untuk memilih (langkah
legal muncul sebagai titik/cincin), klik target untuk jalan. Warna
petak ikut DESIGN.md: krem hangat + biru dusty felt.
Bidak dirender di lapisan overlay terpisah dari petak, dengan
identitas stabil per bidak (reconciler): tiap perpindahan papan
dianimasikan sebagai slide (transform 300 ms), bidak yang dimakan
fade/scale out, promosi nge-pop, dan raja yang skak berdenyut. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Color, PieceSymbol, Square } from "chess.js";
import { useChessStore } from "../stores/chess";
import { FILES, isLightSquare, pieceUrl } from "../lib/pieces";
import { CLASSIFICATION_META } from "../lib/analysis";
import GameEndModal from "./GameEndModal.vue";

const store = useChessStore();

const PROMOTION_PIECES: PieceSymbol[] = ["q", "r", "b", "n"];

// Urutan file/rank tampil, dibalik kalau orientasi Hitam.
const displayFiles = computed(() =>
  store.orientation === "w" ? [...FILES] : [...FILES].reverse(),
);
const displayRanks = computed(() =>
  store.orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8],
);

function squareAt(fileIndex: number, rank: number): Square {
  return `${FILES[fileIndex]}${rank}` as Square;
}

// Kolom/baris tampil (0-7) dari petak, mengikuti orientasi papan.
function displayCol(sq: Square): number {
  const file = sq.charCodeAt(0) - 97;
  return store.orientation === "w" ? file : 7 - file;
}
function displayRow(sq: Square): number {
  const rank = sq.charCodeAt(1) - 49;
  return store.orientation === "w" ? 7 - rank : rank;
}

function isTarget(sq: Square): boolean {
  return store.targets.some((m) => m.to === sq);
}

function isCaptureTarget(sq: Square): boolean {
  return store.targets.some((m) => m.to === sq && m.captured);
}

function isLastMove(sq: Square): boolean {
  const lm = store.displayLastMove;
  return !!lm && (lm.from === sq || lm.to === sq);
}

// ---- Animasi bidak (reconciler) ----

// Satu bidak di lapisan overlay. id stabil selama bidak hidup di
// papan, jadi Vue memakai ulang node DOM-nya dan perubahan transform
// (petak) teranimasikan otomatis oleh CSS transition.
interface DisplayedPiece {
  id: number;
  color: Color;
  type: PieceSymbol;
  square: Square;
  // Baru muncul (fade in), dimakan (fade out), atau promosi (pop).
  entering: boolean;
  leaving: boolean;
  promoted: boolean;
}

let nextPieceId = 1;
const displayedPieces = ref<DisplayedPiece[]>([]);
const pendingTimers: ReturnType<typeof setTimeout>[] = [];

function later(ms: number, fn: () => void) {
  pendingTimers.push(setTimeout(fn, ms));
}
function clearTimers() {
  for (const t of pendingTimers) clearTimeout(t);
  pendingTimers.length = 0;
}
onBeforeUnmount(clearTimers);

function squareDist(a: Square, b: Square): number {
  return (
    Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) +
    Math.abs(a.charCodeAt(1) - b.charCodeAt(1))
  );
}

// Cocokkan bidak di papan baru dengan bidak tampil sebelumnya.
// URUTAN ARRAY DIJAGA STABIL (urutan bidak lama + bidak baru di
// akhir): kalau urutan berubah, Vue memindah node DOM dan transisi
// transform batal (bidak teleport). Dengan urutan stabil, Vue hanya
// mengubah style dan slide berjalan.
//
// Dua pass pencocokan:
// (1a) bidak yang baru jalan (petak asal langkah terakhir, termasuk
//     promosi yang tipenya berubah) dan bidak diam di tempat;
// (1b) sisa bidak dicocokkan ke petak sejenis terdekat yang belum
//     terpakai (rokade: benteng slide ke petak barunya; lompat
//     review). Bidak tanpa pasangan = baru (fade in, di akhir
//     array); bidak lama tanpa pasangan = dimakan (fade out).
function reconcileBoard(
  board: Map<Square, { type: PieceSymbol; color: Color }>,
) {
  clearTimers();
  const prev = displayedPieces.value;
  const lastMove = store.displayLastMove;
  const usedSquares = new Set<Square>();
  // Hasil per bidak lama (id -> state baru), null = belum cocok.
  const matched = new Map<number, DisplayedPiece | null>();
  for (const p of prev) matched.set(p.id, null);

  // Bidak yang sedang fade out dipertahankan selama petaknya masih
  // kosong; kalau petak terisi lagi (undo cepat), buang duplikatnya.
  for (const p of prev) {
    if (p.leaving && !board.has(p.square)) {
      matched.set(p.id, p);
    }
  }

  // Pass 1a: langkah terakhir + bidak diam.
  for (const p of prev) {
    if (p.leaving) continue;
    let target: Square | undefined;
    let newType = p.type;
    if (lastMove && p.square === lastMove.from) {
      const dest = board.get(lastMove.to);
      if (dest && dest.color === p.color) {
        target = lastMove.to;
        newType = dest.type;
      }
    }
    if (!target && !usedSquares.has(p.square)) {
      const here = board.get(p.square);
      if (here && here.type === p.type && here.color === p.color) {
        target = p.square;
      }
    }
    if (target) {
      usedSquares.add(target);
      matched.set(p.id, {
        ...p,
        square: target,
        type: newType,
        entering: false,
        leaving: false,
        promoted: newType !== p.type,
      });
    }
  }

  // Pass 1b: sisa bidak ke petak sejenis terdekat yang belum terpakai.
  for (const p of prev) {
    if (p.leaving || matched.get(p.id)) continue;
    let best: Square | undefined;
    let bestDist = Infinity;
    for (const [sq, piece] of board) {
      if (usedSquares.has(sq)) continue;
      if (piece.type !== p.type || piece.color !== p.color) continue;
      const d = squareDist(p.square, sq);
      if (d < bestDist) {
        bestDist = d;
        best = sq;
      }
    }
    if (best) {
      usedSquares.add(best);
      matched.set(p.id, {
        ...p,
        square: best,
        entering: false,
        leaving: false,
        promoted: false,
      });
    }
  }

  // Susun daftar baru dalam urutan lama (stabil) + bidak baru di akhir.
  const next: DisplayedPiece[] = [];
  for (const p of prev) {
    const m = matched.get(p.id);
    if (m) {
      next.push(m);
    } else {
      // Bidak lama tanpa pasangan = dimakan (fade out di tempat).
      next.push({ ...p, leaving: true, entering: false, promoted: false });
    }
  }
  for (const [sq, piece] of board) {
    if (usedSquares.has(sq)) continue;
    next.push({
      id: nextPieceId++,
      color: piece.color,
      type: piece.type,
      square: sq,
      entering: true,
      leaving: false,
      promoted: false,
    });
  }
  displayedPieces.value = next;

  if (next.some((p) => p.entering)) {
    later(40, () => {
      for (const p of displayedPieces.value) p.entering = false;
    });
  }
  if (next.some((p) => p.promoted)) {
    later(350, () => {
      for (const p of displayedPieces.value) p.promoted = false;
    });
  }
  if (next.some((p) => p.leaving)) {
    const leavingIds = new Set(
      next.filter((p) => p.leaving).map((p) => p.id),
    );
    later(300, () => {
      displayedPieces.value = displayedPieces.value.filter(
        (p) => !leavingIds.has(p.id),
      );
    });
  }
}

// Tiap perubahan papan (langkah, undo, navigasi review) jalankan
// reconciler; mount pertama juga (fade in semua bidak).
watch(
  () => store.boardMap,
  (board) => reconcileBoard(board),
  { immediate: true },
);

// Hover lift: bidak sendiri yang bisa dipilih terangkat sedikit.
const hoveredSquare = ref<Square | null>(null);
function isHoveredPiece(p: DisplayedPiece): boolean {
  if (hoveredSquare.value !== p.square) return false;
  // Eksplorasi pasca-game: bidak giliran posisi tampil terangkat.
  if (store.phase === "over") return p.color === store.displayTurn;
  return (
    store.phase === "playing" &&
    store.reviewPly === null &&
    !store.isBotTurn &&
    !store.botThinking &&
    p.color === store.turn
  );
}

// Panah best move (review/eksplorasi pasca-game): garis + kepala panah
// SVG di atas papan, warna sky (DESIGN.md). Ujung dipendekkan 0.32
// petak supaya kepala panah tidak menutupi bidak tujuan.
const bestArrow = computed(() => {
  const bm = store.exploreBestMove;
  if (!bm) return null;
  const x1 = displayCol(bm.from) + 0.5;
  const y1 = displayRow(bm.from) + 0.5;
  const x2 = displayCol(bm.to) + 0.5;
  const y2 = displayRow(bm.to) + 0.5;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x1,
    y1,
    x2: x2 - (dx / len) * 0.32,
    y2: y2 - (dy / len) * 0.32,
  };
});

// ---- Efek review analisa ----

// Langkah yang sedang di-review (null kalau tidak review, atau sedang
// eksplorasi: efek klasifikasi game tidak berlaku di posisi fork).
const reviewMove = computed(() => {
  if (store.reviewPly === null || !store.analysis) return null;
  if (store.exploreFen !== null) return null;
  const ply = store.reviewPly - 1;
  return ply >= 0 ? store.analysis.moves[ply] ?? null : null;
});
const reviewClass = computed(() => reviewMove.value?.classification ?? null);

// Efek glow di petak tujuan langkah yang di-review, warnanya ikut
// klasifikasi langkah (teal Brilliant, hijau Best, merah Blunder,
// oranye Mistake, kuning Inaccuracy). Null kalau petak ini bukan
// tujuan review.
function reviewEffectStyle(sq: Square): Record<string, string> | null {
  const c = reviewClass.value;
  const lm = store.displayLastMove;
  if (!c || !lm || lm.to !== sq || store.reviewPly === null) return null;
  const color = CLASSIFICATION_META[c].color;
  return {
    boxShadow: `inset 0 0 0 3px ${color}, inset 0 0 22px ${color}66`,
    backgroundColor: `${color}26`,
  };
}

// Badge glyph di atas bidak yang jalan saat review analisa: simbol
// klasifikasi standar (!!, ★, !, ✓, ?!, ?, ??) tampil kecil di kanan
// atas bidak, selain warna petak highlight.
function isReviewBadgePiece(p: DisplayedPiece): boolean {
  const lm = store.displayLastMove;
  return (
    reviewMove.value !== null &&
    reviewClass.value !== null &&
    store.reviewPly !== null &&
    !p.leaving &&
    !!lm &&
    p.square === lm.to
  );
}

function reviewEffectClass(): string {
  switch (reviewClass.value) {
    case "brilliant":
    case "best":
      return "review-pulse";
    case "blunder":
      return "review-flash";
    case "mistake":
    case "inaccuracy":
      return "review-pulse-slow";
    default:
      return "";
  }
}

// ---- Badge akhir game di raja (tugas 5, ala chess.com) ----
// Skakmat/menyerah: badge merah (mahkota hitam) di raja kalah,
// hijau (mahkota putih) di raja menang. Remis: pill "Draw" di
// kedua raja, raja Putih "Draw 1/2". Badge hanya di petak akhir
// (store.showEndBadges), bukan saat review posisi lama.
function endBadgeKind(
  p: DisplayedPiece,
): "loser" | "winner" | "draw" | null {
  if (
    !store.showEndBadges ||
    !store.gameEnd ||
    p.type !== "k" ||
    p.leaving
  ) {
    return null;
  }
  const end = store.gameEnd;
  if (end.winner === null) return "draw";
  const loser: Color = end.winner === "w" ? "b" : "w";
  if (p.color === loser && p.square === store.kingSquares[loser]) {
    return "loser";
  }
  if (p.color === end.winner && p.square === store.kingSquares[end.winner]) {
    return "winner";
  }
  return null;
}

// Denyut skak dimatikan di petak raja skakmat (posisi akhir): petak
// tetap warna normal, badge merah yang menyampaikan skakmat.
function isCheckPulse(sq: Square): boolean {
  if (store.checkSquare !== sq) return false;
  return !(
    store.showEndBadges && store.gameEnd?.kind === "checkmate"
  );
}

// ---- Drag bidak (Pointer Events, mouse + sentuhan) ----
// Klik tetap jalan seperti biasa: pointerdown di bidak sendiri
// memilihnya (langkah legal tampil); kalau pointer bergerak lebih
// dari ambang, jadi drag (bidak melayang ikut pointer, bidak asli
// jadi bayangan redup di petak asal). Lepas di petak legal = jalan
// (lewat selectSquare, jadi promosi ikut terpicu); lepas di petak
// ilegal/di luar papan = bidak kembali (tidak ada yang berubah).
// Pointer capture di grid membuat klik sesudah drag tidak sampai
// ke tombol petak, jadi tidak ada pemanggilan ganda selectSquare.
const DRAG_THRESHOLD_PX = 8;

const boardEl = ref<HTMLElement | null>(null);

interface DragState {
  from: Square;
  color: Color;
  type: PieceSymbol;
  // Posisi pointer relatif terhadap papan (px).
  x: number;
  y: number;
}

const drag = ref<DragState | null>(null);
let dragStart: { x: number; y: number; square: Square } | null = null;

function isDraggedPiece(p: DisplayedPiece): boolean {
  return (
    drag.value !== null &&
    !p.leaving &&
    p.square === drag.value.from &&
    p.color === drag.value.color &&
    p.type === drag.value.type
  );
}

// Petak dari koordinat klien; null kalau di luar papan.
function squareFromPoint(clientX: number, clientY: number): Square | null {
  const el = boardEl.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const size = rect.width / 8;
  const col = Math.floor((clientX - rect.left) / size);
  const row = Math.floor((clientY - rect.top) / size);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const file = displayFiles.value[col]!;
  const rank = displayRanks.value[row]!;
  return `${file}${rank}` as Square;
}

function onPointerDown(e: PointerEvent, sq: Square) {
  if (!e.isPrimary || e.button !== 0) return;
  const piece = store.boardMap.get(sq);
  if (!piece) return;
  if (store.promotionPending) return;
  if (store.phase === "over") {
    // Eksplorasi pasca-game: bidak giliran posisi tampil bisa di-drag.
    if (piece.color !== store.displayTurn) return;
  } else {
    // Game live: hanya bidak sendiri yang bisa di-drag. Guard sama
    // seperti selectSquare (fase main, bukan review, bukan giliran bot).
    if (piece.color !== store.turn) return;
    if (store.phase !== "playing" || store.result) return;
    if (store.reviewPly !== null) return;
    if (store.isBotTurn || store.botThinking) return;
  }
  store.selectSquare(sq);
  dragStart = { x: e.clientX, y: e.clientY, square: sq };
  boardEl.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragStart) return;
  const el = boardEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (!drag.value) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    const piece = store.boardMap.get(dragStart.square);
    if (!piece) {
      dragStart = null;
      return;
    }
    drag.value = {
      from: dragStart.square,
      color: piece.color,
      type: piece.type,
      x,
      y,
    };
    return;
  }
  drag.value.x = x;
  drag.value.y = y;
}

function onPointerUp(e: PointerEvent) {
  if (!dragStart) return;
  const wasDragging = drag.value !== null;
  dragStart = null;
  drag.value = null;
  if (!wasDragging) return;
  // Lepas: kalau di petak legal, selectSquare menjalankan langkah
  // (atau membuka pemilih promosi); kalau tidak, tidak terjadi
  // apa-apa dan bidak tetap di petak asal (snap-back).
  const dropSq = squareFromPoint(e.clientX, e.clientY);
  if (dropSq) store.selectSquare(dropSq);
}

function onPointerCancel() {
  dragStart = null;
  drag.value = null;
}
</script>

<template>
  <div
    class="relative w-full rounded-2xl bg-board-frame p-2 shadow-[0_12px_32px_rgba(26,61,74,0.35)]"
  >
    <div class="relative w-full">
      <div
        ref="boardEl"
        class="grid aspect-square w-full touch-none grid-cols-8 overflow-hidden rounded-lg shadow-[inset_0_2px_12px_rgba(0,0,0,0.22)]"
        role="grid"
        aria-label="Papan catur"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <template v-for="(rank, rowIndex) in displayRanks" :key="rank">
          <template
            v-for="(file, colIndex) in displayFiles"
            :key="`${file}${rank}`"
          >
            <button
              type="button"
              class="relative flex items-center justify-center p-0 focus:outline-none"
              :class="[
                isLightSquare(FILES.indexOf(file), rank)
                  ? 'bg-board-light'
                  : 'bg-board-felt',
              ]"
              :aria-label="`${file}${rank}`"
              @click="store.selectSquare(squareAt(FILES.indexOf(file), rank))"
              @pointerdown="
                onPointerDown($event, squareAt(FILES.indexOf(file), rank))
              "
              @mouseenter="
                hoveredSquare = squareAt(FILES.indexOf(file), rank)
              "
              @mouseleave="hoveredSquare = null"
            >
              <!-- Highlight langkah terakhir -->
              <span
                v-if="isLastMove(squareAt(FILES.indexOf(file), rank))"
                class="absolute inset-0 bg-ochre/50"
              />
              <!-- Efek klasifikasi saat review langkah -->
              <template
                v-if="reviewEffectStyle(squareAt(FILES.indexOf(file), rank))"
              >
                <span
                  class="absolute inset-0"
                  :class="reviewEffectClass()"
                  :style="
                    reviewEffectStyle(squareAt(FILES.indexOf(file), rank))
                  "
                />
                <!-- Kilau Brilliant: tiga berlian kecil berkelip -->
                <template v-if="reviewClass === 'brilliant'">
                  <span class="sparkle" style="top: 12%; left: 14%" />
                  <span
                    class="sparkle"
                    style="top: 16%; right: 12%; animation-delay: 0.3s"
                  />
                  <span
                    class="sparkle"
                    style="bottom: 14%; left: 44%; animation-delay: 0.6s"
                  />
                </template>
              </template>
              <!-- Highlight hint engine -->
              <span
                v-if="
                  store.hintMove &&
                  (store.hintMove.from ===
                    squareAt(FILES.indexOf(file), rank) ||
                    store.hintMove.to ===
                      squareAt(FILES.indexOf(file), rank))
                "
                class="absolute inset-0 bg-mint/70"
              />
              <!-- Highlight bidak terpilih -->
              <span
                v-if="
                  store.selected === squareAt(FILES.indexOf(file), rank)
                "
                class="absolute inset-0 bg-primary/60"
              />
              <!-- Highlight raja kena skak (berdenyut merah). Mati di
              petak raja skakmat: badge merah menggantikannya. -->
              <span
                v-if="
                  isCheckPulse(squareAt(FILES.indexOf(file), rank))
                "
                class="check-pulse absolute inset-0"
                style="
                  background: radial-gradient(
                    circle,
                    rgba(239, 68, 68, 0.85) 0%,
                    rgba(239, 68, 68, 0.25) 70%,
                    transparent 100%
                  );
                "
              />
              <!-- Titik langkah legal (petak kosong) -->
              <span
                v-if="
                  isTarget(squareAt(FILES.indexOf(file), rank)) &&
                  !isCaptureTarget(squareAt(FILES.indexOf(file), rank))
                "
                class="absolute h-[28%] w-[28%] rounded-full bg-ink/25"
              />
              <!-- Cincin langkah makan -->
              <span
                v-if="isCaptureTarget(squareAt(FILES.indexOf(file), rank))"
                class="absolute inset-[4%] rounded-full border-[3px] border-ink/25"
              />
              <!-- Koordinat: huruf file di baris bawah, angka rank di kolom kiri -->
              <span
                v-if="rowIndex === 7"
                class="absolute right-[6%] bottom-[4%] text-[10px] leading-none font-bold"
                :class="
                  isLightSquare(FILES.indexOf(file), rank)
                    ? 'text-board-felt'
                    : 'text-board-light'
                "
              >
                {{ file }}
              </span>
              <span
                v-if="colIndex === 0"
                class="absolute top-[4%] left-[6%] text-[10px] leading-none font-bold"
                :class="
                  isLightSquare(FILES.indexOf(file), rank)
                    ? 'text-board-felt'
                    : 'text-board-light'
                "
              >
                {{ rank }}
              </span>
            </button>
          </template>
        </template>
      </div>

      <!-- Cahaya atas lembut di atas petak (efek 3D, di bawah bidak). -->
      <div
        class="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-b from-white/[0.08] via-transparent to-black/[0.04]"
        aria-hidden="true"
      />

      <!-- Lapisan bidak: tiap bidak diposisikan dengan transform,
      jadi perpindahan petak teranimasikan sebagai slide. -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          v-for="p in displayedPieces"
          :key="p.id"
          class="absolute top-0 left-0 flex h-[12.5%] w-[12.5%] items-center justify-center transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          :class="{ 'opacity-30': isDraggedPiece(p) }"
          :style="{
            transform: `translate(${displayCol(p.square) * 100}%, ${displayRow(p.square) * 100}%)`,
          }"
        >
          <img
            :src="pieceUrl(p.color, p.type)"
            alt=""
            draggable="false"
            class="h-[92%] w-[92%] drop-shadow-[0_3px_3px_rgba(0,0,0,0.35)] transition-all duration-300"
            :class="{
              'scale-50 opacity-0': p.leaving,
              'scale-75 opacity-0': p.entering,
              'piece-pop': p.promoted,
              '-translate-y-[3px] brightness-110': isHoveredPiece(p),
            }"
          />
          <!-- Badge glyph klasifikasi di kanan atas bidak yang jalan
          (saat review analisa). -->
          <span
            v-if="isReviewBadgePiece(p) && reviewClass"
            data-testid="review-glyph-badge"
            class="badge-pop absolute top-0 right-0 flex h-[36%] min-h-[18px] w-[36%] min-w-[18px] items-center justify-center rounded-full text-[10px] font-black text-white shadow-md ring-2 ring-white/90"
            :style="{
              backgroundColor: CLASSIFICATION_META[reviewClass].color,
            }"
            >{{ CLASSIFICATION_META[reviewClass].symbol }}</span
          >
          <!-- Badge akhir game di raja: merah (kalah) / hijau
          (menang) / pill Draw (remis). -->
          <span
            v-if="endBadgeKind(p) === 'loser'"
            :data-testid="
              store.gameEnd?.kind === 'checkmate'
                ? 'king-badge-mated'
                : 'king-badge-loser'
            "
            class="badge-pop absolute top-0 right-0 flex h-[36%] min-h-[18px] w-[36%] min-w-[18px] items-center justify-center rounded-full bg-danger text-[13px] leading-none text-black shadow-md ring-2 ring-white/90"
            >♚</span
          >
          <span
            v-else-if="endBadgeKind(p) === 'winner'"
            data-testid="king-badge-winner"
            class="badge-pop absolute top-0 right-0 flex h-[36%] min-h-[18px] w-[36%] min-w-[18px] items-center justify-center rounded-full bg-success text-[13px] leading-none text-white shadow-md ring-2 ring-white/90"
            >♔</span
          >
          <span
            v-else-if="endBadgeKind(p) === 'draw'"
            data-testid="king-badge-draw"
            class="badge-pop absolute top-0 right-0 flex h-[30%] min-h-[16px] items-center justify-center rounded-full bg-board-frame px-1 text-[9px] leading-none font-bold whitespace-nowrap text-white shadow-md ring-2 ring-white/90"
            >{{ p.color === "w" ? "Draw 1/2" : "Draw" }}</span
          >
        </div>
        <!-- Bidak yang sedang di-drag: melayang ikut pointer,
        sedikit membesar + bayangan lebih kuat. -->
        <div
          v-if="drag"
          class="absolute top-0 left-0 flex h-[12.5%] w-[12.5%] items-center justify-center"
          :style="{
            transform: `translate(${drag.x}px, ${drag.y}px) translate(-50%, -50%) scale(1.1)`,
          }"
        >
          <img
            :src="pieceUrl(drag.color, drag.type)"
            alt=""
            draggable="false"
            class="h-[92%] w-[92%] drop-shadow-[0_6px_6px_rgba(0,0,0,0.45)]"
          />
        </div>
      </div>

      <!-- Panah best move saat review/eksplorasi pasca-game. -->
      <svg
        v-if="bestArrow"
        data-testid="best-move-arrow"
        class="pointer-events-none absolute inset-0 z-10 h-full w-full"
        viewBox="0 0 8 8"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="best-move-arrowhead"
            markerWidth="3.2"
            markerHeight="3.2"
            refX="2.4"
            refY="1.6"
            orient="auto"
          >
            <path
              d="M0,0 L3.2,1.6 L0,3.2 z"
              fill="#0099e1"
              fill-opacity="0.9"
            />
          </marker>
        </defs>
        <line
          :x1="bestArrow.x1"
          :y1="bestArrow.y1"
          :x2="bestArrow.x2"
          :y2="bestArrow.y2"
          stroke="#0099e1"
          stroke-width="0.22"
          stroke-opacity="0.9"
          stroke-linecap="round"
          marker-end="url(#best-move-arrowhead)"
        />
      </svg>

      <!-- Pilih promosi saat pion sampai baris terakhir -->
      <div
        v-if="store.promotionPending"
        class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-ink/40"
        @click="store.cancelPromotion()"
      >
        <div
          class="flex gap-2 rounded-2xl bg-surface-1 p-4 shadow-lg"
          @click.stop
        >
          <button
            v-for="p in PROMOTION_PIECES"
            :key="p"
            type="button"
            class="h-14 w-14 rounded-xl bg-surface-2 transition hover:bg-surface-3"
            :aria-label="`Promosi jadi ${p}`"
            @click="store.choosePromotion(p)"
          >
            <img :src="pieceUrl(store.turn, p)" alt="" class="h-full w-full" />
          </button>
        </div>
      </div>

      <!-- Modal hasil game (tengah papan, tanpa dimming). -->
      <GameEndModal />
    </div>

    <!-- Label klasifikasi langkah yang di-review -->
    <div
      v-if="reviewMove"
      class="pointer-events-none absolute -top-1 left-2 z-20 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow-md"
      :style="{
        backgroundColor: CLASSIFICATION_META[reviewMove.classification].color,
      }"
    >
      <span
        v-if="CLASSIFICATION_META[reviewMove.classification].symbol"
        >{{ CLASSIFICATION_META[reviewMove.classification].symbol }}</span
      >
      <span>{{ CLASSIFICATION_META[reviewMove.classification].label }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Denyut glow review (Brilliant/Best) dan versi pelannya. */
@keyframes review-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
.review-pulse {
  animation: review-pulse 1.4s ease-in-out infinite;
}
.review-pulse-slow {
  animation: review-pulse 2s ease-in-out infinite;
}
/* Kedip cepat Blunder. */
@keyframes review-flash {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
.review-flash {
  animation: review-flash 0.9s ease-in-out infinite;
}
/* Berlian kilau Brilliant. */
.sparkle {
  position: absolute;
  width: 7px;
  height: 7px;
  background: #0099e1;
  transform: rotate(45deg);
  border-radius: 1px;
  box-shadow: 0 0 6px #0099e1;
  animation: sparkle-twinkle 1.1s ease-in-out infinite;
}
@keyframes sparkle-twinkle {
  0%,
  100% {
    opacity: 0.2;
    transform: rotate(45deg) scale(0.6);
  }
  50% {
    opacity: 1;
    transform: rotate(45deg) scale(1.15);
  }
}
/* Denyut merah raja yang kena skak. */
@keyframes check-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
.check-pulse {
  animation: check-pulse 1.2s ease-in-out infinite;
}
/* Pop promosi: bidak baru membesar lalu kembali. */
@keyframes piece-pop {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.3);
  }
  100% {
    transform: scale(1);
  }
}
.piece-pop {
  animation: piece-pop 0.3s ease-out;
}
/* Pop badge glyph: muncul membesar dari kecil. */
@keyframes badge-pop {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  60% {
    transform: scale(1.15);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
.badge-pop {
  animation: badge-pop 0.25s ease-out;
}
</style>
