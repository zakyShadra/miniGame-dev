<!-- Eval bar vertikal gaya lichess: bagian putih dari bawah
proporsional dengan peluang menang Putih. cp null = belum ada
evaluasi (tampil abu-abu netral). -->
<script setup lang="ts">
import { computed } from "vue";
import { cpToWinPercent } from "../lib/analysis";

const props = defineProps<{
  cpWhite: number | null;
}>();

const whitePct = computed(() =>
  props.cpWhite === null ? 50 : cpToWinPercent(props.cpWhite),
);

const label = computed(() => {
  if (props.cpWhite === null) return "";
  const cp = props.cpWhite;
  if (cp >= 0) return `+${(cp / 100).toFixed(1)}`;
  return (cp / 100).toFixed(1);
});
</script>

<template>
  <div
    class="relative w-5 shrink-0 overflow-hidden rounded-md bg-[#1a3d4a] sm:w-6"
    role="img"
    :aria-label="
      cpWhite === null ? 'Evaluasi belum tersedia' : `Evaluasi ${label}`
    "
  >
    <div
      class="absolute bottom-0 left-0 w-full bg-[#f5f0e0] transition-all duration-500"
      :style="{ height: whitePct + '%' }"
    />
    <span
      v-if="cpWhite !== null"
      class="absolute left-1/2 top-1 -translate-x-1/2 text-[10px] font-bold"
      :class="whitePct > 80 ? 'text-ink' : 'text-white'"
      >{{ label }}</span
    >
  </div>
</template>
