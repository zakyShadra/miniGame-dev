<script setup lang="ts">
import { onMounted, ref } from "vue";
import { PIECE_COUNTS, PRESET_IMAGES, useGameStore } from "../stores/game";
import { solvedPosition } from "../../../shared/game/engine";

const store = useGameStore();
const starting = ref(false);
const error = ref("");

// QA hook, dev only: ?autostart=1[&pieces=48][&solve=1] langsung mulai
// game (dan kalau solve=1, pasang semua piece otomatis buat uji snap +
// menang). Dipakai screenshot QA headless (M1). Tidak jalan di
// production build.
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
});

async function start() {
  starting.value = true;
  error.value = "";
  try {
    await store.newGame(
      store.selectedImage.url,
      store.selectedImage.name,
      store.selectedCount,
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

    <h2 class="mt-6 text-sm font-semibold text-ink">Pilih gambar</h2>
    <div class="mt-2 grid grid-cols-3 gap-2">
      <button
        v-for="img in PRESET_IMAGES"
        :key="img.url"
        type="button"
        class="overflow-hidden rounded-xl border-2 transition"
        :class="
          store.selectedImage.url === img.url
            ? 'border-primary'
            : 'border-transparent hover:border-hairline-strong'
        "
        @click="store.selectedImage = img"
      >
          <img
            :src="img.url"
            :alt="img.name"
            class="aspect-[3/2] w-full object-cover"
          />
          <span
            class="block bg-surface-1 px-1 py-1 text-center text-[11px] font-medium text-body"
          >
            {{ img.name }}
          </span>
        </button>
      </div>

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
