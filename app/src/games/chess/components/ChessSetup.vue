<!-- Setup game catur. C1: hanya 2 pemain lokal (satu perangkat).
Mode lawan bot ditambah di C2. -->
<script setup lang="ts">
import { useChessStore } from "../stores/chess";

const store = useChessStore();
</script>

<template>
  <div class="w-full max-w-md rounded-2xl bg-surface-1 p-6 shadow-md">
    <h1
      class="flex items-center gap-2 font-display text-3xl font-bold tracking-tight text-ink"
    >
      <img src="/pieces/wN.svg" alt="" class="h-8 w-8" />
      Catur
    </h1>
    <p class="mt-1 text-sm text-muted">
      Main catur santai, dua pemain di satu perangkat.
    </p>

    <button
      type="button"
      class="mt-6 w-full rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover"
      @click="store.newLocalGame()"
    >
      Main berdua (satu HP)
    </button>

    <div class="mt-5 rounded-xl bg-surface-2 p-4 text-sm text-body">
      <p class="font-semibold text-ink">Cara main</p>
      <ul class="mt-1.5 list-disc space-y-1 pl-5 text-muted">
        <li>Klik bidakmu, lalu klik petak tujuan (titik = jalan, cincin = makan).</li>
        <li>Raja yang kena skak ditandai merah.</li>
        <li>Mode lawan bot + analisa langkah hadir setelah ini.</li>
      </ul>
    </div>
  </div>
</template>
