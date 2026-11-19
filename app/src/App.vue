<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useGameStore } from "./stores/game";
import { useRoomStore } from "./stores/room";
import { useChessStore } from "./games/chess/stores/chess";
import { useNavalStore } from "./games/naval/stores/naval";
import BoardCanvas from "./components/BoardCanvas.vue";
import ChatBox from "./components/ChatBox.vue";
import GameHeader from "./components/GameHeader.vue";
import GamePicker from "./components/GamePicker.vue";
import ImagePicker from "./components/ImagePicker.vue";
import LobbyPanel from "./components/LobbyPanel.vue";
import PlayerList from "./components/PlayerList.vue";
import RoomPanel from "./components/RoomPanel.vue";
import ChessGame from "./games/chess/components/ChessGame.vue";
import NavalGame from "./games/naval/components/NavalGame.vue";
import { loadImageSize } from "./lib/images";

const store = useGameStore();
const room = useRoomStore();
const chessStore = useChessStore();
const navalStore = useNavalStore();
const inRoom = computed(() => room.status === "connected");

// Layar utama: pemilih game, puzzle, catur, atau naval.
const screen = ref<"home" | "puzzle" | "chess" | "naval">("home");

function pickGame(game: "puzzle" | "chess" | "naval") {
  screen.value = game;
}

function exitChess() {
  chessStore.toSetup();
  screen.value = "home";
}

function exitNaval() {
  navalStore.toSetup();
  screen.value = "home";
}

// Rail kanan (pemain + chat): selalu terlihat di desktop (lg+), di HP
// jadi bottom sheet yang dibuka lewat tombol Chat. Pesan yang datang
// saat sheet tertutup menaikkan badge belum dibaca.
const railOpen = ref(false);
const unread = ref(0);

watch(
  () => room.messages.length,
  (n, old) => {
    if (n > (old ?? 0) && !railOpen.value) unread.value += n - (old ?? 0);
  },
);

function toggleRail() {
  railOpen.value = !railOpen.value;
  if (railOpen.value) unread.value = 0;
}

// Ganti gambar room (host saja, M4): pilih gambar baru di modal,
// konfirmasi, server me-reset puzzle dengan gambar itu.
const changeImageOpen = ref(false);
const changeImageBusy = ref(false);
const changeImageError = ref("");

function openChangeImage() {
  // Mulai dari gambar room saat ini.
  store.selectedImage = { name: store.imageName, url: store.imageUrl };
  changeImageError.value = "";
  changeImageOpen.value = true;
}

async function confirmChangeImage() {
  changeImageBusy.value = true;
  changeImageError.value = "";
  try {
    const { w, h } = await loadImageSize(store.selectedImage.url);
    room.sendChangeImage({
      imageUrl: store.selectedImage.url,
      imageName: store.selectedImage.name,
      imageW: w,
      imageH: h,
      pieceCount: store.pieceCount,
    });
    changeImageOpen.value = false;
    railOpen.value = false;
  } catch {
    changeImageError.value = "Gambar tidak bisa dimuat. Coba gambar lain.";
  } finally {
    changeImageBusy.value = false;
  }
}

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
  <GamePicker v-if="screen === 'home'" @pick="pickGame" />
  <ChessGame v-else-if="screen === 'chess'" @exit="exitChess" />
  <NavalGame v-else-if="screen === 'naval'" @exit="exitNaval" />
  <template v-else>
  <div
    v-if="store.status === 'lobby'"
    class="flex min-h-screen flex-wrap content-center items-start justify-center gap-4 p-4"
  >
    <LobbyPanel @exit="screen = 'home'" />
    <RoomPanel />
  </div>
  <div v-else class="flex h-screen flex-col">
    <GameHeader />
    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <main class="relative min-h-0 flex-1">
        <BoardCanvas />
        <button
          v-if="inRoom"
          type="button"
          class="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-surface-1 px-4 py-2.5 text-sm font-semibold text-ink shadow-md lg:hidden"
          @click="toggleRail"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          Chat
          <span
            v-if="unread > 0"
            class="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-white"
          >
            {{ unread }}
          </span>
        </button>
      </main>
      <aside
        v-if="inRoom"
        class="hidden min-h-0 w-80 shrink-0 flex-col border-l border-hairline bg-surface-1 lg:flex"
      >
        <div class="border-b border-hairline p-3">
          <h2 class="text-xs font-bold tracking-wide text-muted uppercase">
            Pemain
          </h2>
          <PlayerList class="mt-2" />
          <button
            v-if="room.isHost"
            type="button"
            class="mt-2.5 w-full rounded-full border border-hairline-strong py-2 text-xs font-semibold text-body transition hover:bg-surface-2"
            @click="openChangeImage"
          >
            Ganti gambar
          </button>
        </div>
        <ChatBox />
      </aside>
    </div>
    <div
      v-if="railOpen"
      class="fixed inset-0 z-30 bg-ink/30 lg:hidden"
      @click="railOpen = false"
    />
    <div
      v-if="railOpen"
      class="fixed inset-x-0 bottom-0 z-40 flex max-h-[65vh] flex-col rounded-t-2xl bg-surface-1 shadow-lg lg:hidden"
    >
      <div
        class="flex items-center justify-between border-b border-hairline p-3"
      >
        <PlayerList />
        <button
          type="button"
          class="rounded-full px-3 py-1.5 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
          @click="railOpen = false"
        >
          Tutup
        </button>
      </div>
      <button
        v-if="room.isHost"
        type="button"
        class="mx-3 mt-3 rounded-full border border-hairline-strong py-2 text-xs font-semibold text-body transition hover:bg-surface-2"
        @click="openChangeImage"
      >
        Ganti gambar
      </button>
      <ChatBox />
    </div>
  </div>

  <div
    v-if="changeImageOpen"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
  >
    <div
      class="absolute inset-0 bg-ink/40"
      @click="changeImageOpen = false"
    />
    <div
      class="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface-1 p-6 shadow-lg"
    >
      <h2 class="font-display text-xl font-bold text-ink">Ganti gambar</h2>
      <p class="mt-1 text-sm text-muted">
        Puzzle di-reset dari awal dengan gambar baru. Jumlah piece tetap
        {{ store.pieceCount }}.
      </p>
      <ImagePicker />
      <p v-if="changeImageError" class="mt-3 text-xs text-red-500">
        {{ changeImageError }}
      </p>
      <div class="mt-5 flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink hover:bg-surface-3"
          @click="changeImageOpen = false"
        >
          Batal
        </button>
        <button
          type="button"
          :disabled="changeImageBusy"
          class="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          @click="confirmChangeImage"
        >
          {{ changeImageBusy ? "Memuat..." : "Ganti gambar" }}
        </button>
      </div>
    </div>
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
          @click="room.leaveGame()"
        >
          Lobby
        </button>
        <button
          v-if="!inRoom"
          type="button"
          class="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
          @click="playAgainSame"
        >
          Main lagi
        </button>
      </div>
      <p v-if="inRoom" class="mt-3 text-xs text-subtle">
        Buat room baru dari lobby untuk main lagi.
      </p>
    </div>
  </div>
  </template>
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
