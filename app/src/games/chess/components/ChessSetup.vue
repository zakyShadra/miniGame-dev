<!-- Setup game catur: lawan bot (4 level, pilih warna), 2 pemain
lokal, atau online lewat room. Engine Stockfish di-load saat
pertama kali lawan bot dipilih (download .wasm ~99 MB sekali,
lalu dari cache browser). -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useChessStore, type BotLevel, type HumanColorChoice } from "../stores/chess";
import { useRoomStore } from "../../../stores/room";
import { CURSOR_COLORS, generateRoomCode } from "../../../lib/party";
import { BOT_LEVELS } from "../lib/levels";

const store = useChessStore();
const room = useRoomStore();

const level = ref<BotLevel>("medium");
const color = ref<HumanColorChoice>("w");
const starting = ref(false);
const error = ref("");

// Main online: nama + buat/join room catur (kode 6 huruf, sama
// seperti puzzle). Host jadi Putih, yang join jadi Hitam.
const onlineName = ref(room.lastRoom?.name ?? "");
const joinCode = ref("");
const onlineError = ref("");

// Prefill kode join dari link share (?room=ABC123).
onMounted(() => {
  const params = new URLSearchParams(location.search);
  const r = params.get("room");
  if (r) {
    joinCode.value = r
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }
});

function createChessRoom() {
  const name = onlineName.value.trim().slice(0, 20);
  if (!name) {
    onlineError.value = "Isi nama kamu dulu.";
    return;
  }
  onlineError.value = "";
  const code = generateRoomCode();
  room.connect(code, {
    mode: "create-chess",
    name,
    color: CURSOR_COLORS[0]!,
  });
}

function joinChessRoom() {
  const name = onlineName.value.trim().slice(0, 20);
  if (!name) {
    onlineError.value = "Isi nama kamu dulu.";
    return;
  }
  const c = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 6) {
    onlineError.value = "Kode room harus 6 karakter.";
    return;
  }
  onlineError.value = "";
  room.connect(c, {
    mode: "join-chess",
    name,
    color: CURSOR_COLORS[0]!,
  });
}

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

    <div class="my-5 flex items-center gap-3 text-xs text-subtle">
      <span class="h-px flex-1 bg-hairline" />
      atau online
      <span class="h-px flex-1 bg-hairline" />
    </div>

    <h2 class="text-sm font-semibold text-ink">Main online</h2>
    <p class="mt-1 text-xs text-muted">
      Main lawan teman lewat room, real-time. Yang buat room jadi
      Putih, yang join jadi Hitam.
    </p>
    <label
      class="mt-3 block text-sm font-semibold text-ink"
      for="chess-online-name"
    >
      Nama kamu
    </label>
    <input
      id="chess-online-name"
      v-model="onlineName"
      type="text"
      maxlength="20"
      placeholder="mis. Zaky"
      class="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
    />
    <button
      type="button"
      :disabled="room.status === 'connecting'"
      class="mt-3 w-full rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-40"
      @click="createChessRoom"
    >
      {{
        room.status === "connecting" ? "Menghubungkan..." : "Buat room catur"
      }}
    </button>
    <div class="mt-3 flex gap-2">
      <input
        v-model="joinCode"
        type="text"
        maxlength="6"
        placeholder="Kode 6 huruf"
        class="w-full min-w-0 flex-1 rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-center text-sm font-bold tracking-[0.2em] text-ink uppercase outline-none focus:border-primary tabular-nums"
      />
      <button
        type="button"
        :disabled="room.status === 'connecting'"
        class="shrink-0 rounded-full bg-surface-2 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-3 disabled:opacity-40"
        @click="joinChessRoom"
      >
        Join
      </button>
    </div>
    <p
      v-if="onlineError || room.error"
      class="mt-3 text-center text-xs text-red-500"
    >
      {{ onlineError || room.error }}
    </p>
  </div>
</template>
