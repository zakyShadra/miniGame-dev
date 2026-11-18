<!-- Papan catur DOM 8x8. Klik bidak sendiri untuk memilih (langkah
legal muncul sebagai titik/cincin), klik target untuk jalan. Warna
petak ikut DESIGN.md: krem hangat + biru dusty felt. -->
<script setup lang="ts">
import { computed } from "vue";
import type { PieceSymbol, Square } from "chess.js";
import { useChessStore } from "../stores/chess";
import { FILES, isLightSquare, pieceUrl } from "../lib/pieces";
import { CLASSIFICATION_META } from "../lib/analysis";

const store = useChessStore();

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
</script>

<template>
  <div class="relative w-full">
    <div
      class="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-xl shadow-md"
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
          >
            <!-- Highlight langkah terakhir -->
            <span
              v-if="isLastMove(squareAt(FILES.indexOf(file), rank))"
              class="absolute inset-0 bg-ochre/50"
            />
            <!-- Efek klasifikasi saat review langkah -->
            <template v-if="reviewEffectStyle(squareAt(FILES.indexOf(file), rank))">
              <span
                class="absolute inset-0"
                :class="reviewEffectClass()"
                :style="reviewEffectStyle(squareAt(FILES.indexOf(file), rank))"
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
                (store.hintMove.from === squareAt(FILES.indexOf(file), rank) ||
                  store.hintMove.to === squareAt(FILES.indexOf(file), rank))
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
            <!-- Highlight raja kena skak -->
            <span
              v-if="
                store.checkSquare === squareAt(FILES.indexOf(file), rank)
              "
              class="absolute inset-0"
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
            <!-- Bidak -->
            <img
              v-if="
                store.boardMap.get(squareAt(FILES.indexOf(file), rank))
              "
              :src="
                pieceUrl(
                  store.boardMap.get(squareAt(FILES.indexOf(file), rank))!
                    .color,
                  store.boardMap.get(squareAt(FILES.indexOf(file), rank))!
                    .type,
                )
              "
              alt=""
              draggable="false"
              class="pointer-events-none relative h-[92%] w-[92%]"
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

    <!-- Pilih promosi saat pion sampai baris terakhir -->
    <div
      v-if="store.promotionPending"
      class="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-ink/40"
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
</style>
