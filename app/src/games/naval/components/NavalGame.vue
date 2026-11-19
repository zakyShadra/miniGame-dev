<!-- Layar game naval: setup (pilih kapal) lalu laut 3D + HUD.
N1: latihan solo vs kapal dummy yang berlayar melingkar (tanpa tembak). -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useNavalStore } from "../stores/naval";
import { SHIP_LIST } from "../lib/ships";
import type { ShipId } from "../lib/types";

const store = useNavalStore();
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

const compass = computed(() => {
  const dirs = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];
  const i = Math.round(store.hud.headingDeg / 45) % 8;
  return dirs[i]!;
});

const knots = computed(() => (store.hud.speed * 1.944).toFixed(0));
const hpPct = computed(() => Math.round((store.hud.hp / store.hud.maxHp) * 100));
const dummyPct = computed(() =>
  Math.round((store.hud.dummyHp / store.hud.dummyMaxHp) * 100),
);

function selectShip(id: ShipId) {
  if (id === "galleon") store.selectedShip = id;
}
</script>

<template>
  <div
    v-if="store.phase === 'setup'"
    class="flex min-h-screen flex-col items-center justify-center gap-4 p-4"
  >
    <button
      type="button"
      class="self-start rounded-full bg-surface-1 px-4 py-2 text-sm font-semibold text-ink shadow-md transition hover:bg-surface-2"
      @click="$emit('exit')"
    >
      &larr; Semua game
    </button>
    <div class="w-full max-w-xl rounded-2xl bg-surface-1 p-6 shadow-md">
      <h1 class="flex items-center gap-2 font-display text-2xl font-bold text-ink">
        <img src="/icons/ship.svg" alt="" class="h-8 w-8" />
        Kapal Perang
      </h1>
      <p class="mt-1 text-sm text-muted">
        Duel kapal 3D ala World of Warships. Pilih kapalmu, berlayar, dan
        tenggelamkan lawan. Latihan solo dulu, PvP menyusul.
      </p>

      <h2 class="mt-5 text-xs font-bold tracking-wide text-muted uppercase">
        Pilih kapal
      </h2>
      <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="s in SHIP_LIST"
          :key="s.id"
          type="button"
          class="rounded-xl border p-3 text-left transition"
          :class="
            s.id === 'galleon'
              ? store.selectedShip === s.id
                ? 'border-primary bg-white shadow-sm'
                : 'border-hairline bg-white hover:border-primary'
              : 'cursor-not-allowed border-hairline bg-surface-2 opacity-60'
          "
          @click="selectShip(s.id)"
        >
          <span class="flex items-center gap-2">
            <span
              class="h-3 w-3 rounded-full"
              :style="{ backgroundColor: s.sailColor }"
            />
            <span class="font-display font-bold text-ink">{{ s.name }}</span>
            <span
              v-if="s.id !== 'galleon'"
              class="ml-auto rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-bold text-muted"
            >
              SEGERA
            </span>
          </span>
          <span class="mt-1 block text-xs text-muted">
            HP {{ s.hp }} &middot; {{ s.abilityName }}: {{ s.abilityDesc }}
          </span>
        </button>
      </div>

      <h2 class="mt-5 text-xs font-bold tracking-wide text-muted uppercase">
        Kontrol
      </h2>
      <ul class="mt-2 space-y-1 text-sm text-body">
        <li><b>W/S</b> maju/mundur &middot; <b>A/D</b> belok kiri/kanan</li>
        <li><b>Mouse</b> arahkan turet &middot; <b>Klik kanan + drag</b> orbit kamera</li>
        <li><b>Scroll</b> zoom &middot; <b>Q/E</b> orbit kamera</li>
      </ul>

      <button
        type="button"
        class="mt-6 w-full rounded-full bg-primary py-3 font-display text-base font-bold text-white shadow-md transition hover:bg-primary-hover"
        @click="start"
      >
        Mulai Berlayar
      </button>
    </div>
  </div>

  <div v-else class="relative h-screen w-full overflow-hidden bg-[#a8d8f0]">
    <div ref="canvasWrap" class="absolute inset-0"></div>

    <!-- HUD atas -->
    <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
      <button
        type="button"
        class="pointer-events-auto rounded-full bg-surface-1/90 px-4 py-2 text-sm font-semibold text-ink shadow-md backdrop-blur transition hover:bg-surface-1"
        @click="exit"
      >
        &larr; Lobby
      </button>
      <div
        class="rounded-full bg-ink/55 px-4 py-2 text-center text-xs font-semibold text-white backdrop-blur"
      >
        <span v-if="store.hud.dummyVisible">
          Kapal Latihan: {{ store.hud.dummyHp }}/{{ store.hud.dummyMaxHp }} HP
        </span>
        <span v-else>Kapal Latihan bersembunyi di balik pulau</span>
        <span
          class="mx-auto mt-1 block h-1.5 w-32 overflow-hidden rounded-full bg-white/30"
        >
          <span
            class="block h-full rounded-full bg-red-400 transition-all"
            :style="{ width: `${dummyPct}%` }"
          />
        </span>
      </div>
    </div>

    <!-- HUD bawah: HP + kecepatan + kompas -->
    <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
      <div class="rounded-2xl bg-surface-1/90 px-4 py-3 shadow-md backdrop-blur">
        <div class="text-xs font-bold text-muted">HP KAPAL</div>
        <div class="mt-1 h-2.5 w-44 overflow-hidden rounded-full bg-surface-3 sm:w-56">
          <div
            class="h-full rounded-full bg-emerald-500 transition-all"
            :style="{ width: `${hpPct}%` }"
          />
        </div>
        <div class="mt-1 text-xs font-semibold text-body">
          {{ store.hud.hp }} / {{ store.hud.maxHp }}
        </div>
      </div>
      <div class="hidden rounded-2xl bg-ink/55 px-4 py-2 text-center text-xs font-medium text-white backdrop-blur sm:block">
        WASD gerak &middot; Mouse aim &middot; Klik kanan orbit &middot; Scroll zoom
      </div>
      <div class="rounded-2xl bg-surface-1/90 px-4 py-3 text-right shadow-md backdrop-blur">
        <div class="font-display text-lg leading-none font-bold text-ink">
          {{ knots }} <span class="text-xs font-semibold text-muted">knot</span>
        </div>
        <div class="mt-1 text-xs font-semibold text-body">
          {{ compass }} {{ Math.round(store.hud.headingDeg) }}&deg;
        </div>
      </div>
    </div>
  </div>
</template>
