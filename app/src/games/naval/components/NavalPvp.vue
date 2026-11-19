<!-- Layar naval PvP (duel 1v1 online): form buat/gabung room, lalu
laut 3D + HUD meniru NavalCoop.vue. Host memilih map; tanpa level
bot dan tanpa unlock (PvP independen dari progresi solo/co-op).
Game over + rematch lewat server (dua pemain setuju). -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useNavalPvpStore } from "../stores/navalPvp";
import { getMap, MAPS } from "../../../../../shared/naval/maps";
import { SHIP_LIST, getShipDef } from "../../../../../shared/naval/ships";
import type { ShipId } from "../../../../../shared/naval/types";
import { CURSOR_COLORS } from "../../../lib/party";
import NavalMinimap from "./NavalMinimap.vue";
import NavalMuteButton from "./NavalMuteButton.vue";
import ThemeToggle from "../../../components/ThemeToggle.vue";
import NavalTouchControls from "./NavalTouchControls.vue";

const store = useNavalPvpStore();
defineEmits<{ exit: [] }>();

const canvasWrap = ref<HTMLDivElement | null>(null);
// Posisi kursor (buat crosshair).
const crossX = ref(-100);
const crossY = ref(-100);

// Form: nama + kapal + map + kode gabung.
const playerName = ref("");
const selectedShip = ref<ShipId>("frigate");
const selectedMap = ref("teluk");
const joinCode = ref("");

function trackMouse(e: MouseEvent): void {
  crossX.value = e.clientX;
  crossY.value = e.clientY;
}

// Pasang game begitu layar playing ter-render (termasuk rematch:
// gameKey naik tiap match baru).
watch(
  () => [store.phase, store.gameKey] as const,
  async ([p]) => {
    if (p === "playing") {
      await nextTick();
      if (canvasWrap.value) store.attachGame(canvasWrap.value);
    }
  },
);

onUnmounted(() => store.disconnect());

function randomColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]!;
}

function createRoom() {
  store.connectCreate(
    playerName.value.trim() || "Pemain",
    randomColor(),
    selectedShip.value,
    selectedMap.value,
  );
}

function joinRoom() {
  const code = joinCode.value.trim().toUpperCase();
  if (code.length < 6) return;
  store.connectJoin(code, playerName.value.trim() || "Pemain", randomColor(), selectedShip.value);
}

function selectShip(id: ShipId) {
  selectedShip.value = id;
}

function selectMap(id: string) {
  selectedMap.value = id;
}

