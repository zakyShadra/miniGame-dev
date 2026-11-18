<!-- Layar game catur: setup dulu, lalu papan + panel samping.
Tata letak menumpuk di HP, berdampingan di desktop. -->
<script setup lang="ts">
import { useChessStore } from "../stores/chess";
import ChessBoard from "./ChessBoard.vue";
import ChessSetup from "./ChessSetup.vue";
import ChessSidebar from "./ChessSidebar.vue";
import EvalBar from "./EvalBar.vue";

const store = useChessStore();

defineEmits<{ exit: [] }>();
</script>

<template>
  <div
    v-if="store.phase === 'setup'"
    class="flex min-h-screen flex-col items-center justify-center gap-4 p-4"
  >
    <button
      type="button"
      class="self-start rounded-full bg-surface-1 px-4 py-2 text-sm font-semibold text-ink shadow-md transition hover:bg-surface-2"
      @click="$emit('exit')"
    >
      &larr; Semua game
    </button>
    <ChessSetup />
  </div>
  <div v-else class="flex min-h-screen flex-col">
    <header
      class="flex items-center gap-3 border-b border-hairline bg-surface-1 px-4 py-3"
    >
      <button
        type="button"
        class="rounded-full px-3 py-1.5 text-sm font-semibold text-muted transition hover:bg-surface-2 hover:text-ink"
        @click="$emit('exit')"
      >
        &larr; Lobby
      </button>
      <h1 class="flex items-center gap-2 font-display text-xl font-bold text-ink">
        <img src="/pieces/wN.svg" alt="" class="h-6 w-6" />
        Catur
      </h1>
      <span class="ml-auto text-sm font-medium text-muted">
        {{ store.mode === "bot" ? "Lawan bot" : "2 pemain" }}
      </span>
    </header>
    <div
      class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 lg:flex-row"
    >
      <main class="flex w-full max-w-[560px] shrink-0 gap-2 self-center lg:self-start">
        <EvalBar
          v-if="store.evalBarEnabled"
          :cp-white="store.liveEvalCp"
          class="my-0"
        />
        <div class="min-w-0 flex-1">
          <ChessBoard />
        </div>
      </main>
      <aside class="min-h-0 flex-1 lg:max-w-sm">
        <ChessSidebar class="h-full" />
      </aside>
    </div>
  </div>
</template>
