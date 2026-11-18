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
// Prioritas: (1) bidak yang baru jalan (petak asal langkah terakhir,
//    termasuk promosi yang tipenya berubah), (2) bidak diam di
//    tempat, (3) bidak sejenis terdekat (rokade: raja + benteng
//    slide bareng; lompat review). Bidak tanpa pasangan = baru
//    (fade in); bidak lama tanpa pasangan = dimakan (fade out).
function reconcileBoard(
  board: Map<Square, { type: PieceSymbol; color: Color }>,
) {
  clearTimers();
  const prev = displayedPieces.value.filter((p) => !p.leaving);
  const prevLeaving = displayedPieces.value.filter((p) => p.leaving);
  const lastMove = store.displayLastMove;
  const used = new Set<number>();
  const next: DisplayedPiece[] = [];

  for (const [sq, piece] of board) {
    let match: DisplayedPiece | undefined;
    if (lastMove && lastMove.to === sq) {
      match = prev.find(
        (p) =>
          p.square === lastMove.from &&
          p.color === piece.color &&
          !used.has(p.id),
      );
    }
    if (!match) {
      match = prev.find(
        (p) =>
          p.square === sq &&
          p.type === piece.type &&
          p.color === piece.color &&
          !used.has(p.id),
      );
    }
    if (!match) {
      let best: DisplayedPiece | undefined;
      let bestDist = Infinity;
      for (const p of prev) {
        if (used.has(p.id) || p.type !== piece.type || p.color !== piece.color)
          continue;
        const d = squareDist(p.square, sq);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      match = best;
    }
    if (match) {
      used.add(match.id);
      next.push({
        ...match,
        square: sq,
        type: piece.type,
        entering: false,
        leaving: false,
        promoted: match.type !== piece.type,
      });
    } else {
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
  }
  for (const p of prev) {
    if (!used.has(p.id)) {
      next.push({ ...p, leaving: true, entering: false, promoted: false });
    }
  }
  // Bidak yang sedang fade out dipertahankan selama petaknya masih
  // kosong; kalau petak terisi lagi (undo cepat), buang duplikatnya.
  for (const p of prevLeaving) {
    if (!board.has(p.square)) next.push(p);
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
  return (
    hoveredSquare.value === p.square &&
    store.phase === "playing" &&
    store.reviewPly === null &&
    !store.isBotTurn &&
    !store.botThinking &&
    p.color === store.turn
  );
}

// ---- Efek review analisa ----

// Langkah yang sedang di-review (null kalau tidak review).
const reviewMove = computed(() => {
  if (store.reviewPly === null || !store.analysis) return null;
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

// Jenis animasi glow per klasifikasi: Brilliant/Best berdenyut,
// Blunder berkedip cepat, Mistake/Inaccuracy berdenyut pelan,
// Excellent/Good diam (tint saja).
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
</script>

<template>
  <div
    class="relative w-full rounded-2xl bg-gradient-to-b from-[#2a5a70] to-board-frame p-2 shadow-[0_12px_32px_rgba(26,61,74,0.35)]"
  >
    <div class="relative w-full">
      <div
        class="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-lg shadow-[inset_0_2px_12px_rgba(0,0,0,0.22)]"
        role="grid"
        aria-label="Papan catur"
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
                  ? 'bg-surface-2'
                  : 'bg-board-felt',
              ]"
              :aria-label="`${file}${rank}`"
              @click="store.selectSquare(squareAt(FILES.indexOf(file), rank))"
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
              <!-- Highlight raja kena skak (berdenyut merah) -->
              <span
                v-if="
                  store.checkSquare === squareAt(FILES.indexOf(file), rank)
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
                    : 'text-surface-2'
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
                    : 'text-surface-2'
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
        </div>
      </div>

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
  background: #06b6d4;
  transform: rotate(45deg);
  border-radius: 1px;
  box-shadow: 0 0 6px #06b6d4;
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
</style>
