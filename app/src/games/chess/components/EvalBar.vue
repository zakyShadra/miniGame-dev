<!-- Eval bar vertikal gaya lichess: bagian putih dari bawah
proporsional dengan peluang menang Putih. Skor null = belum ada
evaluasi (tampil abu-abu netral). Skor mate tampil sebagai #N
(dari sudut pandang Putih), bukan angka cp raksasa. Label berada
di luar area overflow-hidden supaya tidak terpotong. -->
<script setup lang="ts">
import { computed } from "vue";
import type { Color } from "chess.js";
import { cpToWinPercent, scoreToCp } from "../lib/analysis";
import type { EngineScore } from "../lib/engine";

const props = defineProps<{
  score: EngineScore | null;
  sideToMove: Color;
}>();

const cpWhite = computed<number | null>(() =>
  props.score
    ? scoreToCp(props.score, props.sideToMove, "w")
    : null,
);

const whitePct = computed(() =>
  cpWhite.value === null ? 50 : cpToWinPercent(cpWhite.value),
);

// Mate dari sudut pandang Putih: positif = Putih memberi mate.
const mateWhite = computed<number | null>(() => {
  if (!props.score || props.score.type !== "mate") return null;
  return props.sideToMove === "w" ? props.score.value : -props.score.value;
});

const label = computed(() => {
  if (mateWhite.value !== null) {
    return mateWhite.value > 0
      ? `#${mateWhite.value}`
      : `-#${Math.abs(mateWhite.value)}`;
  }
  if (cpWhite.value === null) return "";
  const cp = cpWhite.value;
  if (cp >= 0) return `+${(cp / 100).toFixed(1)}`;
  return (cp / 100).toFixed(1);
});
</script>

<template>
  <div
    class="relative w-8 shrink-0"
    role="img"
    :aria-label="
      cpWhite === null ? 'Evaluasi belum tersedia' : `Evaluasi ${label}`
    "
  >
    <div
      class="absolute inset-0 overflow-hidden rounded-md bg-[#1a3d4a]"
    >
      <div
        class="absolute bottom-0 left-0 w-full bg-[#f5f0e0] transition-all duration-500"
        :style="{ height: whitePct + '%' }"
      />
    </div>
    <span
      v-if="cpWhite !== null"
      class="absolute top-1 left-1/2 z-10 -translate-x-1/2 text-[10px] leading-none font-bold whitespace-nowrap"
      :class="whitePct > 80 ? 'text-ink' : 'text-white'"
      >{{ label }}</span
    >
  </div>
</template>
