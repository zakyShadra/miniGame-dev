<!-- Layar katak co-op (2 pemain online): form buat/gabung room, lalu
bengkel 3D + HUD co-op. Host = katak oranye, yang gabung = katak ungu. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { CURSOR_COLORS } from "../../../lib/party";
import { useFrogCoopStore } from "../stores/frogCoop";
import ThemeToggle from "../../../components/ThemeToggle.vue";
import FrogLevelSelect from "./FrogLevelSelect.vue";

const store = useFrogCoopStore();
defineEmits<{ exit: [] }>();

const canvasWrap = ref<HTMLDivElement | null>(null);
const playerName = ref("");
const joinCode = ref("");
const copied = ref(false);

// Pasang game begitu layar playing ter-render (termasuk rematch:
// gameKey naik tiap match baru).
watch(
  [() => store.phase, () => store.gameKey],
  async ([p]) => {
    if (p === "playing") {
      await nextTick();
      if (canvasWrap.value) store.attachGame(canvasWrap.value);
    }
  },
);

onUnmounted(() => store.disconnect());

// Prefill kode join dari link share (?room=ABC123).
// QA hook, dev only: ?autoroom=join&room=KODE&name=Nama langsung join
// room (dipakai screenshot QA headless). Tidak jalan di production.
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
    playerName.value = params.get("name") ?? "Zaky";
    if (joinCode.value.length === 6) {
      setTimeout(() => joinRoom(), 300);
    }
  }
});

function validName(): string {
  return playerName.value.trim().slice(0, 20);
}

function createRoom() {
  if (!validName()) {
    store.error = "Isi nama kamu dulu.";
    return;
  }
  store.connectCreate(validName(), CURSOR_COLORS[0]!);
}

function joinRoom() {
  if (!validName()) {
    store.error = "Isi nama kamu dulu.";
    return;
  }
  if (joinCode.value.trim().length < 6) {
    store.error = "Kode room harus 6 huruf.";
    return;
  }
  store.connectJoin(joinCode.value.trim(), validName(), CURSOR_COLORS[1]!);
}

async function copyLink() {
  const link = `${location.origin}/?room=${store.code}`;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    // Clipboard tidak tersedia (http non-secure): biarkan, kode room
    // tetap terlihat dan bisa disalin manual.
  }
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const timerText = computed(() => fmtTime(store.hud.time));
const winTimeText = computed(() => fmtTime(store.winTime));
const shareLink = computed(() => `${location.origin}/?room=${store.code}`);

const tongueLabel = computed(() => {
  if (store.hud.tongueMode === "attached") return "Lidah menempel, lompat untuk lepas";
  if (store.hud.tongueMode === "flying") return "Lidah meluncur...";
  return "Lidah siap";
});
</script>

