<!-- Panel samping catur: status, bidak tertangkap, daftar langkah,
tombol kontrol. Dipakai mode lokal dan bot. -->
<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useChessStore } from "../stores/chess";
import { BOT_LEVELS } from "../lib/levels";
import { pieceUrl } from "../lib/pieces";
import {
  CLASSIFICATION_META,
  type Classification,
} from "../lib/analysis";
import AnalysisPanel from "./AnalysisPanel.vue";

const store = useChessStore();
const listRef = ref<HTMLElement | null>(null);

// Klasifikasi langkah ke-ply (0-based) dari hasil analisa, null kalau
// belum ada analisa. Dipakai buat glyph + warna di daftar langkah.
function classificationAt(ply: number): Classification | null {
  return store.analysis?.moves[ply]?.classification ?? null;
}

// Glyph + warna + tint latar sel langkah dari klasifikasinya.
function moveCellMeta(ply: number): {
  glyph: string;
  color: string;
  tint: string;
} | null {
  const c = classificationAt(ply);
  if (!c) return null;
  const meta = CLASSIFICATION_META[c];
  return { glyph: meta.symbol, color: meta.color, tint: meta.color + "1f" };
}

// Auto-scroll daftar langkah ke baris terakhir tiap ada langkah baru.
watch(
  () => store.historyVerbose.length,
  async () => {
    await nextTick();
    listRef.value?.scrollTo({ top: listRef.value.scrollHeight });
  },
);
</script>

<template>
  <div class="flex min-h-0 flex-col gap-3 sm:gap-4">
    <div class="rounded-2xl bg-surface-1 p-3 shadow-md sm:p-4">
      <p class="text-sm font-semibold text-ink">{{ store.statusText }}</p>
      <p v-if="store.mode === 'bot'" class="mt-0.5 text-xs text-muted">
        Bot:
        {{ BOT_LEVELS.find((l) => l.id === store.botLevel)?.name }}
        &middot; kamu
        {{ store.humanColor === "w" ? "Putih" : "Hitam" }}
      </p>
      <p v-if="store.botThinking" class="mt-1 text-xs font-medium text-primary">
        Bot berpikir...
      </p>
      <p v-if="store.engineError" class="mt-1 text-xs text-red-500">
        {{ store.engineError }}
      </p>
      <div class="mt-3 space-y-1.5 text-xs text-muted">
        <p class="flex flex-wrap items-center gap-1">
          <span class="font-semibold text-ink">Putih tangkap:</span>
          <img
            v-for="(p, i) in store.captured.byWhite"
            :key="`w${i}`"
            :src="pieceUrl('b', p)"
            alt=""
            class="h-5 w-5"
          />
          <span v-if="store.captured.materialDiff > 0" class="font-bold text-ink">
            +{{ store.captured.materialDiff }}
          </span>
          <span v-if="store.captured.byWhite.length === 0">-</span>
        </p>
        <p class="flex flex-wrap items-center gap-1">
          <span class="font-semibold text-ink">Hitam tangkap:</span>
          <img
            v-for="(p, i) in store.captured.byBlack"
            :key="`b${i}`"
            :src="pieceUrl('w', p)"
            alt=""
            class="h-5 w-5"
          />
          <span v-if="store.captured.materialDiff < 0" class="font-bold text-ink">
            +{{ -store.captured.materialDiff }}
          </span>
          <span v-if="store.captured.byBlack.length === 0">-</span>
        </p>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col rounded-2xl bg-surface-1 p-3 shadow-md sm:p-4">
      <h2 class="text-xs font-bold tracking-wide text-muted uppercase">
        Langkah
      </h2>
      <div
        ref="listRef"
        class="mt-2 min-h-24 flex-1 overflow-y-auto pr-1"
      >
        <p v-if="store.moveList.length === 0" class="text-sm text-subtle">
          Belum ada langkah. Putih jalan dulu.
        </p>
        <table class="w-full text-sm tabular-nums">
          <tbody>
            <tr
              v-for="pair in store.moveList"
              :key="pair.n"
              class="odd:bg-surface-2/60"
            >
              <td class="w-10 py-1 pl-2 text-muted">{{ pair.n }}.</td>
              <td
                class="py-1 font-semibold text-ink"
                :style="
                  moveCellMeta((pair.n - 1) * 2)
                    ? {
                        backgroundColor: moveCellMeta((pair.n - 1) * 2)!.tint,
                      }
                    : undefined
                "
              >
                {{ pair.white.san }}
                <span
                  v-if="moveCellMeta((pair.n - 1) * 2)?.glyph"
                  class="ml-0.5 text-xs font-bold"
                  :style="{
                    color: moveCellMeta((pair.n - 1) * 2)!.color,
                  }"
                  >{{ moveCellMeta((pair.n - 1) * 2)!.glyph }}</span
                >
              </td>
              <td
                class="py-1 font-semibold text-ink"
                :style="
                  moveCellMeta((pair.n - 1) * 2 + 1)
                    ? {
                        backgroundColor: moveCellMeta((pair.n - 1) * 2 + 1)!
                          .tint,
                      }
                    : undefined
                "
              >
                {{ pair.black?.san ?? "" }}
                <span
                  v-if="moveCellMeta((pair.n - 1) * 2 + 1)?.glyph"
                  class="ml-0.5 text-xs font-bold"
                  :style="{
                    color: moveCellMeta((pair.n - 1) * 2 + 1)!.color,
                  }"
                  >{{ moveCellMeta((pair.n - 1) * 2 + 1)!.glyph }}</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        v-if="store.mode === 'bot'"
        type="button"
        :disabled="store.botThinking || store.isBotTurn"
        class="flex-1 rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3 disabled:opacity-40"
        @click="store.hint()"
      >
        Hint
      </button>
      <button
        type="button"
        class="flex-1 rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3"
        @click="store.undo()"
      >
        Undo
      </button>
      <button
        type="button"
        class="flex-1 rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3"
        @click="store.flip()"
      >
        Balik papan
      </button>
      <button
        type="button"
        class="flex-1 rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3"
        @click="store.toggleEvalBar()"
      >
        Eval {{ store.evalBarEnabled ? "nyala" : "mati" }}
      </button>
      <button
        v-if="store.phase === 'playing'"
        type="button"
        class="flex-1 rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3"
        @click="store.resign()"
      >
        Menyerah
      </button>
      <button
        type="button"
        class="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover"
        @click="store.toSetup()"
      >
        Game baru
      </button>
    </div>

    <div
      v-if="
        store.phase === 'over' ||
        store.analysisStatus === 'running' ||
        store.analysisStatus === 'loading' ||
        store.analysisStatus === 'done'
      "
      class="rounded-2xl bg-surface-1 p-4 shadow-md"
    >
      <AnalysisPanel />
    </div>
  </div>
</template>
