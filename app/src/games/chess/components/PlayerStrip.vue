<!-- Strip pemain di atas/bawah papan (ala chess.com): nama + bidak
yang ditangkap pemain itu + selisih materi kalau unggul. -->
<script setup lang="ts">
import type { Color, PieceSymbol } from "chess.js";
import { pieceUrl } from "../lib/pieces";

defineProps<{
  name: string;
  /** Bidak yang ditangkap pemain ini (tipenya; warnanya = lawan). */
  captured: PieceSymbol[];
  /** Warna bidak yang ditangkap (warna lawan). */
  capturedColor: Color;
  /** Selisih materi dari sudut pemain ini (> 0 = unggul, tampil +N). */
  materialDiff: number;
}>();
</script>

<template>
  <div class="flex min-h-8 items-center gap-2 px-1">
    <span class="shrink-0 truncate text-sm font-bold text-ink">{{
      name
    }}</span>
    <span class="flex min-w-0 flex-wrap items-center">
      <img
        v-for="(p, i) in captured"
        :key="`${p}${i}`"
        :src="pieceUrl(capturedColor, p)"
        alt=""
        class="h-5 w-5"
      />
    </span>
    <span v-if="materialDiff > 0" class="shrink-0 text-xs font-bold text-ink">
      +{{ materialDiff }}
    </span>
  </div>
</template>
