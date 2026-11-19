<!-- Layar game catur: setup dulu, lalu papan + panel samping.
Layout compact ala chess.com: papan di kiri (dengan strip pemain
di atas/bawah), sidebar di kanan (status + langkah + analisa).
Di desktop, kedua kolom setinggi viewport dan scroll internal
supaya tidak ada ruang kosong besar; di HP menumpuk normal. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import type { Color } from "chess.js";
import { useChessStore } from "../stores/chess";
import { BOT_LEVELS } from "../lib/levels";
import ChessActions from "./ChessActions.vue";
import ChessBoard from "./ChessBoard.vue";
import ChessImport from "./ChessImport.vue";
import ChessSetup from "./ChessSetup.vue";
import ChessSidebar from "./ChessSidebar.vue";
import EvalBar from "./EvalBar.vue";
import PlayerStrip from "./PlayerStrip.vue";
import ThemeToggle from "../../../components/ThemeToggle.vue";

const store = useChessStore();

defineEmits<{ exit: [] }>();

// Strip pemain: bawah = warna orientasi (pemain), atas = lawan.
const bottomColor = computed<Color>(() => store.orientation);
const topColor = computed<Color>(() =>
  store.orientation === "w" ? "b" : "w",
);

function playerName(color: Color): string {
  if (store.mode === "bot") {
    if (color === store.humanColor) return "Kamu";
    const level = BOT_LEVELS.find((l) => l.id === store.botLevel);
    return level ? `Bot ${level.name}` : "Bot";
  }
  if (store.mode === "online") {
    if (color === store.onlineColor) return "Kamu";
    return store.opponentName || "Lawan";
  }
  if (store.mode === "import" && store.importedMeta) {
    return color === "w" ? store.importedMeta.white : store.importedMeta.black;
  }
  return color === "w" ? "Putih" : "Hitam";
}

// Bidak yang ditangkap + selisih materi dari sudut satu warna.
function stripProps(color: Color) {
  const captured =
    color === "w" ? store.captured.byWhite : store.captured.byBlack;
  return {
    name: playerName(color),
    captured,
    capturedColor: (color === "w" ? "b" : "w") as Color,
    materialDiff:
      color === "w"
        ? store.captured.materialDiff
        : -store.captured.materialDiff,
  };
}

// Navigasi review via keyboard (ala chess.com): panah kiri/kanan.
// Diabaikan saat mengetik di input/textarea.
function onKeydown(e: KeyboardEvent) {
  if (store.phase === "setup") return;
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
  ) {
    return;
  }
  if (e.key === "ArrowLeft") store.reviewStep(-1);
  else if (e.key === "ArrowRight") store.reviewStep(1);
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div
    v-if="store.phase === 'setup'"
    class="chess-bg flex min-h-screen flex-col items-center justify-center gap-4 p-4"
  >
    <div class="flex w-full items-start justify-between">
      <button
        type="button"
        class="rounded-full bg-surface-1 px-4 py-2 text-sm font-semibold text-ink shadow-md transition hover:bg-surface-2"
        @click="$emit('exit')"
      >
        &larr; Semua game
      </button>
      <ThemeToggle />
    </div>
    <ChessSetup />
    <ChessImport />
  </div>
  <div v-else class="chess-bg flex min-h-screen flex-col lg:h-dvh lg:overflow-hidden">
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
        {{
          store.mode === "bot"
            ? "Lawan bot"
            : store.mode === "import"
              ? "Import"
              : store.mode === "online"
                ? "Online"
                : "2 pemain"
        }}
      </span>
      <ThemeToggle />
    </header>
    <div
      class="mx-auto flex w-full max-w-[1060px] flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:min-h-0 lg:flex-row"
    >
      <!-- Kolom papan: strip lawan, papan, strip pemain, aksi.
      Di desktop scroll internal supaya setinggi viewport. -->
      <main
        class="flex w-full max-w-[640px] shrink-0 flex-col gap-2 self-center sm:gap-3 lg:min-h-0 lg:w-[min(640px,calc(100dvh-300px))] lg:self-stretch lg:overflow-y-auto lg:pr-1"
      >
        <PlayerStrip v-bind="stripProps(topColor)" />
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
        <PlayerStrip v-bind="stripProps(bottomColor)" />
        <ChessActions />
      </main>
      <aside
        class="flex min-h-0 flex-1 flex-col lg:w-[360px] lg:shrink-0 lg:overflow-y-auto lg:pr-1"
      >
        <ChessSidebar class="flex-1" />
      </aside>
    </div>
  </div>
</template>
