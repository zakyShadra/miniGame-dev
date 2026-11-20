<!-- Kontrol sentuh katak (mobile): joystick virtual kiri (gerak),
tombol lidah + lompat + kroak kanan, drag area tengah untuk orbit
kamera. Hanya tampil di perangkat pointer kasar (HP/tablet); desktop
tidak terpengaruh. Pola sama seperti NavalTouchControls. Lidah
membidik tengah layar (tembak ke lentera yang terlihat di tengah). -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ensureAudio } from "../../../lib/sound";

const emit = defineEmits<{
  move: [x: number, y: number];
  jump: [];
  tongue: [];
  croak: [];
  orbit: [dx: number];
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
  // Zona mati kecil supaya jempol diam tidak menggerakkan katak.
  const nx = Math.abs(dx / JOY_RADIUS) < 0.12 ? 0 : dx / JOY_RADIUS;
  const ny = Math.abs(dy / JOY_RADIUS) < 0.12 ? 0 : dy / JOY_RADIUS;
  emit("move", nx, ny);
}

function joyStart(e: PointerEvent): void {
  if (joyId.value !== null) return;
  ensureAudio();
  joyId.value = e.pointerId;
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    // Capture gagal (pointer sintetik dsb): gerakan tetap ditangani
    // selama jari di atas zona joystick.
  }
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
  emit("move", 0, 0);
}

// Orbit kamera: drag horizontal di area tengah layar (di antara HUD
// atas dan tombol bawah, supaya tidak menutupi keduanya).
const orbitId = ref<number | null>(null);
const orbitLastX = ref(0);

function orbitStart(e: PointerEvent): void {
  if (orbitId.value !== null) return;
  orbitId.value = e.pointerId;
  orbitLastX.value = e.clientX;
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    // Abaikan, gerakan tetap ditangani selama jari di atas area.
  }
}

function orbitMove(e: PointerEvent): void {
  if (e.pointerId !== orbitId.value) return;
  emit("orbit", e.clientX - orbitLastX.value);
  orbitLastX.value = e.clientX;
}

function orbitEnd(e: PointerEvent): void {
  if (e.pointerId !== orbitId.value) return;
  orbitId.value = null;
}
</script>

<template>
  <div
    v-if="isTouch"
    class="pointer-events-none absolute inset-0 z-20 select-none"
    style="touch-action: none"
  >
    <!-- Area orbit: pita tengah layar (di bawah HUD, di atas tombol). -->
    <div
      class="pointer-events-auto absolute inset-x-0 top-28 bottom-44"
      style="touch-action: none"
      @pointerdown="orbitStart"
      @pointermove="orbitMove"
      @pointerup="orbitEnd"
      @pointercancel="orbitEnd"
    />

    <!-- Joystick kiri bawah. -->
    <div
      ref="joyZone"
      class="pointer-events-auto absolute bottom-24 left-4 flex h-36 w-36 items-center justify-center"
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

    <!-- Tombol lidah + lompat + kroak (kanan bawah). -->
    <div class="absolute right-4 bottom-24 flex items-end gap-3">
      <button
        type="button"
        aria-label="Kroak"
        class="pointer-events-auto flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-[#ff8c42] bg-[rgba(4,24,32,0.7)] text-white shadow-lg backdrop-blur-sm active:bg-[#ff8c42]/40"
        style="touch-action: none"
        @pointerdown.prevent="ensureAudio(); emit('croak')"
      >
        <span class="text-base leading-none font-bold">&#9835;</span>
        <span class="mt-0.5 text-[8px] font-bold tracking-wider">KROAK</span>
      </button>
      <button
        type="button"
        aria-label="Lidah"
        class="pointer-events-auto flex h-16 w-16 flex-col items-center justify-center rounded-full border-2 border-[#ff5c85] bg-[rgba(120,20,50,0.75)] text-white shadow-lg backdrop-blur-sm active:bg-[#ff5c85]/50"
        style="touch-action: none"
        @pointerdown.prevent="ensureAudio(); emit('tongue')"
      >
        <span class="text-lg leading-none font-bold">&#8776;</span>
        <span class="mt-0.5 text-[9px] font-bold tracking-wider">LIDAH</span>
      </button>
      <button
        type="button"
        aria-label="Lompat"
        class="pointer-events-auto flex h-20 w-20 flex-col items-center justify-center rounded-full border-2 border-[#57d98a] bg-[rgba(10,60,30,0.75)] text-white shadow-lg backdrop-blur-sm active:bg-[#57d98a]/50"
        style="touch-action: none"
        @pointerdown.prevent="ensureAudio(); emit('jump')"
      >
        <span class="text-xl leading-none font-bold">&#8593;</span>
        <span class="mt-0.5 text-[9px] font-bold tracking-wider">LOMPAT</span>
      </button>
    </div>
  </div>
</template>
