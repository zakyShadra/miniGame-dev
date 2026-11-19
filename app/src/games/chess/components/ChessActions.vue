<!-- Bar aksi catur: Hint, Undo, Balik papan, Eval, Menyerah/Lihat
hasil, Game baru. Ditaruh LANGSUNG di bawah papan (bukan di bawah
daftar langkah) supaya di HP selalu dalam jangkauan tanpa scroll.
Grid 3 kolom, tiap tombol min 44px tinggi, label tidak terpotong.
Mode online: Undo + Eval disembunyikan (tidak ada takeback lintas
jaringan; eval bar = bantuan engine, tidak adil), Menyerah hanya
saat game berjalan, Game baru jadi Keluar room (keluar = putus
dari room). -->
<script setup lang="ts">
import { useChessStore } from "../stores/chess";

const store = useChessStore();
</script>

<template>
  <div class="grid grid-cols-3 gap-2">
    <button
      v-if="store.mode === 'bot'"
      type="button"
      :disabled="store.botThinking || store.isBotTurn"
      class="min-h-11 rounded-full bg-surface-2 px-2 py-2 text-sm font-semibold whitespace-nowrap text-ink transition hover:bg-surface-3 disabled:opacity-40"
      @click="store.hint()"
    >
      Hint
    </button>
    <button
      v-if="store.mode !== 'import' && store.mode !== 'online'"
      type="button"
      class="min-h-11 rounded-full bg-surface-2 px-2 py-2 text-sm font-semibold whitespace-nowrap text-ink transition hover:bg-surface-3"
      @click="store.undo()"
    >
      Undo
    </button>
    <button
      type="button"
      class="min-h-11 rounded-full bg-surface-2 px-2 py-2 text-sm font-semibold whitespace-nowrap text-ink transition hover:bg-surface-3"
      @click="store.flip()"
    >
      Balik papan
    </button>
    <button
      v-if="store.mode !== 'import' && store.mode !== 'online'"
      type="button"
      class="min-h-11 rounded-full bg-surface-2 px-2 py-2 text-sm font-semibold whitespace-nowrap text-ink transition hover:bg-surface-3"
      @click="store.toggleEvalBar()"
    >
      Eval {{ store.evalBarEnabled ? "nyala" : "mati" }}
    </button>
    <button
      v-if="
        store.phase === 'playing' &&
        !(
          store.mode === 'online' && store.onlineStatus === 'waiting'
        )
      "
      type="button"
      class="min-h-11 rounded-full bg-surface-2 px-2 py-2 text-sm font-semibold whitespace-nowrap text-ink transition hover:bg-surface-3"
      @click="store.resign()"
    >
      Menyerah
    </button>
    <button
      v-if="
        store.phase === 'over' &&
        !store.endModalVisible &&
        store.mode !== 'import'
      "
      type="button"
      class="min-h-11 rounded-full bg-surface-2 px-2 py-2 text-sm font-semibold whitespace-nowrap text-ink transition hover:bg-surface-3"
      @click="store.showEndModal()"
    >
      Lihat hasil
    </button>
    <button
      type="button"
      class="min-h-11 rounded-full bg-primary px-2 py-2 text-sm font-semibold whitespace-nowrap text-white transition hover:bg-primary-hover"
      @click="store.toSetup()"
    >
      {{ store.mode === "online" ? "Keluar room" : "Game baru" }}
    </button>
  </div>
</template>