<template>
  <!-- FORM: buat room baru atau gabung dengan kode. -->
  <div
    v-if="store.phase === 'form'"
    class="relative flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-4"
  >
    <ThemeToggle class="absolute top-4 right-4" />
    <button
      type="button"
      class="absolute top-4 left-4 rounded-full border border-hairline-strong bg-surface-1 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface-2"
      @click="$emit('exit')"
    >
      &larr; Semua game
    </button>
    <div class="w-full max-w-lg rounded-2xl border border-hairline bg-surface-1 p-6 shadow-md">
      <div class="flex items-center gap-4">
        <img src="/icons/frog.svg" alt="" class="h-16 w-16 shrink-0" />
        <div>
          <h1 class="font-display text-2xl font-bold text-ink">Katak Co-op</h1>
          <p class="mt-0.5 text-sm text-muted">
            Mabar 2 katak lewat 4 level. Buat room, bagikan kodenya ke
            temanmu, dan selesaikan puzzle berdua.
          </p>
        </div>
      </div>

      <h2 class="mt-6 text-xs font-bold tracking-widest text-muted uppercase">
        Pilih level
      </h2>
      <div class="mt-2">
        <FrogLevelSelect
          :selected="store.selectedLevel"
          :unlocked="store.unlocked"
          :completed="store.completed"
          @select="store.selectLevel"
        />
      </div>
      <p class="mt-2 text-xs text-subtle">
        Level dipilih pembuat room; yang gabung mengikuti level room.
      </p>

      <h2 class="mt-5 text-xs font-bold tracking-widest text-muted uppercase">
        Namamu
      </h2>
      <input
        v-model="playerName"
        type="text"
        maxlength="20"
        placeholder="Katak..."
        class="mt-2 w-full rounded-xl border border-hairline-strong bg-surface-2 px-4 py-3 text-ink placeholder:text-subtle outline-none focus:border-primary"
      />

      <p class="mt-3 text-sm text-body">
        Pembuat room jadi katak
        <span class="font-bold text-ink">Oranye</span>, yang gabung jadi katak
        <span class="font-bold text-ink">Ungu</span>.
      </p>

      <h2 class="mt-5 text-xs font-bold tracking-widest text-muted uppercase">
        Puzzle berdua
      </h2>
      <ul class="mt-2 space-y-1 text-sm text-body">
        <li>
          <b class="text-ink">Tombol + pintu:</b> satu katak menahan tombol,
          pasangannya lewat pintu, lalu gantian.
        </li>
        <li>
          <b class="text-ink">Ayun pasangan:</b> lentera rapuh hanya tahan
          sekali ayun, katak ke-2 harus ditarik lidah pasangannya.
        </li>
        <li>
          <b class="text-ink">Jamur lompat + buku terbang:</b> melenting dan
          menumpang platform bergerak di level lanjutan.
        </li>
        <li>
          <b class="text-ink">Menang:</b> kedua katak harus sampai portal.
        </li>
      </ul>

      <div
        v-if="store.error"
        class="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        {{ store.error }}
      </div>

      <button
        type="button"
        class="mt-6 w-full rounded-full bg-primary py-3 font-display text-base font-bold text-white shadow-md transition hover:bg-primary-hover disabled:opacity-50"
        :disabled="store.status === 'connecting'"
        @click="createRoom"
      >
        {{ store.status === "connecting" ? "Menghubungkan..." : "Buat Room" }}
      </button>

      <div class="mt-6 flex items-center gap-3 text-xs font-bold tracking-widest text-subtle uppercase">
        <span class="h-px flex-1 bg-hairline" />
        atau gabung room teman
        <span class="h-px flex-1 bg-hairline" />
      </div>
      <div class="mt-3 flex gap-2">
        <input
          v-model="joinCode"
          type="text"
          maxlength="6"
          placeholder="KODE 6 HURUF"
          class="min-w-0 flex-1 rounded-xl border border-hairline-strong bg-surface-2 px-4 py-3 font-mono text-lg tracking-[0.3em] text-ink placeholder:text-subtle uppercase outline-none focus:border-primary"
          @keyup.enter="joinRoom"
        />
        <button
          type="button"
          class="shrink-0 rounded-full border border-hairline-strong bg-surface-2 px-5 py-3 font-display text-base font-bold text-ink transition hover:bg-surface-3 disabled:opacity-50"
          :disabled="joinCode.trim().length < 6 || store.status === 'connecting'"
          @click="joinRoom"
        >
          Gabung
        </button>
      </div>

      <h2 class="mt-6 text-xs font-bold tracking-widest text-muted uppercase">
        Kontrol
      </h2>
      <ul class="mt-2 space-y-1 text-sm text-body">
        <li><b class="text-ink">WASD</b> gerak &middot; <b class="text-ink">Spasi</b> lompat</li>
        <li><b class="text-ink">Klik kiri / J</b> tembak lidah (lentera atau pasangan), tekan lagi untuk lepas</li>
        <li><b class="text-ink">K</b> kroak &middot; <b class="text-ink">Drag mouse</b> putar kamera &middot; <b class="text-ink">Scroll</b> zoom</li>
      </ul>
    </div>
  </div>

  <!-- WAITING: kode room + daftar pemain. -->
  <div
    v-else-if="store.phase === 'waiting'"
    class="relative flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-4"
  >
    <ThemeToggle class="absolute top-4 right-4" />
    <div class="w-full max-w-lg rounded-2xl border border-hairline bg-surface-1 p-6 text-center shadow-md">
      <h1 class="font-display text-2xl font-bold text-ink">Menunggu partner...</h1>
      <p class="mt-1 text-sm text-muted">
        Level: <b class="text-ink">{{ store.roomLevelName }}</b>. Bagikan kode
        ini ke temanmu, atau kirim linknya.
      </p>
      <div class="mt-4 rounded-xl border border-hairline bg-surface-2 px-4 py-3">
        <div class="text-xs font-bold tracking-widest text-muted uppercase">Kode room</div>
        <div class="font-mono text-3xl font-bold tracking-[0.3em] text-ink">
          {{ store.code }}
        </div>
        <div class="mt-1 truncate text-xs text-subtle">{{ shareLink }}</div>
      </div>
      <button
        type="button"
        class="mt-3 w-full rounded-full border border-hairline-strong bg-surface-2 py-2.5 font-display text-sm font-bold text-ink transition hover:bg-surface-3"
        @click="copyLink"
      >
        {{ copied ? "Link tersalin!" : "Salin Link" }}
      </button>
      <div class="mt-5 space-y-2 text-left">
        <div
          v-for="s in store.room?.seats ?? []"
          :key="s.key"
          class="flex items-center gap-2 rounded-xl border border-hairline bg-surface-2 px-4 py-2.5"
        >
          <span
            class="h-4 w-4 rounded-full"
            :class="s.color === 'orange' ? 'bg-[#ff8c42]' : 'bg-[#8b5cf6]'"
          />
          <span class="font-display font-bold text-ink">{{ s.name }}</span>
          <span class="ml-auto text-xs text-muted">
            {{ s.color === "orange" ? "Oranye" : "Ungu" }}
            {{ s.key === store.myKey ? "(kamu)" : "" }}
          </span>
        </div>
        <div
          v-if="(store.room?.seats.length ?? 0) < 2"
          class="rounded-xl border border-dashed border-hairline px-4 py-2.5 text-sm text-subtle"
        >
          Menunggu pemain ke-2 (katak ungu)...
        </div>
      </div>
      <button
        type="button"
        class="mt-5 w-full rounded-full border border-hairline-strong bg-surface-2 py-3 font-display text-base font-bold text-ink transition hover:bg-surface-3"
        @click="store.disconnect()"
      >
        Batalkan
      </button>
    </div>
  </div>

  <!-- PLAYING / OVER: bengkel 3D + HUD co-op. -->
  <div v-else class="relative h-screen w-full overflow-hidden bg-[#2a1f16]">
    <div ref="canvasWrap" class="absolute inset-0"></div>

    <!-- Bubble kroak (saya + pasangan). -->
    <div
      v-if="store.hud.croakMe && store.phase === 'playing'"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl border border-hairline bg-surface-1 px-3 py-1.5 font-display text-sm font-bold text-ink shadow-md"
      :style="{ left: `${store.hud.croakMe.x}px`, top: `${store.hud.croakMe.y}px` }"
    >
      Kroak!
    </div>
    <div
      v-if="store.hud.croakPartner && store.phase === 'playing'"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl border border-hairline bg-surface-1 px-3 py-1.5 font-display text-sm font-bold text-ink shadow-md"
      :style="{ left: `${store.hud.croakPartner.x}px`, top: `${store.hud.croakPartner.y}px` }"
    >
      Kroak!
    </div>

    <!-- HUD atas: lalat + pintu (kiri), lidah (tengah), timer + keluar (kanan). -->
    <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-2 rounded-full border border-hairline bg-surface-1 px-4 py-2 shadow-md">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-ink"><circle cx="12" cy="14" r="5" /><path d="M8 9 5 4l5 2M16 9l3-5-5 2" /><circle cx="10" cy="13" r="1" fill="currentColor" /><circle cx="14" cy="13" r="1" fill="currentColor" /></svg>
          <span class="font-display text-sm font-bold text-ink tabular-nums">
            {{ store.hud.fliesGot }} / {{ store.hud.fliesTotal }}
          </span>
          <span class="text-xs text-muted">lalat</span>
        </div>
        <div
          class="flex items-center gap-2 rounded-full border border-hairline bg-surface-1 px-4 py-2 text-xs font-semibold shadow-md"
          :class="store.hud.doorOpen ? 'text-success' : 'text-body'"
        >
          <span
            class="h-2.5 w-2.5 rounded-full"
            :class="store.hud.doorOpen ? 'bg-success' : 'bg-danger'"
          />
          Pintu {{ store.hud.doorOpen ? "terbuka" : "tertutup" }}
        </div>
        <div class="flex items-center gap-2 rounded-full border border-hairline bg-surface-1 px-4 py-2 text-xs font-semibold text-body shadow-md">
          <span
            class="h-4 w-4 rounded-full"
            :class="store.mySeat?.color === 'orange' ? 'bg-[#ff8c42]' : 'bg-[#8b5cf6]'"
          />
          {{ store.hud.atGoalMe ? "Sampai ✓" : "Belum sampai" }}
          <span class="text-subtle">|</span>
          <span
            class="h-4 w-4 rounded-full"
            :class="store.partnerSeat?.color === 'orange' ? 'bg-[#ff8c42]' : 'bg-[#8b5cf6]'"
          />
          {{ store.partnerSeat?.name ?? "Partner" }}:
          {{ store.hud.atGoalPartner ? "Sampai ✓" : "Belum sampai" }}
        </div>
      </div>

      <div class="hidden items-center gap-2 rounded-full border border-hairline bg-surface-1 px-4 py-2 text-xs font-semibold shadow-md sm:flex"
        :class="store.hud.tongueMode === 'attached' ? 'text-success' : 'text-body'"
      >
        <span
          class="h-2.5 w-2.5 rounded-full"
          :class="store.hud.tongueMode === 'idle' ? 'bg-success' : 'bg-ochre'"
        />
        {{ tongueLabel }}
      </div>

      <div class="flex items-center gap-2">
        <div class="rounded-full border border-hairline bg-surface-1 px-4 py-2 font-display text-sm font-bold text-ink shadow-md tabular-nums">
          {{ timerText }}
        </div>
        <span class="hidden rounded-full border border-hairline bg-surface-1 px-3 py-2 text-xs font-semibold text-muted shadow-md md:inline">
          {{ store.hud.fps }} FPS
        </span>
        <span class="pointer-events-auto rounded-full border border-hairline bg-surface-1 shadow-md">
          <ThemeToggle />
        </span>
        <button
          type="button"
          class="pointer-events-auto rounded-full border border-hairline-strong bg-surface-1 px-4 py-2 text-sm font-semibold text-ink shadow-md transition hover:bg-surface-2"
          @click="store.disconnect()"
        >
          &larr; Lobby
        </button>
      </div>
    </div>

    <!-- Banner partner terputus (match dijeda 60 detik). Di bawah,
         di atas hint kontrol: di atas (top-16) ia menutupi baris
         kedua HUD saat pil HUD membungkus di layar sempit. -->
    <div
      v-if="store.phase === 'playing' && store.partnerGone"
      class="absolute inset-x-0 bottom-16 z-10 flex justify-center p-3"
    >
      <div class="rounded-full border border-warning/40 bg-warning/15 px-4 py-2 text-center text-sm font-semibold text-warning shadow-md">
        Partner terputus, match dijeda. Menunggu kembali (60 detik)...
      </div>
    </div>

    <!-- Hint kontrol (bawah, ringkas). -->
    <div
      v-if="store.phase === 'playing'"
      class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3"
    >
      <div class="rounded-full border border-hairline bg-surface-1 px-4 py-2 text-center text-xs font-medium text-muted shadow-md">
        WASD gerak &middot; Spasi lompat &middot; Klik kiri / J lidah (lentera atau pasangan) &middot; K kroak &middot; Drag orbit &middot; Scroll zoom
      </div>
    </div>

    <!-- Modal menang / bubar. -->
    <div
      v-if="store.phase === 'over'"
      class="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
    >
      <div class="w-full max-w-sm rounded-2xl bg-surface-1 p-6 text-center shadow-lg">
        <template v-if="store.winner === 'players'">
          <h2 class="font-display text-2xl font-bold text-ink">Kalian menang!</h2>
          <p class="mt-2 text-sm text-muted">
            Kedua katak sampai portal dalam {{ winTimeText }} dan makan
            {{ store.winFlies }} dari {{ store.winFliesTotal }} lalat.
          </p>
          <button
            v-if="store.isHost && store.hasNext"
            type="button"
            class="mt-5 w-full rounded-full bg-primary py-3 font-display text-base font-bold text-white transition hover:bg-primary-hover"
            @click="store.sendNextLevel()"
          >
            Level Berikutnya &rarr;
          </button>
          <p v-else-if="store.isHost && !store.hasNext" class="mt-5 text-sm font-semibold text-success">
            Semua level selesai, hebat!
          </p>
          <p v-else-if="store.hasNext" class="mt-5 text-sm font-semibold text-muted">
            Host yang memilih level berikutnya...
          </p>
          <button
            v-if="!store.rematchWaiting"
            type="button"
            class="mt-5 w-full rounded-full bg-primary py-3 font-display text-base font-bold text-white transition hover:bg-primary-hover"
            @click="store.sendRematch()"
          >
            {{ store.rematchOffered ? "Terima Rematch" : "Minta Rematch" }}
          </button>
          <p v-else class="mt-5 text-sm font-semibold text-muted">
            Menunggu partner menyetujui rematch...
          </p>
          <button
            type="button"
            class="mt-2 w-full rounded-full border border-hairline-strong bg-surface-2 py-3 font-display text-base font-bold text-ink transition hover:bg-surface-3"
            @click="store.disconnect()"
          >
            Kembali ke Lobby
          </button>
        </template>
        <template v-else>
          <h2 class="font-display text-2xl font-bold text-ink">Partner terputus</h2>
          <p class="mt-2 text-sm text-muted">
            Partner tidak kembali dalam 60 detik, match bubar. Buat room baru
            untuk main lagi.
          </p>
          <button
            type="button"
            class="mt-5 w-full rounded-full bg-primary py-3 font-display text-base font-bold text-white transition hover:bg-primary-hover"
            @click="store.disconnect()"
          >
            Kembali ke Lobby
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
