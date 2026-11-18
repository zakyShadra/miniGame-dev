<!-- Panel analisa pasca-game (C3, round 2: dua mode + progresif):
tombol pilih mode, progress, akurasi + hitungan klasifikasi per
pemain, grafik evaluasi, dan daftar langkah dengan simbol. Hasil
mengalir per langkah selama analisa berjalan. Klik langkah =
review posisi di papan + best line engine. -->
<script setup lang="ts">
import { computed } from "vue";
import { useChessStore } from "../stores/chess";
import {
  ANALYSIS_MODES,
  CLASSIFICATION_META,
  type Classification,
} from "../lib/analysis";

const store = useChessStore();

// Grafik evaluasi: SVG 100% lebar, tinggi 80. Y = cp Putih dibatasi
// +-1000 (mate tampil di ujung).
const CHART_W = 300;
const CHART_H = 80;
const chartPoints = computed(() => {
  const a = store.analysis;
  if (!a || a.moves.length === 0) return "";
  const pts = [0, ...a.moves.map((m) => m.evalAfterCpWhite)];
  const max = pts.length - 1;
  return pts
    .map((cp, i) => {
      const x = (i / Math.max(max, 1)) * CHART_W;
      const clamped = Math.max(-1000, Math.min(1000, cp));
      const y = CHART_H / 2 - (clamped / 1000) * (CHART_H / 2 - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
});
const chartArea = computed(() =>
  chartPoints.value
    ? `0,${CHART_H / 2} ${chartPoints.value} ${CHART_W},${CHART_H / 2}`
    : "",
);

const ORDER: Classification[] = [
  "brilliant",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
];

// Langkah yang sedang di-review (indeks posisi = ply+1).
const reviewMove = computed(() => {
  if (store.reviewPly === null || !store.analysis) return null;
  const ply = store.reviewPly - 1;
  return ply >= 0 ? store.analysis.moves[ply] ?? null : null;
});

const progressPct = computed(() => {
  const p = store.analysisProgress;
  return p.total > 0 ? Math.floor((p.done / p.total) * 100) : 0;
});
</script>

<template>
  <div class="mt-4 border-t border-hairline pt-4">
    <h3 class="text-sm font-semibold text-ink">Analisa</h3>

    <!-- Belum ada analisa: pilih mode -->
    <template v-if="store.analysisStatus === 'idle'">
      <p class="mt-1 text-xs text-muted">
        Engine Stockfish menilai tiap langkah: Brilliant, Best,
        Inaccuracy, Mistake, Blunder, plus akurasi per pemain. Hasil
        mengalir per langkah selama analisa berjalan.
      </p>
      <button
        type="button"
        class="mt-3 w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover"
        @click="store.startAnalysis('fast')"
      >
        {{ ANALYSIS_MODES.fast.label }}
        <span class="block text-[11px] font-normal opacity-90">
          {{ ANALYSIS_MODES.fast.hint }}
        </span>
      </button>
      <button
        type="button"
        class="mt-2 w-full rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3"
        @click="store.startAnalysis('thinking')"
      >
        {{ ANALYSIS_MODES.thinking.label }}
        <span class="block text-[11px] font-normal text-muted">
          {{ ANALYSIS_MODES.thinking.hint }}
        </span>
      </button>
    </template>

    <!-- Engine masih download -->
    <template v-else-if="store.analysisStatus === 'loading'">
      <p class="mt-2 text-center text-xs text-muted">
        Memuat engine...
        <template v-if="store.engineProgress">
          {{ Math.floor(store.engineProgress.percent * 100) }}%
        </template>
      </p>
      <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          class="h-full rounded-full bg-primary transition-all"
          :style="{
            width: store.engineProgress
              ? Math.floor(store.engineProgress.percent * 100) + '%'
              : '10%',
          }"
        />
      </div>
    </template>

    <!-- Analisa berjalan -->
    <template v-else-if="store.analysisStatus === 'running'">
      <p class="mt-2 text-center text-xs text-muted">
        {{ ANALYSIS_MODES[store.analysisMode].label }}: menganalisa
        posisi {{ store.analysisProgress.done }} dari
        {{ store.analysisProgress.total }} ({{ progressPct }}%)
      </p>
      <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          class="h-full rounded-full bg-primary transition-all"
          :style="{ width: progressPct + '%' }"
        />
      </div>
      <button
        type="button"
        class="mt-3 w-full rounded-full bg-surface-2 py-2 text-sm font-semibold text-ink transition hover:bg-surface-3"
        @click="store.cancelAnalysis()"
      >
        Batalkan
      </button>
    </template>

    <!-- Analisa error: pilih mode lagi untuk coba ulang -->
    <template v-else-if="store.analysisStatus === 'error'">
      <p class="mt-2 text-xs text-red-500">{{ store.analysisError }}</p>
      <button
        type="button"
        class="mt-3 w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover"
        @click="store.startAnalysis('fast')"
      >
        {{ ANALYSIS_MODES.fast.label }}
      </button>
      <button
        type="button"
        class="mt-2 w-full rounded-full bg-surface-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3"
        @click="store.startAnalysis('thinking')"
      >
        {{ ANALYSIS_MODES.thinking.label }}
      </button>
    </template>

    <!-- Hasil analisa: tampil penuh saat selesai, tampil parsial
    (mengalir per langkah) saat masih berjalan. -->
    <template
      v-if="
        store.analysis &&
        (store.analysisStatus === 'done' ||
          store.analysisStatus === 'running')
      "
    >
      <p class="mt-2 text-[11px] text-subtle">
        Mode: {{ ANALYSIS_MODES[store.analysisMode].label }}
        <template v-if="store.analysisStatus === 'running'">
          &middot; masih menganalisa, angka bisa berubah
        </template>
      </p>
      <!-- Akurasi -->
      <div class="mt-2 grid grid-cols-2 gap-2 text-center">
        <div class="rounded-xl bg-surface-2 p-2">
          <p class="text-[11px] font-medium text-muted">Putih</p>
          <p class="text-lg font-bold text-ink">
            {{ store.analysis.whiteAccuracy }}%
          </p>
          <p class="text-[11px] text-muted">akurasi</p>
        </div>
        <div class="rounded-xl bg-surface-2 p-2">
          <p class="text-[11px] font-medium text-muted">Hitam</p>
          <p class="text-lg font-bold text-ink">
            {{ store.analysis.blackAccuracy }}%
          </p>
          <p class="text-[11px] text-muted">akurasi</p>
        </div>
      </div>

      <!-- Hitungan klasifikasi -->
      <div class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <template v-for="c in ORDER" :key="c">
          <div
            v-if="
              store.analysis.counts.w[c] > 0 ||
              store.analysis.counts.b[c] > 0
            "
            class="contents"
          >
            <span class="text-muted">
              <span
                class="mr-1 inline-block h-2 w-2 rounded-full"
                :style="{ background: CLASSIFICATION_META[c].color }"
              />
              {{ CLASSIFICATION_META[c].label }}
            </span>
            <span class="text-right font-medium text-ink">
              {{ store.analysis.counts.w[c] }} /
              {{ store.analysis.counts.b[c] }}
            </span>
          </div>
        </template>
      </div>
      <p class="mt-1 text-right text-[10px] text-subtle">
        Putih / Hitam
      </p>

      <!-- Grafik evaluasi -->
      <svg
        :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
        class="mt-3 w-full rounded-lg bg-surface-2"
        role="img"
        aria-label="Grafik evaluasi per langkah"
      >
        <line
          :x1="0"
          :x2="CHART_W"
          :y1="CHART_H / 2"
          :y2="CHART_H / 2"
          stroke="#87a8c8"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
        <polygon
          :points="chartArea"
          fill="#87a8c8"
          fill-opacity="0.25"
        />
        <polyline
          :points="chartPoints"
          fill="none"
          stroke="#ff6b5a"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>

      <!-- Review: best line posisi yang dipilih -->
      <div
        v-if="reviewMove"
        class="mt-3 rounded-xl bg-surface-2 p-3"
      >
        <p class="text-xs font-semibold text-ink">
          Setelah {{ reviewMove.san }}
          <span :style="{ color: CLASSIFICATION_META[reviewMove.classification].color }">
            {{ CLASSIFICATION_META[reviewMove.classification].symbol }}
            {{ CLASSIFICATION_META[reviewMove.classification].label }}
          </span>
        </p>
        <p class="mt-1 text-xs text-muted">
          Langkah terbaik:
          <span class="font-semibold text-ink">{{
            reviewMove.bestMoveSan || "-"
          }}</span>
        </p>
        <p
          v-if="reviewMove.bestLineSan.length > 1"
          class="mt-0.5 text-xs text-muted"
        >
          Lanjutan: {{ reviewMove.bestLineSan.slice(1, 6).join(" ") }}
        </p>
        <button
          type="button"
          class="mt-2 w-full rounded-full bg-surface-1 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface-3"
          @click="store.setReview(null)"
        >
          Kembali ke posisi akhir
        </button>
      </div>

      <!-- Daftar langkah dengan simbol -->
      <ol class="mt-3 max-h-56 space-y-0.5 overflow-y-auto text-sm">
        <li
          v-for="m in store.analysis.moves"
          :key="m.ply"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition hover:bg-surface-2"
          :class="{
            'bg-surface-2': store.reviewPly === m.ply + 1,
          }"
          @click="store.setReview(m.ply + 1)"
        >
          <span class="w-6 text-xs text-muted">{{ Math.floor(m.ply / 2) + 1 }}.</span>
          <span class="font-medium text-ink">{{ m.san }}</span>
          <span
            class="text-xs font-bold"
            :style="{ color: CLASSIFICATION_META[m.classification].color }"
          >
            {{ CLASSIFICATION_META[m.classification].symbol }}
          </span>
          <span class="ml-auto text-xs text-muted">
            {{ m.classification === "best" || m.classification === "brilliant"
              ? ""
              : `terbaik ${m.bestMoveSan}` }}
          </span>
        </li>
      </ol>
      <p class="mt-2 text-[11px] text-subtle">
        Klik langkah untuk melihat posisi dan best line-nya.
      </p>
    </template>
  </div>
</template>
