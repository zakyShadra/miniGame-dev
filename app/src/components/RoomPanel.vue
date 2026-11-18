<script setup lang="ts">
import { onMounted, ref } from "vue";
import { CURSOR_COLORS, generateRoomCode } from "../lib/party";
import { loadImageSize } from "../lib/images";
import { useGameStore } from "../stores/game";
import { useRoomStore } from "../stores/room";

const game = useGameStore();
const room = useRoomStore();

const nickname = ref(room.lastRoom?.name ?? "");
const color = ref(room.lastRoom?.color ?? CURSOR_COLORS[0]!);
const joinCode = ref("");
const busy = ref(false);
const error = ref("");

// Prefill kode join dari link share (?room=ABC123).
// QA hook, dev only: ?autoroom=join&room=KODE&name=Nama langsung join
// room (dipakai screenshot QA headless, M3). Tidak jalan di production.
onMounted(() => {
  const params = new URLSearchParams(location.search);
  const r = params.get("room");
  if (r) {
    joinCode.value = r
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }
  if (import.meta.env.DEV && params.get("autoroom") === "join") {
    nickname.value = params.get("name") ?? "Zaky";
    if (joinCode.value.length === 6) {
      setTimeout(() => joinRoom(joinCode.value), 300);
    }
  }
});

function validName(): string {
  return nickname.value.trim().slice(0, 20);
}

async function createRoom() {
  const name = validName();
  if (!name) {
    error.value = "Isi nama kamu dulu.";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const { w, h } = await loadImageSize(game.selectedImage.url);
    const code = generateRoomCode();
    room.connect(code, {
      mode: "create",
      name,
      color: color.value,
      createConfig: {
        imageUrl: game.selectedImage.url,
        imageName: game.selectedImage.name,
        imageW: w,
        imageH: h,
        pieceCount: game.selectedCount,
      },
    });
  } catch {
    error.value = "Gambar tidak bisa dimuat. Coba gambar lain.";
  } finally {
    busy.value = false;
  }
}

function joinRoom(code?: string) {
  const name = validName();
  if (!name) {
    error.value = "Isi nama kamu dulu.";
    return;
  }
  const c = (code ?? joinCode.value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (c.length !== 6) {
    error.value = "Kode room harus 6 karakter.";
    return;
  }
  error.value = "";
  room.connect(c, { mode: "join", name, color: color.value });
}

function joinLastRoom() {
  const last = room.lastRoom;
  if (!last) return;
  nickname.value = last.name;
  color.value = last.color;
  joinRoom(last.code);
}
</script>

<template>
  <div class="w-full max-w-md rounded-2xl bg-surface-1 p-6 shadow-md">
    <h2 class="font-display text-2xl font-bold tracking-tight text-ink">
      Main bareng
    </h2>
    <p class="mt-1 text-sm text-muted">
      Buat room, kirim kodenya ke pasangan mainmu.
    </p>

    <label
      class="mt-5 block text-sm font-semibold text-ink"
      for="nickname"
    >
      Nama kamu
    </label>
    <input
      id="nickname"
      v-model="nickname"
      type="text"
      maxlength="20"
      placeholder="mis. Zaky"
      class="mt-1 w-full rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
    />

    <h3 class="mt-4 text-sm font-semibold text-ink">Warna cursor</h3>
    <div class="mt-2 flex gap-2">
      <button
        v-for="c in CURSOR_COLORS"
        :key="c"
        type="button"
        :aria-label="'Warna ' + c"
        class="h-8 w-8 rounded-full transition"
        :class="
          color === c
            ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface-1'
            : 'hover:scale-110'
        "
        :style="{ background: c }"
        @click="color = c"
      />
    </div>

    <button
      type="button"
      :disabled="busy || room.status === 'connecting'"
      class="mt-5 w-full rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-40"
      @click="createRoom"
    >
      {{ room.status === "connecting" ? "Menghubungkan..." : "Buat room" }}
    </button>
    <p class="mt-2 text-center text-xs text-subtle">
      Pakai gambar {{ game.selectedImage.name }} &middot;
      {{ game.selectedCount }} piece (pilih di kartu sebelah).
    </p>

    <div class="my-5 flex items-center gap-3">
      <span class="h-px flex-1 bg-hairline" />
      <span class="text-xs font-semibold text-muted">atau join room</span>
      <span class="h-px flex-1 bg-hairline" />
    </div>

    <div class="flex gap-2">
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
        @click="joinRoom()"
      >
        Join
      </button>
    </div>

    <button
      v-if="room.lastRoom"
      type="button"
      class="mt-3 w-full rounded-full border border-hairline py-2.5 text-sm font-semibold text-body transition hover:bg-surface-2"
      @click="joinLastRoom"
    >
      Lanjut room {{ room.lastRoom.code }} sebagai {{ room.lastRoom.name }}
    </button>

    <p v-if="error || room.error" class="mt-3 text-center text-xs text-red-500">
      {{ error || room.error }}
    </p>
  </div>
</template>
