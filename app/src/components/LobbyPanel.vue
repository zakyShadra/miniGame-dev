<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { PIECE_COUNTS, useGameStore } from "../stores/game";
import { solvedPosition } from "../../../shared/game/engine";
import { roundPieceCount } from "../../../shared/game/cutter";
import { loadImageSize } from "../lib/images";
import ImagePicker from "./ImagePicker.vue";

const store = useGameStore();
const starting = ref(false);
const error = ref("");

// Ukuran gambar terpilih, buat menghitung pembulatan jumlah piece.
const dims = ref<{ w: number; h: number } | null>(null);

async function refreshDims() {
  try {
    dims.value = await loadImageSize(store.selectedImage.url);
  } catch {
    dims.value = null;
  }
}

watch(() => store.selectedImage.url, refreshDims, { immediate: true });

// Jumlah piece final setelah dibulatkan ke grid bagus (M4). Client
// mengirim angka final ini ke server supaya keduanya sepakat.
const rounded = computed(() =>
  dims.value
    ? roundPieceCount(store.selectedCount, dims.value.w, dims.value.h)
    : null,
);

function onCustomCount(e: Event) {
  const n = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(n)) return;
  store.selectedCount = Math.min(500, Math.max(12, Math.round(n)));
}

// QA hook, dev only: ?autostart=1[&pieces=48][&solve=1][&groupdemo=1]
// langsung mulai game (solve=1: pasang semua piece otomatis buat uji
// snap + menang; groupdemo=1: susun piece 0,1,6,7 jadi blok 2x2 dan
// gabungkan jadi satu grup buat uji grouping M5). Dipakai screenshot QA
// headless (M1). Tidak jalan di production build.
onMounted(() => {
  if (!import.meta.env.DEV) return;
  const params = new URLSearchParams(location.search);
  if (params.get("autostart") !== "1") return;
  const n = Number(params.get("pieces"));
  if (PIECE_COUNTS.includes(n as (typeof PIECE_COUNTS)[number])) {
    store.selectedCount = n as (typeof PIECE_COUNTS)[number];
  }
  start();
  if (params.get("solve") === "1") {
    setTimeout(() => {
      const layout = store.layout;
      const cut = store.cut;
      if (!layout || !cut) return;
      for (const piece of store.pieces) {
        const spec = cut.pieces.find((s) => s.id === piece.id);
        if (!spec) continue;
        const t = solvedPosition(spec, layout);
        store.movePiece(piece.id, t.x, t.y);
        store.dropPiece(piece.id);
      }
    }, 1500);
  }
  if (params.get("groupdemo") === "1") {
    setTimeout(() => {
      // Demo grouping (M5): susun piece 0,1,6,7 jadi blok 2x2 di strip
      // kiri, lalu drop piece 0 supaya keempatnya jadi satu grup.
      // Piece lain yang menutupi blok diparkir di pojok kanan bawah
      // supaya drag QA mengenai grup (bukan piece yang menumpuk di atas).
      const layout = store.layout;
      const cut = store.cut;
      if (!layout || !cut) return;
      const pw = cut.pieceW * layout.scale;
      const ph = cut.pieceH * layout.scale;
      const positions: Record<number, { x: number; y: number }> = {
        0: { x: 0, y: 300 },
        1: { x: pw, y: 300 },
        6: { x: 0, y: 300 + ph },
        7: { x: pw, y: 300 + ph },
      };
      for (const [id, pos] of Object.entries(positions)) {
        store.movePiece(Number(id), pos.x, pos.y);
      }
      let park = 0;
      for (const piece of store.pieces) {
        if ([0, 1, 6, 7].includes(piece.id)) continue;
        const overlaps =
          piece.x < 2 * pw + 20 &&
          piece.x + pw > -20 &&
          piece.y < 300 + 2 * ph + 20 &&
          piece.y + ph > 280;
        if (overlaps) {
          store.movePiece(
            piece.id,
            1080 + (park % 3) * 20,
            650 + Math.floor(park / 3) * 20,
          );
          park++;
        }
      }
      store.dropPiece(0);
    }, 1500);
  }
});

async function start() {
  starting.value = true;
  error.value = "";
  try {
    await store.newGame(
      store.selectedImage.url,
      store.selectedImage.name,
      rounded.value?.count ?? store.selectedCount,
    );
  } catch {
    error.value = "Gambar tidak bisa dimuat. Coba gambar lain.";
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div class="w-full max-w-md rounded-2xl bg-surface-1 p-6 shadow-md">
    <h1 class="font-display text-3xl font-bold tracking-tight text-ink">
      puzzleGame
    </h1>
    <p class="mt-1 text-sm text-muted">Susun puzzle bareng, santai aja.</p>

    <ImagePicker />

    <h2 class="mt-5 text-sm font-semibold text-ink">Jumlah piece</h2>
    <div class="mt-2 flex gap-2">
      <button
        v-for="n in PIECE_COUNTS"
        :key="n"
        type="button"
        class="flex-1 rounded-full py-2 text-sm font-semibold transition"
        :class="
          store.selectedCount === n
            ? 'bg-primary text-white'
            : 'bg-surface-2 text-ink hover:bg-surface-3'
        "
        @click="store.selectedCount = n"
      >
        {{ n }}
      </button>
    </div>
    <div class="mt-2 flex items-center gap-2">
      <label
        for="custom-count"
        class="shrink-0 text-xs font-medium text-muted"
      >
        atau isi sendiri (12-500)
      </label>
      <input
        id="custom-count"
        type="number"
        min="12"
        max="500"
        step="1"
        :value="store.selectedCount"
        class="w-full min-w-0 flex-1 rounded-xl border border-hairline-strong bg-canvas px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-primary tabular-nums"
        @change="onCustomCount"
      />
    </div>
    <p
      v-if="rounded && rounded.count !== store.selectedCount"
      class="mt-1.5 text-xs text-muted"
    >
      Dibulatkan ke {{ rounded.count }} piece ({{ rounded.cols }}x{{
        rounded.rows
      }}) supaya potongannya rapi.
    </p>

    <button
      type="button"
      :disabled="starting"
      class="mt-6 w-full rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-40"
      @click="start"
    >
      {{ starting ? "Menyiapkan..." : "Mulai main sendiri" }}
    </button>
    <p v-if="error" class="mt-3 text-center text-xs text-red-500">
      {{ error }}
    </p>
  </div>
</template>
