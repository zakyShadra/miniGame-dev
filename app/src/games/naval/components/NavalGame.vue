<!-- Layar game naval: setup (pilih kapal) lalu laut 3D + HUD.
HUD mengikuti layout preview yang di-approve Zaky: panel kaca gelap,
HP pemain kiri atas, timer tengah atas, HP musuh kanan atas, kecepatan
+ minimap kiri bawah, reload + kemampuan kanan bawah. -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useNavalStore, type NavalLevel } from "../stores/naval";
import { BOT_LEVELS, type BotLevel } from "../../../../../shared/naval/bot";
import { getMap } from "../../../../../shared/naval/maps";
import { SHIP_LIST, getShipDef } from "../../../../../shared/naval/ships";
import type { ShipId } from "../../../../../shared/naval/types";
import NavalCoop from "./NavalCoop.vue";
import NavalMinimap from "./NavalMinimap.vue";
import NavalPvp from "./NavalPvp.vue";

const store = useNavalStore();
defineEmits<{ exit: [] }>();

const canvasWrap = ref<HTMLDivElement | null>(null);
// Mode layar naval: solo (vs bot sendiri), co-op (berdua vs bot),
// atau PvP (duel 1v1 online).
type NavalMode = "solo" | "coop" | "pvp";
const mode = ref<NavalMode>("solo");
// Computed di script (tidak dipersempit control-flow template seperti
// perbandingan langsung di dalam cabang v-else-if).
const isSolo = computed(() => mode.value === "solo");
const isCoop = computed(() => mode.value === "coop");
const isPvp = computed(() => mode.value === "pvp");
// Posisi kursor (buat crosshair).
const crossX = ref(-100);
const crossY = ref(-100);

function trackMouse(e: MouseEvent): void {
  crossX.value = e.clientX;
  crossY.value = e.clientY;
}

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
const timerText = computed(() => {
  const t = Math.ceil(store.hud.timeLeft);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
});
const timerUrgent = computed(() => store.hud.timeLeft < 30);
const throttleSegs = computed(() => {
  const frac = Math.min(1, Math.abs(store.hud.speed) / Math.max(1, store.hud.maxSpeed));
  return Math.round(frac * 4);
});
const distanceText = computed(() => `${Math.round(store.hud.distance)} m`);
const reloadText = computed(() =>
  store.hud.reloadLeft <= 0 ? "SIAP" : `${store.hud.reloadLeft.toFixed(1)} d`,
);
const abilityText = computed(() =>
  store.hud.abilityLeft <= 0 ? "SIAP" : `${store.hud.abilityLeft.toFixed(0)} d`,
);
// Lingkaran progres reload/kemampuan (r=26).
const CIRC = 2 * Math.PI * 26;
const reloadOffset = computed(() => CIRC * (1 - store.hud.reloadFrac));
const abilityOffset = computed(() => CIRC * (1 - store.hud.abilityFrac));

const overTitle = computed(() => {
  if (store.winner === "player") return "KAPITEN MENANG!";
  if (store.winner === "dummy") return "KAPALMU TENGGELAM";
  return "SERI!";
});
const overSub = computed(() => {
  if (store.hud.dummyHp <= 0) return "Kapal musuh tenggelam ke dasar laut.";
  if (store.hud.hp <= 0) return "Kapalmu tenggelam. Coba lagi, Kapiten.";
  return "Waktu habis. Pemenang ditentukan HP tertinggi.";
});

const aimLabel = computed(() => {
  const h = store.hud;
  if (h.aimDist < 0) return "";
  if (h.aimOutOfRange) return "Di luar jangkauan meriam";
  return `${Math.round(h.aimDist)} m, lead ${h.aimLead.toFixed(1).replace(".", ",")} detik`;
});

function selectShip(id: ShipId) {
  store.selectedShip = id;
}

// Level solo vs bot: nomor -> BotLevel, info (label/map/kapal) dari BOT_LEVELS.
const LEVELS: { num: NavalLevel; botLevel: BotLevel }[] = [
  { num: 1, botLevel: "medium" },
  { num: 2, botLevel: "hard" },
  { num: 3, botLevel: "extreme" },
];

function levelInfo(botLevel: BotLevel) {
  const info = BOT_LEVELS[botLevel];
  return {
    label: info.label,
    mapName: getMap(info.mapId).name,
    shipName: getShipDef(info.botShip).name,
  };
}