function backToForm() {
  store.disconnect();
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

// Map aktif buat minimap (dari room; default teluk sebelum room ada).
const activeMap = computed(() =>
  store.room ? getMap(store.room.mapId) : getMap("teluk"),
);

const overTitle = computed(() => {
  if (store.winner === "win") return "KAMU MENANG!";
  if (store.winner === "lose") return "KAPALMU TENGGELAM";
  return "SERI!";
});
const overSub = computed(() => {
  if (store.winner === "win") return "Kapal lawan tenggelam ke dasar laut.";
  if (store.winner === "lose") return "Lawan menang. Coba lagi, Kapiten.";
  return "Waktu habis. HP kedua kapal sama.";
});

const aimLabel = computed(() => {
  const h = store.hud;
  if (h.aimDist < 0) return "";
  if (h.aimOutOfRange) return "Di luar jangkauan meriam";
  return `${Math.round(h.aimDist)} m, lead ${h.aimLead.toFixed(1).replace(".", ",")} detik`;
});
</script>

<template>
  <!-- FORM: buat room baru atau gabung dengan kode. -->
  <div
    v-if="store.phase === 'form'"
    class="flex min-h-screen flex-col items-center justify-center gap-4 bg-[linear-gradient(180deg,#0a3a4f_0%,#041824_60%,#020f18_100%)] p-4"
  >
    <div class="flex w-full items-start justify-between">
      <button
        type="button"
        class="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
      @click="$emit('exit')"
    >
      &larr; Semua game
    </button>
      <ThemeToggle glass />
    </div>
    <div class="w-full max-w-xl">
      <h1 class="text-center font-pirate text-5xl tracking-wide text-[#e8a33d] sm:text-6xl">
        NAVAL PVP
      </h1>
      <p class="mt-2 text-center text-sm text-white/70">
        Duel 1v1 lawan pemain lain. Buat room, bagikan kodenya ke lawanmu,
        dan tenggelamkan kapalnya sebelum waktumu habis.
      </p>

      <h2 class="mt-6 text-xs font-bold tracking-widest text-white/60 uppercase">
        Namamu
      </h2>
      <input
        v-model="playerName"
        type="text"
        maxlength="20"
        placeholder="Kapiten..."
        class="mt-2 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-white placeholder-white/40 backdrop-blur outline-none focus:border-[#e8a33d]"
      />

      <h2 class="mt-5 text-xs font-bold tracking-widest text-white/60 uppercase">
        Pilih kapal
      </h2>
      <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="s in SHIP_LIST"
          :key="s.id"
          type="button"
          class="rounded-xl border p-3 text-left backdrop-blur transition"
          :class="
            selectedShip === s.id
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
        Pilih map
      </h2>
      <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          v-for="m in MAPS"
          :key="m.id"
          type="button"
          class="rounded-xl border p-3 text-left backdrop-blur transition"
          :class="
            selectedMap === m.id
              ? 'border-[#e8a33d] bg-white/15 shadow-sm'
              : 'border-white/15 bg-white/10 hover:border-[#e8a33d]'
          "
          @click="selectMap(m.id)"
        >
          <span class="font-display font-bold text-white">{{ m.name }}</span>
          <span class="mt-1 block text-xs text-white/60">
            {{ m.islands.length }} pulau &middot; arena {{ m.arenaRadius * 2 }} m
          </span>
        </button>
      </div>

      <div
        v-if="store.error"
        class="mt-4 rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200"
      >
        {{ store.error }}
      </div>

      <button
        type="button"
        class="mt-6 w-full rounded-full bg-[#e8a33d] py-3 font-display text-base font-bold text-[#10222d] shadow-md transition hover:bg-[#f2b45c] disabled:opacity-50"
        :disabled="store.status === 'connecting'"
        @click="createRoom"
      >
        {{ store.status === "connecting" ? "Menghubungkan..." : "Buat Room" }}
      </button>

      <div class="mt-6 flex items-center gap-3 text-xs font-bold tracking-widest text-white/40 uppercase">
        <span class="h-px flex-1 bg-white/15" />
        atau gabung room lawan
        <span class="h-px flex-1 bg-white/15" />
      </div>
      <div class="mt-3 flex gap-2">
        <input
          v-model="joinCode"
          type="text"
          maxlength="6"
          placeholder="KODE 6 HURUF"
          class="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-4 py-3 font-timer text-lg tracking-[0.3em] text-white placeholder-white/40 uppercase backdrop-blur outline-none focus:border-[#e8a33d]"
          @keyup.enter="joinRoom"
        />
        <button
          type="button"
          class="shrink-0 rounded-full border border-white/20 bg-white/10 px-5 py-3 font-display text-base font-bold text-white transition hover:bg-white/20 disabled:opacity-50"
          :disabled="joinCode.trim().length < 6 || store.status === 'connecting'"
          @click="joinRoom"
        >
          Gabung
        </button>
      </div>

      <h2 class="mt-6 text-xs font-bold tracking-widest text-white/60 uppercase">
        Kontrol
      </h2>
      <ul class="mt-2 space-y-1 text-sm text-white/80">
        <li><b class="text-white">W/S</b> maju/mundur &middot; <b class="text-white">A/D</b> belok kiri/kanan</li>
        <li><b class="text-white">Mouse</b> arahkan turet &middot; <b class="text-white">Klik kiri</b> tembak &middot; <b class="text-white">Spasi</b> kemampuan</li>
        <li><b class="text-white">Klik kanan + drag</b> orbit kamera &middot; <b class="text-white">Scroll</b> zoom &middot; <b class="text-white">Q/E</b> orbit</li>
      </ul>
    </div>
  </div>

  <!-- WAITING: kode room + daftar pemain. -->
  <div
    v-else-if="store.phase === 'waiting'"
    class="flex min-h-screen flex-col items-center justify-center gap-4 bg-[linear-gradient(180deg,#0a3a4f_0%,#041824_60%,#020f18_100%)] p-4"
  >
    <div class="w-full max-w-md text-center">
      <h1 class="font-pirate text-4xl tracking-wide text-[#e8a33d]">MENUNGGU LAWAN...</h1>
      <p class="mt-2 text-sm text-white/70">
        Bagikan kode ini ke lawanmu. Duel dimulai begitu dia gabung.
      </p>
      <div class="mt-6 rounded-3xl border border-[#e8a33d]/30 bg-white/5 px-6 py-5 backdrop-blur">
        <div class="text-xs font-bold tracking-widest text-white/60 uppercase">Kode room</div>
        <div class="mt-1 font-timer text-5xl font-bold tracking-[0.25em] text-white">
          {{ store.code }}
        </div>
        <div class="mt-2 text-xs text-white/50">
          {{ store.room ? getMap(store.room.mapId).name : "" }}
        </div>
      </div>
      <div class="mt-4 space-y-2">
        <div
          v-for="s in store.room?.seats ?? []"
          :key="s.key"
          class="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left backdrop-blur"
        >
          <span class="font-display font-bold text-white">{{ s.name }}</span>
          <span class="text-xs text-white/60">{{ getShipDef(s.shipId).name }}</span>
        </div>
        <div
          class="animate-pulse rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm text-white/50"
        >
          Kursi lawan kosong, menunggu...
        </div>
      </div>
      <div
        v-if="store.error"
        class="mt-4 rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200"
      >
        {{ store.error }}
      </div>
      <button
        type="button"
        class="mt-6 w-full rounded-full border border-white/20 bg-white/10 py-3 font-display text-base font-bold text-white transition hover:bg-white/20"
        @click="backToForm"
      >
        Batalkan
      </button>
    </div>
  </div>

  <!-- PLAYING / OVER: laut 3D + HUD (meniru NavalCoop.vue). -->
  <div
    v-else
    class="relative h-screen w-full overflow-hidden bg-[#9fd4f0]"
    @mousemove="trackMouse"
  >
    <div ref="canvasWrap" class="absolute inset-0"></div>

    <!-- Kontrol sentuh (hanya tampil di perangkat pointer kasar). -->
    <NavalTouchControls
      v-if="store.phase === 'playing'"
      :ability-name="store.hud.abilityName"
      @input="store.setTouchInput"
      @fire="store.touchFire"
      @ability="store.touchAbility"
      @aim="(x, y) => store.touchAim(x, y)"
    />

    <!-- Crosshair mengikuti mouse. -->
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

    <!-- Banner jeda: lawan terputus, match dijeda. -->
    <div
      v-if="store.phase === 'playing' && store.room?.status === 'paused'"
      class="pointer-events-none absolute inset-x-0 top-[24%] z-10 flex justify-center"
    >
      <div class="rounded-xl border-2 border-[#e8a33d] bg-[rgba(4,24,32,0.85)] px-4 py-2 text-center text-sm font-bold text-white shadow-lg backdrop-blur">
        Lawanmu terputus, match dijeda.<br />
        <span class="font-medium text-white/70">Menunggu reconnect (60 detik).</span>
      </div>
    </div>

    <!-- Banner reconnect: koneksi sendiri terputus. -->
    <div
      v-if="store.phase === 'playing' && store.status === 'connecting'"
      class="pointer-events-none absolute inset-x-0 top-[24%] z-10 flex justify-center"
    >
      <div class="rounded-xl border-2 border-white/30 bg-[rgba(4,24,32,0.85)] px-4 py-2 text-sm font-bold text-white shadow-lg backdrop-blur">
        Menghubungkan ulang...
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

    <!-- HUD atas: pemain (kiri), timer (tengah), lawan (kanan). -->
    <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
      <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-3 py-2 text-white shadow-lg backdrop-blur-md sm:px-4 sm:py-3">
        <div class="text-[10px] font-bold tracking-widest text-white/60">KAMU</div>
        <div class="font-display text-xs font-bold uppercase leading-tight sm:text-sm">{{ store.hud.shipName }}</div>
        <div class="mt-1.5 h-2.5 w-24 overflow-hidden rounded-full bg-white/20 sm:w-40 lg:w-52">
          <div
            class="h-full rounded-full bg-[#3ddc84] transition-all"
            :style="{ width: `${hpPct}%` }"
          />
        </div>
        <div class="mt-1 font-timer text-xs text-white/80">
          Hull {{ store.hud.hp }} / {{ store.hud.maxHp }}
        </div>
      </div>

      <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-3 py-2 text-center text-white shadow-lg backdrop-blur-md sm:px-5">
        <div class="text-[10px] font-bold tracking-widest text-white/60">SISA WAKTU</div>
        <div
          class="font-timer text-2xl font-bold tabular-nums"
          :class="timerUrgent ? 'text-[#ff5a47]' : 'text-white'"
        >
          {{ timerText }}
        </div>
      </div>

      <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-3 py-2 text-right text-white shadow-lg backdrop-blur-md sm:px-4 sm:py-3">
        <div class="text-[10px] font-bold tracking-widest text-white/60">LAWAN</div>
        <div class="font-display text-xs font-bold uppercase leading-tight sm:text-sm">{{ store.hud.dummyName }}</div>
        <template v-if="store.hud.dummyVisible">
          <div class="mt-1.5 h-2.5 w-24 overflow-hidden rounded-full bg-white/20 sm:w-40 lg:w-52">
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
        <div class="rounded-2xl border border-white/10 bg-[rgba(4,24,32,0.75)] px-3 py-2 text-white shadow-lg backdrop-blur-md sm:px-4 sm:py-3">
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
        <NavalMuteButton />
        <ThemeToggle glass />
        <button
          type="button"
          class="pointer-events-auto rounded-full border border-white/20 bg-[rgba(4,24,32,0.75)] px-4 py-2 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-[rgba(4,24,32,0.9)]"
          @click="backToForm"
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
        <div class="mt-4 font-timer text-sm text-white/80">
          Hull kamu {{ store.hud.hp }}/{{ store.hud.maxHp }} &middot;
          Hull lawan {{ store.hud.dummyHp }}/{{ store.hud.dummyMaxHp }}
        </div>
        <button
          v-if="store.rematchWaiting"
          type="button"
          disabled
          class="mt-5 w-full cursor-wait rounded-full bg-white/10 py-3 font-display text-base font-bold text-white/60"
        >
          Menunggu lawan menyetujui rematch...
        </button>
        <button
          v-else
          type="button"
          class="mt-5 w-full rounded-full bg-[#e8a33d] py-3 font-display text-base font-bold text-[#10222d] transition hover:bg-[#f2b45c]"
          @click="store.sendRematch()"
        >
          {{ store.rematchOffered ? "Terima Rematch" : "Rematch" }}
        </button>
        <button
          type="button"
          class="mt-2 w-full rounded-full border border-white/20 bg-white/10 py-3 font-display text-base font-bold text-white transition hover:bg-white/20"
          @click="backToForm"
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
