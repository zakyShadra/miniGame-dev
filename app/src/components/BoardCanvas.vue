<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useGameStore } from "../stores/game";
import type { PieceSpec } from "../game/cutter";
import { solvedPosition, type BoardLayout } from "../game/engine";
import {
  drawBoardBackground,
  drawPiece,
  drawTargetArea,
  piecePathAt,
} from "../game/renderer";

const store = useGameStore();

const wrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerSize = ref({ w: 800, h: 600 });
const imgRef = ref<HTMLImageElement | null>(null);
const imgError = ref(false);
const showGhost = ref(true);
// Urutan gambar piece (z-order): id terakhir digambar paling atas.
const zOrder = ref<number[]>([]);

const camera = ref({ zoom: 1, x: 0, y: 0 });
const drag = ref<{
  id: number;
  dx: number;
  dy: number;
} | null>(null);
const pan = ref<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

const specById = computed(() => {
  const map = new Map<number, PieceSpec>();
  for (const s of store.cut?.pieces ?? []) map.set(s.id, s);
  return map;
});

// Layout board: area target di tengah (60% lebar / 80% tinggi), sisanya
// area scatter. Dihitung dari ukuran container dan rasio gambar.
const layout = computed<BoardLayout | null>(() => {
  if (store.imageW === 0 || store.imageH === 0) return null;
  const { w, h } = containerSize.value;
  const aspect = store.imageW / store.imageH;
  let targetW = w * 0.6;
  let targetH = targetW / aspect;
  if (targetH > h * 0.8) {
    targetH = h * 0.8;
    targetW = targetH * aspect;
  }
  const scale = targetW / store.imageW;
  return {
    scale,
    targetX: (w - targetW) / 2,
    targetY: (h - targetH) / 2,
    boardW: w,
    boardH: h,
  };
});

const targetRect = computed(() => {
  const l = layout.value;
  if (!l || !store.cut) return null;
  return {
    x: l.targetX,
    y: l.targetY,
    w: store.cut.cols * store.cut.pieceW * l.scale,
    h: store.cut.rows * store.cut.pieceH * l.scale,
  };
});

function draw() {
  const canvas = canvasRef.value;
  const ctx = canvas?.getContext("2d");
  const l = layout.value;
  if (!canvas || !ctx || !l) return;
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = containerSize.value;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBoardBackground(ctx, w, h);
  const { zoom, x: camX, y: camY } = camera.value;
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * camX, dpr * camY);
  const img = imgRef.value;
  const t = targetRect.value;
  if (img && t) {
    drawTargetArea(ctx, img, t.x, t.y, t.w, t.h, showGhost.value);
  }
  if (img) {
    for (const id of zOrder.value) {
      const piece = store.pieces.find((p) => p.id === id);
      const spec = specById.value.get(id);
      if (!piece || !spec) continue;
      drawPiece(ctx, img, store.imageW, store.imageH, spec, piece.x, piece.y, l.scale, {
        highlight: id === store.selectedId,
        placed: piece.placed,
      });
    }
  }
}

function resizeCanvas() {
  const canvas = canvasRef.value;
  const wrap = wrapRef.value;
  if (!canvas || !wrap) return;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  containerSize.value = { w: rect.width, h: rect.height };
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  draw();
}

// Konversi posisi pointer (client) ke koordinat board.
function toBoard(e: PointerEvent): { x: number; y: number } {
  const rect = canvasRef.value!.getBoundingClientRect();
  const { zoom, x: camX, y: camY } = camera.value;
  return {
    x: (e.clientX - rect.left - camX) / zoom,
    y: (e.clientY - rect.top - camY) / zoom,
  };
}

function hitTest(bx: number, by: number): number | null {
  const ctx = canvasRef.value?.getContext("2d");
  const l = layout.value;
  if (!ctx || !l) return null;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let found: number | null = null;
  for (let i = zOrder.value.length - 1; i >= 0; i--) {
    const id = zOrder.value[i]!;
    const piece = store.pieces.find((p) => p.id === id);
    const spec = specById.value.get(id);
    if (!piece || !spec) continue;
    if (ctx.isPointInPath(piecePathAt(spec, l.scale, piece.x, piece.y), bx, by)) {
      found = id;
      break;
    }
  }
  ctx.restore();
  return found;
}

function onPointerDown(e: PointerEvent) {
  const canvas = canvasRef.value;
  if (!canvas || store.status !== "playing") return;
  canvas.setPointerCapture(e.pointerId);
  const { x: bx, y: by } = toBoard(e);
  const id = hitTest(bx, by);
  if (id !== null) {
    const piece = store.pieces.find((p) => p.id === id);
    if (!piece || piece.placed) return;
    drag.value = { id, dx: bx - piece.x, dy: by - piece.y };
    store.selectPiece(id);
    // Naikkan ke atas: pindahkan id ke ujung z-order.
    zOrder.value = [...zOrder.value.filter((z) => z !== id), id];
    canvas.style.cursor = "grabbing";
  } else {
    pan.value = {
      startX: e.clientX,
      startY: e.clientY,
      camX: camera.value.x,
      camY: camera.value.y,
    };
    canvas.style.cursor = "grabbing";
  }
  draw();
}

