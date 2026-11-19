<!-- Import game catur dari PGN untuk dianalisa: tempel PGN dari
chess.com (di game chess.com: Share, salin PGN) atau PGN mana pun,
atau ambil daftar game dari username chess.com lalu pilih gamenya.
PGN kosong/tidak valid menampilkan error, tidak crash. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useChessStore } from "../stores/chess";
import {
  fetchMonthlyGames,
  resultLabel,
  type ChessComGame,
} from "../lib/chesscom";

const store = useChessStore();
const pgnText = ref("");
const importError = ref("");

function importPgn() {
  importError.value = "";
  try {
    store.loadImportedGame(pgnText.value);
    pgnText.value = "";
  } catch (e) {
    importError.value =
      e instanceof Error ? e.message : "PGN tidak bisa dibaca.";
  }
}

// Ambil game dari chess.com: username + bulan -> daftar game.
const ccUsername = ref("");
const ccMonth = ref(
  (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })(),
);
const ccLoading = ref(false);
const ccError = ref("");
const ccGames = ref<ChessComGame[]>([]);
const ccSearched = ref(false);

// Terbaru dulu; tampilkan maks 30 supaya DOM tetap ringan.
const ccShown = computed(() => [...ccGames.value].reverse().slice(0, 30));

async function searchChessCom() {
  ccLoading.value = true;
  ccError.value = "";
  ccSearched.value = false;
  ccGames.value = [];
  try {
    const [y, m] = ccMonth.value.split("-").map(Number);
    if (!y || !m) throw new Error("Pilih bulan dulu.");
    ccGames.value = await fetchMonthlyGames(ccUsername.value, y, m);
    ccSearched.value = true;
  } catch (e) {
    ccError.value =
      e instanceof Error ? e.message : "Gagal mengambil game.";
  } finally {
    ccLoading.value = false;
  }
}

function importChessComGame(game: ChessComGame) {
  ccError.value = "";
  try {
    store.loadImportedGame(game.pgn);
  } catch (e) {
    ccError.value =
      e instanceof Error ? e.message : "PGN game ini tidak bisa dibaca.";
  }
}

function gameDate(game: ChessComGame): string {
  if (!game.endTime) return "";
  return new Date(game.endTime * 1000).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
}
</script>

<template>
  <div class="w-full max-w-md rounded-2xl bg-surface-1 p-6 shadow-md">
    <h2 class="font-display text-2xl font-bold tracking-tight text-ink">
      Import game
    </h2>
    <p class="mt-1 text-sm text-muted">
      Tempel PGN dari chess.com (di game chess.com: Share, salin PGN),
      lalu analisa di sini pakai engine Stockfish.
    </p>
    <textarea
      v-model="pgnText"
      rows="5"
      placeholder='[White "Zaky"]&#10;[Black "Dindha"]&#10;&#10;1. e4 e5 2. Nf3 ...'
      class="mt-4 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 font-mono text-xs text-ink outline-none focus:border-primary"
    />
    <button
      type="button"
      class="mt-3 w-full rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover"
      @click="importPgn"
    >
      Import &amp; analisa
    </button>
    <p v-if="importError" class="mt-3 text-center text-xs text-danger">
      {{ importError }}
    </p>

    <div class="my-5 flex items-center gap-3 text-xs text-subtle">
      <span class="h-px flex-1 bg-hairline" />
      atau dari chess.com
      <span class="h-px flex-1 bg-hairline" />
    </div>

    <p class="text-xs text-muted">
      Masukkan username chess.com + bulan, pilih game dari daftar.
    </p>
    <div class="mt-2 flex gap-2">
      <input
        v-model="ccUsername"
        type="text"
        maxlength="25"
        placeholder="Username chess.com"
        class="w-full min-w-0 flex-1 rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
      />
      <input
        v-model="ccMonth"
        type="month"
        class="shrink-0 rounded-xl border border-hairline bg-canvas px-2 py-2.5 text-sm text-ink outline-none focus:border-primary"
      />
    </div>
    <button
      type="button"
      :disabled="ccLoading"
      class="mt-3 w-full rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3 disabled:opacity-40"
      @click="searchChessCom"
    >
      {{ ccLoading ? "Mencari..." : "Cari game" }}
    </button>
    <p v-if="ccError" class="mt-3 text-center text-xs text-danger">
      {{ ccError }}
    </p>
    <p
      v-if="ccSearched && ccGames.length === 0"
      class="mt-3 text-center text-xs text-muted"
    >
      Tidak ada game di bulan itu.
    </p>
    <p
      v-if="ccGames.length > 30"
      class="mt-3 text-center text-xs text-subtle"
    >
      Menampilkan 30 game terbaru dari {{ ccGames.length }} game.
    </p>
    <ul
      v-if="ccShown.length > 0"
      class="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1"
    >
      <li
        v-for="g in ccShown"
        :key="g.url"
        class="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-ink">
            {{ g.white }} vs {{ g.black }}
          </p>
          <p class="text-[11px] text-muted">
            {{ gameDate(g) }}
            <template v-if="g.timeClass"> &middot; {{ g.timeClass }}</template>
            <template v-if="g.eco"> &middot; {{ g.eco }}</template>
            &middot; {{ resultLabel(g, ccUsername) }}
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-hover"
          @click="importChessComGame(g)"
        >
          Import
        </button>
      </li>
    </ul>
  </div>
</template>
