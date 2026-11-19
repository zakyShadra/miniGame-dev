<!-- Kontrol sentuh naval (mobile): joystick virtual kiri (gerak),
area aim kanan (drag/tap arahkan turet), tombol tembak + kemampuan.
Hanya tampil di perangkat pointer kasar (HP/tablet); desktop tidak
terpengaruh. Joystick mengirim input analog -1..1; parent meneruskan
ke store (game solo / remote). -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ShipInput } from "../../../../../shared/naval/types";
import { ensureAudio } from "../../../lib/sound";
import NavalMuteButton from "./NavalMuteButton.vue";

defineProps<{ abilityName: string }>();

const emit = defineEmits<{
  input: [input: ShipInput];
  fire: [];
  ability: [];
  aim: [clientX: number, clientY: number];
}>();

// Hanya perangkat sentuh (pointer kasar). Laptop layar sentuh
// (pointer halus) tetap pakai kontrol desktop.
const isTouch = ref(false);
onMounted(() => {
  isTouch.value =
    window.matchMedia("(pointer: coarse)").matches ||
    "ontouchstart" in window;
});

// Joystick: pusat tetap di tengah zona; kenop mengikuti jari dalam
// radius 44px dari pusat.
const joyZone = ref<HTMLDivElement | null>(null);
const joyId = ref<number | null>(null);
const joyKnob = ref({ x: 0, y: 0 });
const JOY_RADIUS = 44;

function joyCenter(): { x: number; y: number } {
  const el = joyZone.value;
  if (!el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function joyUpdate(clientX: number, clientY: number): void {
  const c = joyCenter();
  let dx = clientX - c.x;
  let dy = clientY - c.y;
  const d = Math.hypot(dx, dy);
  if (d > JOY_RADIUS) {
    dx = (dx / d) * JOY_RADIUS;
    dy = (dy / d) * JOY_RADIUS;
  }
  joyKnob.value = { x: dx, y: dy };
  // Zona mati kecil supaya jempol diam tidak menggerakkan kapal.
  const nx = Math.abs(dx / JOY_RADIUS) < 0.12 ? 0 : dx / JOY_RADIUS;
  const ny = Math.abs(dy / JOY_RADIUS) < 0.12 ? 0 : dy / JOY_RADIUS;
  // Atas = maju (throttle +), kanan = belok kanan (rudder +).
  emit("input", { throttle: -ny, rudder: nx });
}

function joyStart(e: PointerEvent): void {
  if (joyId.value !== null) return;
  ensureAudio();
  joyId.value = e.pointerId;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  joyUpdate(e.clientX, e.clientY);
}

function joyMove(e: PointerEvent): void {
  if (e.pointerId !== joyId.value) return;
  joyUpdate(e.clientX, e.clientY);
}

function joyEnd(e: PointerEvent): void {
  if (e.pointerId !== joyId.value) return;
  joyId.value = null;
  joyKnob.value = { x: 0, y: 0 };
  emit("input", { throttle: 0, rudder: 0 });
}

// Area aim: drag/tap di separuh kanan layar mengarahkan turet.
function aimAt(e: PointerEvent): void {
  emit("aim", e.clientX, e.clientY);
}
</script>

<template>
  <div
    v-if="isTouch"
    class="pointer-events-none absolute inset-0 z-20 select-none"
    style="touch-action: none"
  >
    <!-- Area aim: separuh kanan layar (di bawah tombol, di atas canvas). -->
    <div
      class="pointer-events-auto absolute top-0 right-0 bottom-0 w-[55%]"
      style="touch-action: none"
      @pointerdown="aimAt"
      @pointermove="aimAt"
    />

    <!-- Tombol mute (mobile): kanan atas, di bawah panel HUD lawan. -->
    <div class="pointer-events-auto absolute top-32 right-3">
      <NavalMuteButton />
    </div>

    <!-- Joystick kiri bawah. -->
    <div
      ref="joyZone"
      class="pointer-events-auto absolute bottom-28 left-4 flex h-36 w-36 items-center justify-center"
      style="touch-action: none"
      @pointerdown="joyStart"
      @pointermove="joyMove"
      @pointerup="joyEnd"
      @pointercancel="joyEnd"
    >
      <div
        class="absolute h-28 w-28 rounded-full border border-white/30 bg-[rgba(4,24,32,0.45)] backdrop-blur-sm"
      />
      <div
        class="absolute h-14 w-14 rounded-full border border-white/40 bg-white/25 shadow-lg backdrop-blur-sm"
        :style="{ transform: `translate(${joyKnob.x}px, ${joyKnob.y}px)` }"
      />
      <div
        class="pointer-events-none absolute -bottom-1 text-[10px] font-bold tracking-widest text-white/70 drop-shadow"
      >
        GERAK
      </div>
    </div>

    <!-- Tombol tembak + kemampuan (kanan bawah). -->
    <div class="absolute right-4 bottom-28 flex items-end gap-3">
      <button
        type="button"
        aria-label="Kemampuan"
        class="pointer-events-auto flex h-16 w-16 flex-col items-center justify-center rounded-full border-2 border-[#e8a33d] bg-[rgba(4,24,32,0.7)] text-white shadow-lg backdrop-blur-sm active:bg-[#e8a33d]/40"
        style="touch-action: none"
        @pointerdown.prevent="ensureAudio(); emit('ability')"
      >
        <span class="text-lg leading-none font-bold">&#9733;</span>
        <span class="mt-0.5 max-w-14 truncate text-[8px] font-bold tracking-wider uppercase">
          {{ abilityName }}
        </span>
      </button>
      <button
        type="button"
        aria-label="Tembak"
        class="pointer-events-auto flex h-20 w-20 flex-col items-center justify-center rounded-full border-2 border-[#ff5a47] bg-[rgba(120,20,10,0.75)] text-white shadow-lg backdrop-blur-sm active:bg-[#ff5a47]/50"
        style="touch-action: none"
        @pointerdown.prevent="ensureAudio(); emit('fire')"
      >
        <span class="text-xl leading-none font-bold">&#9679;</span>
        <span class="mt-0.5 text-[9px] font-bold tracking-wider">TEMBAK</span>
      </button>
    </div>
  </div>
</template>