function onPointerMove(e: PointerEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const { x: bx, y: by } = toBoard(e);
  if (drag.value) {
    const l = layout.value;
    const spec = specById.value.get(drag.value.id);
    if (!l || !spec) return;
    const pw = spec.w * l.scale;
    const ph = spec.h * l.scale;
    const nx = Math.min(l.boardW - pw * 0.5, Math.max(-pw * 0.5, bx - drag.value.dx));
    const ny = Math.min(l.boardH - ph * 0.5, Math.max(-ph * 0.5, by - drag.value.dy));
    store.movePiece(drag.value.id, nx, ny);
    draw();
    return;
  }
  if (pan.value) {
    camera.value = {
      ...camera.value,
      x: pan.value.camX + (e.clientX - pan.value.startX),
      y: pan.value.camY + (e.clientY - pan.value.startY),
    };
    draw();
    return;
  }
  // Hover: kursor grab di atas piece.
  const id = hitTest(bx, by);
  canvas.style.cursor = id !== null ? "grab" : "default";
}

function onPointerUp(e: PointerEvent) {
  const canvas = canvasRef.value;
  if (drag.value) {
    store.dropPiece(drag.value.id);
    drag.value = null;
    store.selectPiece(null);
  }
  pan.value = null;
  if (canvas) {
    canvas.style.cursor = "default";
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  draw();
}

function zoomBy(factor: number, cx?: number, cy?: number) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = cx ?? rect.width / 2;
  const py = cy ?? rect.height / 2;
  const { zoom, x: camX, y: camY } = camera.value;
  const next = Math.min(3, Math.max(0.5, zoom * factor));
  const k = next / zoom;
  camera.value = {
    zoom: next,
    x: px - (px - camX) * k,
    y: py - (py - camY) * k,
  };
  draw();
}

function onWheel(e: WheelEvent) {
  const rect = canvasRef.value!.getBoundingClientRect();
  zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
}

function resetView() {
  camera.value = { zoom: 1, x: 0, y: 0 };
  draw();
}

function loadImage(url: string) {
  imgError.value = false;
  imgRef.value = null;
  const img = new Image();
  img.onload = () => {
    imgRef.value = img;
    draw();
  };
  img.onerror = () => {
    imgError.value = true;
  };
  img.src = url;
}

watch(
  () => store.imageUrl,
  (url) => {
    if (url) loadImage(url);
  },
  { immediate: true },
);

watch(
  () => store.pieces.length,
  () => {
    // Game baru: reset z-order mengikuti urutan piece.
    // immediate: BoardCanvas mount SETELAH piece dibuat (status baru
    // jadi 'playing' di akhir newGame), jadi tanpa ini z-order tetap
    // kosong dan tidak ada piece yang digambar.
    zOrder.value = store.pieces.map((p) => p.id);
    draw();
  },
  { immediate: true },
);

watch(
  layout,
  (l, prev) => {
    if (!l) return;
    store.applyLayout(l);
    // Kalau layout berubah setelah scatter (resize), piece yang sudah
    // terpasang ikut pindah ke posisi benar yang baru; sisanya dijepit.
    if (prev && store.scattered && store.cut) {
      for (const piece of store.pieces) {
        const spec = specById.value.get(piece.id);
        if (!spec) continue;
        if (piece.placed) {
          const t = solvedPosition(spec, l);
          piece.x = t.x;
          piece.y = t.y;
        } else {
          const pw = spec.w * l.scale;
          const ph = spec.h * l.scale;
          piece.x = Math.min(l.boardW - pw * 0.5, Math.max(-pw * 0.5, piece.x));
          piece.y = Math.min(l.boardH - ph * 0.5, Math.max(-ph * 0.5, piece.y));
        }
      }
    }
    draw();
  },
);

watch(
  () => store.pieces,
  () => draw(),
  { deep: true },
);

watch(
  () => store.selectedId,
  () => draw(),
);

let observer: ResizeObserver | null = null;

onMounted(() => {
  resizeCanvas();
  if (wrapRef.value) {
    observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(wrapRef.value);
  }
});

onUnmounted(() => {
  observer?.disconnect();
});
</script>

<template>
  <div ref="wrapRef" class="relative h-full w-full overflow-hidden">
    <canvas
      ref="canvasRef"
      class="block h-full w-full touch-none"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.prevent="onWheel"
      @contextmenu.prevent
    />
    <div
      v-if="imgError"
      class="absolute inset-0 flex items-center justify-center bg-board-felt"
    >
      <p class="rounded-lg bg-surface-1 px-4 py-3 text-sm text-ink shadow-md">
        Gambar tidak bisa dimuat. Coba gambar lain.
      </p>
    </div>
    <div
      class="absolute right-3 bottom-3 flex items-center gap-1 rounded-full bg-surface-1 p-1 shadow-md"
    >
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-surface-3"
        aria-label="Zoom out"
        @click="zoomBy(1 / 1.25)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14" /></svg>
      </button>
      <span class="w-12 text-center text-xs font-semibold text-muted tabular-nums">
        {{ Math.round(camera.zoom * 100) }}%
      </span>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-surface-3"
        aria-label="Zoom in"
        @click="zoomBy(1.25)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <span class="mx-1 h-5 w-px bg-hairline" />
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-surface-3"
        aria-label="Reset view"
        title="Reset tampilan"
        @click="resetView"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
      </button>
      <button
        type="button"
        class="flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold"
        :class="showGhost ? 'bg-primary text-white' : 'text-ink hover:bg-surface-3'"
        :aria-pressed="showGhost"
        title="Preview gambar"
        @click="showGhost = !showGhost; draw()"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
        Preview
      </button>
    </div>
  </div>
</template>
