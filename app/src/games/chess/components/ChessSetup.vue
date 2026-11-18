<!-- Setup game catur: lawan bot (4 level, pilih warna) atau 2 pemain
lokal. Engine Stockfish di-load saat pertama kali lawan bot dipilih
(download .wasm ~99 MB sekali, lalu dari cache browser). -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useChessStore, type BotLevel, type HumanColorChoice } from "../stores/chess";
import { BOT_LEVELS } from "../lib/levels";

const store = useChessStore();

const level = ref<BotLevel>("medium");
const color = ref<HumanColorChoice>("w");
const starting = ref(false);
const error = ref("");

const progressPct = computed(() =>
  store.engineProgress ? Math.floor(store.engineProgress.percent * 100) : 0,
);
const progressMb = computed(() =>
  store.engineProgress
    ? `${(store.engineProgress.loaded / 1048576).toFixed(0)} / ${(store.engineProgress.total / 1048576).toFixed(0)} MB`
    : "",
);

async function startBot() {
  starting.value = true;
  error.value = "";
  try {
    await store.newBotGame(level.value, color.value);
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Engine gagal dimuat. Coba lagi.";
  } finally {
    starting.value = false;
  }
}

const COLOR_OPTIONS: { id: HumanColorChoice; label: string }[] = [
  { id: "w", label: "Putih" },
  { id: "b", label: "Hitam" },
  { id: "random", label: "Acak" },
];
</script>

<template>
  <div class="w-full max-w-md rounded-2xl bg-surface-1 p-6 shadow-md">
    <h1
      class="flex items-center gap-2 font-display text-3xl font-bold tracking-tight text-ink"
    >
      <img src="/pieces/wN.svg" alt="" class="h-8 w-8" />
      Catur
    </h1>
    <p class="mt-1 text-sm text-muted">
      Lawan bot Stockfish, atau main berdua di satu perangkat.
    </p>

    <h2 class="mt-6 text-sm font-semibold text-ink">Level bot</h2>
    <div class="mt-2 grid grid-cols-4 gap-2">
      <button
        v-for="l in BOT_LEVELS"
        :key="l.id"
        type="button"
        class="rounded-full py-2 text-sm font-semibold transition"
        :class="
          level === l.id
            ? 'bg-primary text-white'
            : 'bg-surface-2 text-ink hover:bg-surface-3'
        "
        @click="level = l.id"
      >
        {{ l.name }}
      </button>
    </div>
    <p class="mt-1.5 text-xs text-muted">
      {{ BOT_LEVELS.find((l) => l.id === level)?.description }}
    </p>

    <h2 class="mt-4 text-sm font-semibold text-ink">Warna kamu</h2>
    <div class="mt-2 grid grid-cols-3 gap-2">
      <button
        v-for="c in COLOR_OPTIONS"
        :key="c.id"
        type="button"
        class="rounded-full py-2 text-sm font-semibold transition"
        :class="
          color === c.id
            ? 'bg-primary text-white'
            : 'bg-surface-2 text-ink hover:bg-surface-3'
        "
        @click="color = c.id"
      >
        {{ c.label }}
      </button>
    </div>

    <button
      type="button"
      :disabled="starting"
      class="mt-5 w-full rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-40"
      @click="startBot"
    >
      {{ starting ? "Menyiapkan engine..." : "Mulai lawan bot" }}
    </button>

    <!-- Progress download engine -->
    <div v-if="starting" class="mt-3">
      <div class="h-2.5 overflow-hidden rounded-full bg-surface-3">
        <div
          class="h-full rounded-full bg-primary transition-all"
          :style="{ width: progressPct + '%' }"
        />
      </div>
      <p class="mt-1.5 text-center text-xs text-muted">
        <template v-if="store.engineProgress">
          Download engine {{ progressPct }}% ({{ progressMb }})
          <template v-if="store.engineProgress.speedText">
            &middot; {{ store.engineProgress.speedText }}
          </template>
        </template>
        <template v-else> Memuat engine... </template>
      </p>
      <p class="mt-0.5 text-center text-[11px] text-subtle">
        Download sekali saja (~99 MB), berikutnya dari cache.
      </p>
    </div>
    <p v-if="error" class="mt-3 text-center text-xs text-red-500">
      {{ error }}
    </p>

    <div class="my-5 flex items-center gap-3 text-xs text-subtle">
      <span class="h-px flex-1 bg-hairline" />
      atau
      <span class="h-px flex-1 bg-hairline" />
    </div>

    <button
      type="button"
      class="w-full rounded-full bg-surface-2 py-3 text-sm font-semibold text-ink transition hover:bg-surface-3"
      @click="store.newLocalGame()"
    >
      Main berdua (satu HP)
    </button>
  </div>
</template>
