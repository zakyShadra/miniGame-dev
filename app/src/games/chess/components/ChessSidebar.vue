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
      <p
        v-if="store.mode === 'import' && store.importedMeta"
        class="mt-0.5 text-xs text-muted"
      >
        Import: {{ store.importedMeta.white }} vs
        {{ store.importedMeta.black }}
        <template v-if="store.importedMeta.date">
          &middot; {{ store.importedMeta.date }}
        </template>
      </p>
      <p
        v-if="store.mode === 'import' && store.importedNote"
        class="mt-1 text-xs text-muted"
      >
        {{ store.importedNote }}
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
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-xs font-bold tracking-wide text-muted uppercase">
          Langkah
        </h2>
        <!-- Saat review, satu ketukan kembali ke posisi live. -->
        <button
          v-if="store.reviewPly !== null"
          type="button"
          class="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary transition hover:bg-primary/20"
          @click="store.setReview(null)"
        >
          Kembali ke live
        </button>
      </div>
      <!-- Di HP daftar dibatasi tingginya + scroll internal, supaya
      game panjang tidak mendorong panel Analisa ke bawah tanpa
      batas. Di desktop tetap meregang mengisi panel samping. -->
      <div
        ref="listRef"
        class="mt-2 max-h-64 min-h-24 flex-1 overflow-y-auto pr-1 lg:max-h-none"
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
                class="py-0.5"
                :style="
                  moveCellMeta((pair.n - 1) * 2)
                    ? {
                        backgroundColor: moveCellMeta((pair.n - 1) * 2)!.tint,
                      }
                    : undefined
                "
              >
                <button
                  type="button"
                  class="w-full cursor-pointer rounded px-1 py-0.5 text-left font-semibold text-ink transition hover:bg-primary/15 hover:text-primary"
                  :class="{
                    'bg-primary/20 text-primary':
                      store.reviewPly === (pair.n - 1) * 2 + 1,
                  }"
                  :aria-label="`Lihat posisi setelah ${pair.white.san}`"
                  @click="store.toggleReview((pair.n - 1) * 2)"
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
                </button>
              </td>
              <td
                class="py-0.5"
                :style="
                  moveCellMeta((pair.n - 1) * 2 + 1)
                    ? {
                        backgroundColor: moveCellMeta((pair.n - 1) * 2 + 1)!
                          .tint,
                      }
                    : undefined
                "
              >
                <button
                  v-if="pair.black"
                  type="button"
                  class="w-full cursor-pointer rounded px-1 py-0.5 text-left font-semibold text-ink transition hover:bg-primary/15 hover:text-primary"
                  :class="{
                    'bg-primary/20 text-primary':
                      store.reviewPly === (pair.n - 1) * 2 + 2,
                  }"
                  :aria-label="`Lihat posisi setelah ${pair.black.san}`"
                  @click="store.toggleReview((pair.n - 1) * 2 + 1)"
                >
                  {{ pair.black.san }}
                  <span
                    v-if="moveCellMeta((pair.n - 1) * 2 + 1)?.glyph"
                    class="ml-0.5 text-xs font-bold"
                    :style="{
                      color: moveCellMeta((pair.n - 1) * 2 + 1)!.color,
                    }"
                    >{{ moveCellMeta((pair.n - 1) * 2 + 1)!.glyph }}</span
                  >
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-if="store.moveList.length > 0"
        class="mt-1 text-[11px] text-subtle"
      >
        Ketuk langkah untuk melihat posisinya.
      </p>
    </div>

    <!-- Bar aksi pindah ke ChessActions.vue, langsung di bawah papan. -->

    <div
      v-if="
        store.phase === 'over' ||
        store.analysisStatus === 'running' ||
        store.analysisStatus === 'loading' ||
        store.analysisStatus === 'done'
      "
      class="rounded-2xl bg-surface-1 p-3 shadow-md sm:p-4"
    >
      <AnalysisPanel />
    </div>
  </div>
</template>
