<script setup lang="ts">
import { computed } from "vue";
import { useGameStore } from "./stores/game";
import BoardCanvas from "./components/BoardCanvas.vue";
import GameHeader from "./components/GameHeader.vue";
import LobbyPanel from "./components/LobbyPanel.vue";

const store = useGameStore();

const timer = computed(() => {
  const s = store.elapsedSeconds;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
});

// Confetti ringan satu kali saat menang (DESIGN.md mengizinkan ini
// sebagai pengecualian). Posisi pseudo-acak tapi stabil per kemenangan.
const confetti = computed(() => {
  if (store.status !== "won") return [];
  const colors = ["#ff6b5a", "#e8b94a", "#a4d4c5", "#b8a4ed", "#0099e1", "#ffb084"];
  return Array.from({ length: 24 }, (_, i) => ({
    left: (i * 37 + 11) % 100,
    delay: (i % 8) * 0.12,
    duration: 2.2 + (i % 5) * 0.3,
    color: colors[i % colors.length]!,
    size: 6 + (i % 3) * 3,
    round: i % 2 === 0,
  }));
});

async function playAgainSame() {
  await store.newGame(store.imageUrl, store.imageName, store.pieceCount);
}
</script>

<template>
  <LobbyPanel v-if="store.status === 'lobby'" />
  <div v-else class="flex h-screen flex-col">
    <GameHeader />
    <main class="min-h-0 flex-1">
      <BoardCanvas />
    </main>
  </div>

  <div
    v-if="store.status === 'won'"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
  >
    <div class="absolute inset-0 bg-ink/40" />
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <span
        v-for="(c, i) in confetti"
        :key="i"
        class="confetti-piece"
        :style="{
          left: c.left + '%',
          animationDelay: c.delay + 's',
          animationDuration: c.duration + 's',
          background: c.color,
          width: c.size + 'px',
          height: c.size + 'px',
          borderRadius: c.round ? '50%' : '2px',
        }"
      />
    </div>
    <div
      class="relative w-full max-w-sm rounded-2xl bg-surface-1 p-6 text-center shadow-lg"
    >
      <h2 class="font-display text-2xl font-bold text-ink">Puzzle selesai!</h2>
      <p class="mt-1 text-sm text-muted">
        {{ store.imageName }} &middot; {{ store.totalPieces }} piece &middot;
        {{ timer }}
      </p>
      <div class="mt-5 flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink hover:bg-surface-3"
          @click="store.backToLobby()"
        >
          Lobby
        </button>
        <button
          type="button"
          class="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
          @click="playAgainSame"
        >
          Main lagi
        </button>
      </div>
    </div>
  </div>
</template>

<style>
@keyframes confetti-fall {
  0% {
    transform: translateY(-10vh) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(110vh) rotate(720deg);
    opacity: 0.7;
  }
}
.confetti-piece {
  position: absolute;
  top: 0;
  animation-name: confetti-fall;
  animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1);
  animation-fill-mode: forwards;
}
@media (prefers-reduced-motion: reduce) {
  .confetti-piece {
    display: none;
  }
}
</style>
