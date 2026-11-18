<!-- Papan catur DOM 8x8. Klik bidak sendiri untuk memilih (langkah
legal muncul sebagai titik/cincin), klik target untuk jalan. Warna
petak ikut DESIGN.md: krem hangat + biru dusty felt. -->
<script setup lang="ts">
import { computed } from "vue";
import type { PieceSymbol, Square } from "chess.js";
import { useChessStore } from "../stores/chess";
import { FILES, isLightSquare, pieceUrl } from "../lib/pieces";

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

function isTarget(sq: Square): boolean {
  return store.targets.some((m) => m.to === sq);
}

function isCaptureTarget(sq: Square): boolean {
  return store.targets.some((m) => m.to === sq && m.captured);
}

function isLastMove(sq: Square): boolean {
  const lm = store.lastMove;
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