function selectLevel(num: NavalLevel) {
  if (num <= store.unlockedLevel) store.level = num;
}

// Map aktif buat minimap (per level solo).
const activeMap = computed(() => {
  const botLevel = LEVELS.find((l) => l.num === store.level)?.botLevel ?? "medium";
  return getMap(BOT_LEVELS[botLevel].mapId);
});
</script>

<template>
  <!-- CO-OP: layar room + game berdua vs bot (komponen mandiri). -->
  <NavalCoop v-if="mode === 'coop'" @exit="mode = 'solo'" />

  <!-- PVP: duel 1v1 online (komponen mandiri). -->
  <NavalPvp v-else-if="mode === 'pvp'" @exit="mode = 'solo'" />

  <!-- SETUP: menu gelap ala preview (NAVAL DUEL, emas + kaca gelap). -->
  <div
    v-else-if="store.phase === 'setup'"
    class="flex min-h-screen flex-col items-center justify-center gap-4 bg-[linear-gradient(180deg,#0a3a4f_0%,#041824_60%,#020f18_100%)] p-4"
  >
    <button
      type="button"
      class="self-start rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
      @click="$emit('exit')"
    >
      &larr; Semua game
    </button>
    <div class="w-full max-w-xl">
      <h1 class="text-center font-pirate text-5xl tracking-wide text-[#e8a33d] sm:text-6xl">
        NAVAL DUEL
      </h1>
      <p class="mt-2 text-center text-sm text-white/70">
        Duel kapal 3D ala World of Warships. Pilih kapalmu, berlayar, dan
        tenggelamkan lawan. Main solo lawan bot, mabar berdua lawan bot,
        atau duel 1v1 lawan pemain lain.
      </p>

      <!-- Pilih mode: solo vs bot, co-op berdua vs bot, atau PvP 1v1. -->
      <div class="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          class="rounded-xl border px-3 py-3 text-left backdrop-blur transition"
          :class="
            isSolo
              ? 'border-[#e8a33d] bg-white/15 shadow-sm'
              : 'border-white/15 bg-white/10 hover:border-[#e8a33d]'
          "
          @click="mode = 'solo'"
        >
          <span class="block font-display text-sm font-bold text-white">Solo vs Bot</span>
          <span class="mt-0.5 block text-xs text-white/60">Kamu sendiri lawan bot</span>
        </button>
        <button
          type="button"
          class="rounded-xl border px-3 py-3 text-left backdrop-blur transition"
          :class="
            isCoop
              ? 'border-[#e8a33d] bg-white/15 shadow-sm'
              : 'border-white/15 bg-white/10 hover:border-[#e8a33d]'
          "
          @click="mode = 'coop'"
        >
          <span class="block font-display text-sm font-bold text-white">Co-op vs Bot</span>
          <span class="mt-0.5 block text-xs text-white/60">Berdua lawan bot, lewat room</span>
        </button>
        <button
          type="button"
          class="rounded-xl border px-3 py-3 text-left backdrop-blur transition"
          :class="
            isPvp
              ? 'border-[#e8a33d] bg-white/15 shadow-sm'
              : 'border-white/15 bg-white/10 hover:border-[#e8a33d]'
          "
          @click="mode = 'pvp'"
        >
          <span class="block font-display text-sm font-bold text-white">Battle PvP</span>
          <span class="mt-0.5 block text-xs text-white/60">Duel 1v1, lewat room</span>
        </button>
      </div>

      <h2 class="mt-6 text-xs font-bold tracking-widest text-white/60 uppercase">
        Pilih kapal
      </h2>
      <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="s in SHIP_LIST"
          :key="s.id"
          type="button"
          class="rounded-xl border p-3 text-left backdrop-blur transition"
          :class="
            store.selectedShip === s.id
              ? 'border-[#e8a33d] bg-white/15 shadow-sm'
              : 'border-white/15 bg-white/10 hover:border-[#e8a33d]'
          "
          @click="selectShip(s.id)"
        >
          <span class="flex items-center gap-2">
            <span
              class="h-3 w-3 rounded-full"
              :style="{ backgroundColor: s.sailColor }"
            />
            <span class="font-display font-bold text-white">{{ s.name }}</span>
          </span>
          <span class="mt-1 block text-xs text-white/60">
            HP {{ s.hp }} &middot; {{ s.abilityName }}: {{ s.abilityDesc }}
          </span>
        </button>
      </div>

      <h2 class="mt-5 text-xs font-bold tracking-widest text-white/60 uppercase">
        Pilih level
      </h2>
      <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          v-for="lv in LEVELS"
          :key="lv.num"
          type="button"
          :disabled="lv.num > store.unlockedLevel"
          class="rounded-xl border p-3 text-left backdrop-blur transition"
          :class="
            lv.num > store.unlockedLevel
              ? 'cursor-not-allowed border-white/10 bg-white/5 opacity-60'
              : store.level === lv.num
                ? 'border-[#e8a33d] bg-white/15 shadow-sm'
                : 'border-white/15 bg-white/10 hover:border-[#e8a33d]'
          "
          @click="selectLevel(lv.num)"
        >
          <span class="flex items-center gap-2">
            <span class="font-display font-bold text-white">Level {{ lv.num }}</span>
            <span
              class="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold"
              :class="
                lv.botLevel === 'extreme' ? 'text-[#e8a33d]' : 'text-white/60'
              "
            >
              {{ levelInfo(lv.botLevel).label.toUpperCase() }}
            </span>
          </span>
          <span class="mt-1 block text-xs text-white/60">
            {{ levelInfo(lv.botLevel).mapName }} &middot;
            {{ levelInfo(lv.botLevel).shipName }}
          </span>
          <span
            v-if="lv.num > store.unlockedLevel"
            class="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-white/50"
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Kalahkan level sebelumnya
          </span>
        </button>
      </div>

      <h2 class="mt-5 text-xs font-bold tracking-widest text-white/60 uppercase">
        Kontrol
      </h2>
      <ul class="mt-2 space-y-1 text-sm text-white/80">
        <li><b class="text-white">W/S</b> maju/mundur &middot; <b class="text-white">A/D</b> belok kiri/kanan</li>
        <li><b class="text-white">Mouse</b> arahkan turet &middot; <b class="text-white">Klik kiri</b> tembak &middot; <b class="text-white">Spasi</b> kemampuan</li>
        <li><b class="text-white">Klik kanan + drag</b> orbit kamera &middot; <b class="text-white">Scroll</b> zoom &middot; <b class="text-white">Q/E</b> orbit</li>
      </ul>

      <button
        type="button"
        class="mt-6 w-full rounded-full bg-[#e8a33d] py-3 font-display text-base font-bold text-[#10222d] shadow-md transition hover:bg-[#f2b45c]"
        @click="start"
      >
        Mulai Berlayar
      </button>
    </div>
  </div>

  <!-- PLAYING: laut 3D + HUD. -->
  <div
    v-else
    class="relative h-screen w-full overflow-hidden bg-[#9fd4f0]"
    @mousemove="trackMouse"
  >
    <div ref="canvasWrap" class="absolute inset-0"></div>

    <!-- Crosshair mengikuti mouse (cincin emas + salib putih + label jarak/lead). -->
    <div
      v-if="store.phase === 'playing'"
      class="pointer-events-none absolute z-10"
      :style="{ left: `${crossX}px`, top: `${crossY}px`, transform: 'translate(-50%, -50%)' }"
    >
      <div class="relative h-12 w-12">
        <div class="absolute inset-0 rounded-full border-2 border-[#e8a33d]" />
        <div class="absolute top-1/2 left-1/2 h-[2px] w-7 -translate-x-1/2 -translate-y-1/2 bg-white shadow" />
        <div class="absolute top-1/2 left-1/2 h-7 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-white shadow" />
        <div class="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </div>
      <div
        v-if="aimLabel"
        class="mt-1 -translate-x-1/2 rounded-full bg-[rgba(4,24,32,0.75)] px-2.5 py-1 font-timer text-[11px] whitespace-nowrap text-white backdrop-blur"
        :class="store.hud.aimOutOfRange ? 'text-[#ff5a47]' : ''"
        style="margin-left: 50%"
      >
        {{ aimLabel }}
      </div>
    </div>

    <!-- Peringatan: bidikan terhalang pulau. -->
    <div
      v-if="store.phase === 'playing' && store.hud.aimBlocked && store.hud.aimDist >= 0"
      class="pointer-events-none absolute inset-x-0 top-[18%] z-10 flex justify-center"
    >
      <div class="rounded-xl border-2 border-[#e8a33d] bg-[rgba(4,24,32,0.8)] px-4 py-2 text-sm font-bold text-[#e8a33d] shadow-lg backdrop-blur">
        Terhalang pulau, tembakan tidak akan kena
      </div>
    </div>

    <!-- Angka damage mengambang. -->
    <div
      v-for="n in store.damageNums"
      :key="n.id"
      class="dmg-num pointer-events-none absolute z-10 font-display text-xl font-bold text-[#e8a33d] drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]"
      :style="{ left: `${n.x}px`, top: `${n.y}px` }"
    >
      -{{ n.amount }} HIT
    </div>

    <!-- Flash merah saat kapal pemain kena hit. -->
    <div v-if="store.hitFlash > 0" :key="store.hitFlash" class="hit-flash z-10" />

    <!-- HUD atas: pemain (kiri), timer (tengah), musuh (kanan). -->
    <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
      <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-4 py-3 text-white shadow-lg backdrop-blur-md">
        <div class="text-[10px] font-bold tracking-widest text-white/60">KAMU</div>
        <div class="font-display text-sm font-bold uppercase">{{ store.hud.shipName }}</div>
        <div class="mt-1.5 h-2.5 w-40 overflow-hidden rounded-full bg-white/20 sm:w-52">
          <div
            class="h-full rounded-full bg-[#3ddc84] transition-all"
            :style="{ width: `${hpPct}%` }"
          />
        </div>
        <div class="mt-1 font-timer text-xs text-white/80">
          Hull {{ store.hud.hp }} / {{ store.hud.maxHp }}
        </div>
      </div>

      <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-5 py-2 text-center text-white shadow-lg backdrop-blur-md">
        <div class="text-[10px] font-bold tracking-widest text-white/60">SISA WAKTU</div>
        <div
          class="font-timer text-2xl font-bold tabular-nums"
          :class="timerUrgent ? 'text-[#ff5a47]' : 'text-white'"
        >
          {{ timerText }}
        </div>
      </div>

      <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-4 py-3 text-right text-white shadow-lg backdrop-blur-md">
        <div class="text-[10px] font-bold tracking-widest text-white/60">MUSUH</div>
        <div class="font-display text-sm font-bold uppercase">{{ store.hud.dummyName }}</div>
        <template v-if="store.hud.dummyVisible">
          <div class="mt-1.5 h-2.5 w-40 overflow-hidden rounded-full bg-white/20 sm:w-52">
            <div
              class="h-full rounded-full bg-[#ff5a47] transition-all"
              :style="{ width: `${dummyPct}%` }"
            />
          </div>
          <div class="mt-1 font-timer text-xs text-white/80">
            Hull {{ store.hud.dummyHp }} / {{ store.hud.dummyMaxHp }} &middot; {{ distanceText }}
          </div>
        </template>
        <div v-else class="mt-1.5 max-w-44 text-xs text-[#e8a33d]">
          Bersembunyi di balik pulau
        </div>
      </div>
    </div>

    <!-- HUD bawah: kecepatan + minimap (kiri), hint (tengah), reload (kanan). -->
    <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
      <div class="flex items-end gap-2">
        <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-4 py-3 text-white shadow-lg backdrop-blur-md">
          <div class="font-timer text-2xl leading-none font-bold tabular-nums">
            {{ knots }} <span class="text-xs font-medium text-white/60">knot</span>
          </div>
          <div class="mt-2 flex gap-1">
            <span
              v-for="i in 4"
              :key="i"
              class="h-1.5 w-6 rounded-full"
              :class="i <= throttleSegs ? 'bg-[#12b5a8]' : 'bg-white/20'"
            />
          </div>
          <div class="mt-1.5 text-xs font-semibold text-white/80">
            {{ compass }} {{ Math.round(store.hud.headingDeg) }}&deg;
          </div>
        </div>
        <NavalMinimap
          :px="store.hud.px"
          :pz="store.hud.pz"
          :heading-deg="store.hud.headingDeg"
          :dx="store.hud.dx"
          :dz="store.hud.dz"
          :dummy-visible="store.hud.dummyVisible"
          :map="activeMap"
        />
      </div>

      <div class="hidden items-center gap-2 sm:flex">
        <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-4 py-2 text-center text-xs font-medium text-white/80 backdrop-blur-md">
          WASD gerak &middot; Mouse aim &middot; Klik kiri tembak &middot; Spasi kemampuan &middot; Klik kanan orbit &middot; Scroll zoom
        </div>
        <button
          type="button"
          class="pointer-events-auto rounded-full border border-white/20 bg-[rgba(4,24,32,0.75)] px-4 py-2 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-[rgba(4,24,32,0.9)]"
          @click="exit"
        >
          &larr; Lobby
        </button>
      </div>

      <div class="flex items-end gap-2">
        <div class="flex flex-col items-center gap-1">
          <div class="relative h-16 w-16">
            <svg viewBox="0 0 64 64" class="h-16 w-16 -rotate-90">
              <circle cx="32" cy="32" r="26" fill="rgba(4,24,32,0.75)" stroke="rgba(255,255,255,0.2)" stroke-width="5" />
              <circle
                cx="32" cy="32" r="26" fill="none"
                :stroke="store.hud.reloadLeft <= 0 ? '#e8a33d' : '#12b5a8'"
                stroke-width="5" stroke-linecap="round"
                :stroke-dasharray="CIRC" :stroke-dashoffset="reloadOffset"
              />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center font-timer text-[11px] font-bold text-white">
              {{ reloadText }}
            </span>
          </div>
          <span class="text-[10px] font-bold tracking-widest text-white/80 drop-shadow">MERIAM</span>
        </div>
        <div class="flex flex-col items-center gap-1">
          <div class="relative h-16 w-16">
            <svg viewBox="0 0 64 64" class="h-16 w-16 -rotate-90">
              <circle cx="32" cy="32" r="26" fill="rgba(4,24,32,0.75)" stroke="rgba(255,255,255,0.2)" stroke-width="5" />
              <circle
                cx="32" cy="32" r="26" fill="none"
                :stroke="store.hud.abilityLeft <= 0 ? '#e8a33d' : '#12b5a8'"
                stroke-width="5" stroke-linecap="round"
                :stroke-dasharray="CIRC" :stroke-dashoffset="abilityOffset"
              />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center font-timer text-[11px] font-bold text-white">
              {{ abilityText }}
            </span>
          </div>
          <span class="text-[10px] font-bold tracking-widest text-white/80 uppercase drop-shadow">
            {{ store.hud.abilityName }} &middot; SPASI
          </span>
        </div>
      </div>
    </div>

    <!-- Modal game over. -->
    <div
      v-if="store.phase === 'over'"
      class="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div class="w-full max-w-sm rounded-3xl border border-[#e8a33d]/30 bg-[#10222d]/95 p-6 text-center text-white shadow-2xl">
        <h2 class="font-pirate text-4xl tracking-wide text-[#e8a33d]">{{ overTitle }}</h2>
        <p class="mt-2 text-sm text-white/75">{{ overSub }}</p>
        <div
          v-if="store.justUnlocked"
          class="mt-3 rounded-xl border border-[#e8a33d] bg-[#e8a33d]/15 px-4 py-2 text-sm font-bold text-[#e8a33d]"
        >
          Level {{ store.justUnlocked }} terbuka!
        </div>
        <div class="mt-4 font-timer text-sm text-white/80">
          Hull kamu {{ store.hud.hp }}/{{ store.hud.maxHp }} &middot;
          Hull musuh {{ store.hud.dummyHp }}/{{ store.hud.dummyMaxHp }}
        </div>
        <button
          type="button"
          class="mt-5 w-full rounded-full bg-[#e8a33d] py-3 font-display text-base font-bold text-[#10222d] transition hover:bg-[#f2b45c]"
          @click="store.rematch()"
        >
          Main Lagi
        </button>
        <button
          type="button"
          class="mt-2 w-full rounded-full border border-white/20 bg-white/10 py-3 font-display text-base font-bold text-white transition hover:bg-white/20"
          @click="exit"
        >
          Kembali ke Lobby
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes dmg-float {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -160%);
  }
}
.dmg-num {
  animation: dmg-float 1s ease-out forwards;
}

@keyframes hit-flash-anim {
  0% {
    opacity: 0.6;
  }
  100% {
    opacity: 0;
  }
}
.hit-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    transparent 55%,
    rgba(255, 40, 30, 0.55) 100%
  );
  animation: hit-flash-anim 0.6s ease-out forwards;
}
</style>
