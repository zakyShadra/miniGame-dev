<!-- Layar game katak: setup (pilih katak) lalu bengkel 3D + HUD.
HUD compact: lalat kiri atas, status lidah tengah, timer + keluar kanan. -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useFrogStore, type FrogColorChoice } from "../stores/frog";
import ThemeToggle from "../../../components/ThemeToggle.vue";

const store = useFrogStore();
defineEmits<{ exit: [] }>();

const canvasWrap = ref<HTMLDivElement | null>(null);

// Pasang game begitu layar playing ter-render.
watch(
  () => store.phase,
  async (p) => {
    if (p === "playing") {
      await nextTick();
      if (canvasWrap.value) store.attachGame(canvasWrap.value);
    }
  },
);

onUnmounted(() => store.toSetup());

function start() {
  store.begin();
}

function exit() {
  store.toSetup();
}

function selectColor(c: FrogColorChoice) {
  // Ungu baru dibuka di F2 (co-op); F1 solo hanya oranye.
  if (c === "orange") store.selectedColor = c;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const timerText = computed(() => fmtTime(store.hud.time));
const winTimeText = computed(() => fmtTime(store.winTime));

const tongueLabel = computed(() => {
  if (store.hud.tongueMode === "attached") return "Lidah menempel, lompat untuk lepas";
  if (store.hud.tongueMode === "flying") return "Lidah meluncur...";
  return "Lidah siap";
});
</script>

<template>
  <!-- SETUP: kartu cozy sesuai DESIGN.md. -->
  <div
    v-if="store.phase === 'setup'"
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
          <h1 class="font-display text-2xl font-bold text-ink">Katak Penyihir</h1>
          <p class="mt-0.5 text-sm text-muted">
            Lompat dan ayunkan lidahmu melewati bengkel penyihir. Kumpulkan 5
            lalat, capai portal di ujung.
          </p>
        </div>
      </div>

      <h2 class="mt-6 text-xs font-bold tracking-widest text-muted uppercase">
        Pilih katak
      </h2>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          class="rounded-xl border-2 p-3 text-left transition"
          :class="
            store.selectedColor === 'orange'
              ? 'border-primary bg-surface-2'
              : 'border-hairline bg-surface-1 hover:border-primary'
          "
          @click="selectColor('orange')"
        >
          <span class="flex items-center gap-2">
            <span class="h-4 w-4 rounded-full bg-[#ff8c42]" />
            <span class="font-display font-bold text-ink">Oranye</span>
          </span>
          <span class="mt-1 block text-xs text-muted">Katak solo F1</span>
        </button>
        <button
          type="button"
          disabled
          class="cursor-not-allowed rounded-xl border border-hairline bg-surface-1 p-3 text-left opacity-60"
        >
          <span class="flex items-center gap-2">
            <span class="h-4 w-4 rounded-full bg-[#8b5cf6]" />
            <span class="font-display font-bold text-ink">Ungu</span>
            <svg class="ml-auto h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </span>
          <span class="mt-1 block text-xs text-muted">Dibuka di co-op (F2)</span>
        </button>
      </div>

      <h2 class="mt-5 text-xs font-bold tracking-widest text-muted uppercase">
        Kontrol
      </h2>
      <ul class="mt-2 space-y-1 text-sm text-body">
        <li><b class="text-ink">WASD</b> gerak &middot; <b class="text-ink">Spasi</b> lompat</li>
        <li><b class="text-ink">Klik kiri / J</b> tembak lidah ke lentera, tekan lagi untuk lepas</li>
        <li><b class="text-ink">K</b> kroak &middot; <b class="text-ink">Drag mouse</b> putar kamera &middot; <b class="text-ink">Scroll</b> zoom</li>
      </ul>
      <p class="mt-3 text-xs text-subtle">
        Jurang di tengah level hanya bisa dilewati dengan berayun: bidik
        lentera di atas jurang, ayun, lalu lompat saat sampai seberang.
      </p>

      <button
        type="button"
        class="mt-6 w-full rounded-full bg-primary py-3 font-display text-base font-bold text-white shadow-md transition hover:bg-primary-hover"
        @click="start"
      >
        Mulai Main
      </button>
      <p class="mt-3 text-center text-xs text-subtle">
        Paling enak dimainkan dengan keyboard + mouse.
      </p>
    </div>
  </div>

  <!-- PLAYING / WON: bengkel 3D + HUD. -->
  <div v-else class="relative h-screen w-full overflow-hidden bg-[#2a1f16]">
    <div ref="canvasWrap" class="absolute inset-0"></div>

    <!-- Bubble kroak di atas katak. -->
    <div
      v-if="store.croakPos && store.phase === 'playing'"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl border border-hairline bg-surface-1 px-3 py-1.5 font-display text-sm font-bold text-ink shadow-md"
      :style="{ left: `${store.croakPos.x}px`, top: `${store.croakPos.y}px` }"
    >
      Kroak!
    </div>

    <!-- HUD atas: lalat (kiri), lidah (tengah), timer + keluar (kanan). -->
    <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
      <div class="flex items-center gap-2 rounded-full border border-hairline bg-surface-1 px-4 py-2 shadow-md">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-ink"><circle cx="12" cy="14" r="5" /><path d="M8 9 5 4l5 2M16 9l3-5-5 2" /><circle cx="10" cy="13" r="1" fill="currentColor" /><circle cx="14" cy="13" r="1" fill="currentColor" /></svg>
        <span class="font-display text-sm font-bold text-ink tabular-nums">
          {{ store.hud.fliesGot }} / {{ store.hud.fliesTotal }}
        </span>
        <span class="text-xs text-muted">lalat</span>
      </div>

      <div
        class="hidden items-center gap-2 rounded-full border border-hairline bg-surface-1 px-4 py-2 text-xs font-semibold shadow-md sm:flex"
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
          @click="exit"
        >
          &larr; Lobby
        </button>
      </div>
    </div>

    <!-- Hint kontrol (bawah, ringkas). -->
    <div
      v-if="store.phase === 'playing'"
      class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3"
    >
      <div class="rounded-full border border-hairline bg-surface-1 px-4 py-2 text-center text-xs font-medium text-muted shadow-md">
        WASD gerak &middot; Spasi lompat &middot; Klik kiri / J lidah &middot; K kroak &middot; Drag orbit &middot; Scroll zoom
      </div>
    </div>

    <!-- Modal menang. -->
    <div
      v-if="store.phase === 'won'"
      class="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
    >
      <div class="w-full max-w-sm rounded-2xl bg-surface-1 p-6 text-center shadow-lg">
        <h2 class="font-display text-2xl font-bold text-ink">Level selesai!</h2>
        <p class="mt-2 text-sm text-muted">
          Kamu mencapai portal dalam {{ winTimeText }} dan makan
          {{ store.winFlies }} dari 5 lalat.
        </p>
        <button
          type="button"
          class="mt-5 w-full rounded-full bg-primary py-3 font-display text-base font-bold text-white transition hover:bg-primary-hover"
          @click="store.rematch()"
        >
          Main Lagi
        </button>
        <button
          type="button"
          class="mt-2 w-full rounded-full border border-hairline-strong bg-surface-2 py-3 font-display text-base font-bold text-ink transition hover:bg-surface-3"
          @click="exit"
        >
          Kembali ke Lobby
        </button>
      </div>
    </div>
  </div>
</template>
