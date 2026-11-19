<!-- Pemilih game di lobby utama: kartu Puzzle dan Catur. -->
<script setup lang="ts">
import ThemeToggle from "./ThemeToggle.vue";

defineEmits<{ pick: ["puzzle" | "chess" | "naval"] }>();
</script>

<template>
  <div
    class="relative flex min-h-screen flex-col items-center justify-center gap-6 p-4"
  >
    <ThemeToggle class="absolute top-4 right-4" />
    <div class="text-center">
      <h1
        class="flex items-center justify-center gap-2 font-display text-4xl font-bold tracking-tight text-ink"
      >
        <img src="/favicon.svg" alt="" class="h-10 w-10" />
        miniGame
      </h1>
      <p class="mt-2 text-sm text-muted">Pilih game, main bareng.</p>
    </div>
    <div class="flex w-full max-w-2xl flex-col gap-4 sm:flex-row">
      <button
        type="button"
        class="flex flex-1 items-center gap-4 rounded-2xl bg-surface-1 p-6 text-left shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
        @click="$emit('pick', 'puzzle')"
      >
        <img src="/icons/puzzle-piece.svg" alt="" class="h-12 w-12 shrink-0" />
        <span>
          <span class="block font-display text-xl font-bold text-ink">Puzzle</span>
          <span class="mt-0.5 block text-sm text-muted">
            Susun jigsaw bareng, pakai foto sendiri atau preset.
          </span>
        </span>
      </button>
      <button
        type="button"
        class="flex flex-1 items-center gap-4 rounded-2xl bg-surface-1 p-6 text-left shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
        @click="$emit('pick', 'chess')"
      >
        <img src="/pieces/wN.svg" alt="" class="h-12 w-12 shrink-0" />
        <span>
          <span class="block font-display text-xl font-bold text-ink">Catur</span>
          <span class="mt-0.5 block text-sm text-muted">
            Lawan bot 4 level atau main berdua, plus analisa langkah.
          </span>
        </span>
      </button>
      <button
        type="button"
        class="flex flex-1 items-center gap-4 rounded-2xl bg-surface-1 p-6 text-left shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
        @click="$emit('pick', 'naval')"
      >
        <img src="/icons/ship.svg" alt="" class="h-12 w-12 shrink-0" />
        <span>
          <span class="block font-display text-xl font-bold text-ink">Kapal Perang</span>
          <span class="mt-0.5 block text-sm text-muted">
            Duel kapal 3D ala World of Warships, latihan solo dulu.
          </span>
        </span>
      </button>
    </div>
  </div>
</template>
