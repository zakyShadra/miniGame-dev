<script setup lang="ts">
import { computed } from "vue";
import { useGameStore } from "../stores/game";

const store = useGameStore();

const timer = computed(() => {
  const s = store.elapsedSeconds;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
});
</script>

<template>
  <header
    class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-surface-1 px-4 py-2"
  >
    <button
      type="button"
      class="rounded-full px-3 py-1.5 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
      @click="store.backToLobby()"
    >
      &larr; Lobby
    </button>
    <h1 class="font-display text-base font-bold text-ink">
      {{ store.imageName }}
    </h1>
    <div class="order-3 flex w-full items-center gap-2 sm:order-none sm:mx-auto sm:w-full sm:max-w-md">
      <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          class="h-full rounded-full bg-ochre transition-all duration-200"
          :style="{ width: store.progress + '%' }"
        />
      </div>
      <span class="text-xs font-semibold whitespace-nowrap text-muted tabular-nums">
        {{ store.placed }}/{{ store.totalPieces }} &middot; {{ store.progress }}%
      </span>
    </div>
    <span class="ml-auto text-base font-bold text-ink tabular-nums sm:ml-0">
      {{ timer }}
    </span>
  </header>
</template>
