<!-- Layar game catur: setup dulu, lalu papan + panel samping.
Tata letak menumpuk di HP, berdampingan di desktop. -->
<script setup lang="ts">
import { useChessStore } from "../stores/chess";
import ChessActions from "./ChessActions.vue";
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
      class="flex items-center gap-2 border-b border-hairline bg-surface-1 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3"
    >
      <button
        type="button"
        class="shrink-0 rounded-full px-2 py-1.5 text-xs font-semibold text-muted transition hover:bg-surface-2 hover:text-ink sm:px-3 sm:text-sm"
        @click="$emit('exit')"
      >
        &larr; Lobby
      </button>
      <h1
        class="flex min-w-0 items-center gap-2 font-display text-lg font-bold text-ink sm:text-xl"
      >
        <img src="/pieces/wN.svg" alt="" class="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
        <span class="truncate">Catur</span>
      </h1>
      <span class="ml-auto shrink-0 text-xs font-medium whitespace-nowrap text-muted sm:text-sm">
        {{ store.mode === "bot" ? "Lawan bot" : "2 pemain" }}
      </span>
    </header>
    <div
      class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:flex-row"
    >
      <!-- Bar aksi langsung di bawah papan: di HP tombol selalu
      dalam jangkauan tanpa scroll melewati daftar langkah. -->
      <main
        class="flex w-full max-w-[560px] shrink-0 flex-col gap-2 self-center sm:gap-3 lg:self-start"
      >
        <div class="flex gap-2">
          <EvalBar
            v-if="store.evalBarEnabled"
            :score="store.liveEvalScore?.score ?? null"
            :side-to-move="store.liveEvalScore?.sideToMove ?? store.turn"
            class="my-0"
          />
          <div class="min-w-0 flex-1">
            <ChessBoard />
          </div>
        </div>
        <ChessActions />
      </main>
      <aside class="flex min-h-0 flex-1 flex-col lg:max-w-sm">
        <ChessSidebar class="flex-1" />
      </aside>
    </div>
  </div>
</template>
