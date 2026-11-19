<!-- Minimap bundar (canvas 2D): laut gelap, pulau hijau, pemain segitiga
teal searah heading, musuh titik merah (hilang bila terhalang pulau). -->
<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { MapDef } from "../../../../../shared/naval/types";

const props = defineProps<{
  px: number;
  pz: number;
  headingDeg: number;
  dx: number;
  dz: number;
  dummyVisible: boolean;
  /** Map aktif (pulau + radius arena digambar dari sini). */
  map: MapDef;
}>();

const SIZE = 128;
const canvas = ref<HTMLCanvasElement | null>(null);

function draw(): void {
  const el = canvas.value;
  if (!el) return;
  const ctx = el.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (el.width !== SIZE * dpr) {
    el.width = SIZE * dpr;
    el.height = SIZE * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = SIZE / 2;
  const r = SIZE / 2 - 2;
  // Latar: gradasi radial laut gelap, dipotong lingkaran.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  const bg = ctx.createRadialGradient(c, c, 4, c, c, r);
  bg.addColorStop(0, "#0d4a63");
  bg.addColorStop(1, "#06283a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Skala: arena diameter muat di lingkaran (margin kecil).
  const s = r / (props.map.arenaRadius + 20);
  const toX = (x: number) => c + x * s;
  // +z = utara (sesuai kompas HUD) = atas minimap.
  const toY = (z: number) => c - z * s;
  // Lingkaran jarak (subtle).
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (const rr of [0.33, 0.66]) {
    ctx.beginPath();
    ctx.arc(c, c, r * rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Pulau: hijau.
  ctx.fillStyle = "#2e9e5b";
  for (const isl of props.map.islands) {
    ctx.beginPath();
    ctx.arc(toX(isl.x), toY(isl.z), Math.max(2, isl.radius * s), 0, Math.PI * 2);
    ctx.fill();
  }
  // Musuh: titik merah (hanya bila LoS jelas).
  if (props.dummyVisible) {
    ctx.fillStyle = "#ff5a47";
    ctx.beginPath();
    ctx.arc(toX(props.dx), toY(props.dz), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Pemain: segitiga teal searah heading.
  ctx.save();
  ctx.translate(toX(props.px), toY(props.pz));
  ctx.rotate((props.headingDeg * Math.PI) / 180);
  ctx.fillStyle = "#12b5a8";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.5, 5);
  ctx.lineTo(-4.5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();
  // Cincin emas tepi.
  ctx.strokeStyle = "#e8a33d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
}

onMounted(draw);
watch(
  () => [props.px, props.pz, props.headingDeg, props.dx, props.dz, props.dummyVisible, props.map],
  draw,
);
</script>

<template>
  <canvas
    ref="canvas"
    :width="SIZE"
    :height="SIZE"
    class="h-28 w-28 shrink-0 rounded-full shadow-lg"
    aria-label="Minimap"
  />
</template>
