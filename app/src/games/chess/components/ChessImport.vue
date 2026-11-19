<!-- Import game catur dari PGN untuk dianalisa: tempel PGN dari
chess.com (di game chess.com: Share, salin PGN) atau PGN mana pun,
lalu game dimuat ke papan + bisa dianalisa seperti game biasa.
PGN kosong/tidak valid menampilkan error, tidak crash. -->
<script setup lang="ts">
import { ref } from "vue";
import { useChessStore } from "../stores/chess";

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
    <p v-if="importError" class="mt-3 text-center text-xs text-red-500">
      {{ importError }}
    </p>
  </div>
</template>
