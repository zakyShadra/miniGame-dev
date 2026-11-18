<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useGameStore } from "../stores/game";
import { useRoomStore } from "../stores/room";
import type { PieceSpec } from "../../../shared/game/cutter";
import {
  computeLayout,
  groupMembers,
  LOGICAL_BOARD_H,
  LOGICAL_BOARD_W,
  type BoardLayout,
} from "../../../shared/game/engine";
import {
  drawBoardBackground,
  drawCursor,
  drawPiece,
  drawTargetArea,
  piecePathAt,
} from "../game/renderer";
import { ensureAudio, muted, setMuted } from "../lib/sound";

const store = useGameStore();
const room = useRoomStore();
const inRoom = computed(() => room.status === "connected");

const wrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerSize = ref({ w: 800, h: 600 });
const imgRef = ref<HTMLImageElement | null>(null);
const imgError = ref(false);
const showGhost = ref(true);
const showFullImage = ref(false);
// Urutan gambar piece (z-order): id terakhir digambar paling atas.
const zOrder = ref<number[]>([]);

const camera = ref({ zoom: 1, x: 0, y: 0 });
const drag = ref<{
  id: number;
  dx: number;
  dy: number;
} | null>(null);
// Posisi piece sebelum drag (multiplayer): dipakai mengembalikan piece
// kalau server menolak grab.
const dragStartPos = ref<{ x: number; y: number } | null>(null);
const pan = ref<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

const specById = computed(() => {
  const map = new Map<number, PieceSpec>();
  for (const s of store.cut?.pieces ?? []) map.set(s.id, s);
  return map;
});

// Layout board logis (tetap 1280x800 di semua layar): area target di
// tengah, sisanya area scatter. Sama persis dengan yang dipakai server.
const layout = computed<BoardLayout | null>(() => {
  if (store.imageW === 0 || store.imageH === 0) return null;
  return computeLayout(
    store.imageW,
    store.imageH,
    LOGICAL_BOARD_W,
    LOGICAL_BOARD_H,
  );
});

// Transform fit: board logis dipusatkan di container, dijaga rasionya.
const fit = computed(() => {
  const { w, h } = containerSize.value;
  const scale = Math.min(w / LOGICAL_BOARD_W, h / LOGICAL_BOARD_H);
  return {
    scale,
    x: (w - LOGICAL_BOARD_W * scale) / 2,
    y: (h - LOGICAL_BOARD_H * scale) / 2,
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
  const f = fit.value;
  const { zoom, x: camX, y: camY } = camera.value;
  const total = f.scale * zoom;
  ctx.setTransform(
    dpr * total,
    0,
    0,
    dpr * total,
    dpr * (f.x + camX),
    dpr * (f.y + camY),
  );
  // Bingkai tipis di tepi board logis.
  ctx.strokeStyle = "rgba(10, 10, 10, 0.12)";
  ctx.lineWidth = 1 / total;
  ctx.strokeRect(0, 0, LOGICAL_BOARD_W, LOGICAL_BOARD_H);
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
      // Piece yang dipegang pemain lain: garis tepi warna pemain itu.
      const locker =
        piece.lockedBy && piece.lockedBy !== room.myId
          ? room.players.find((p) => p.id === piece.lockedBy)
          : undefined;
      drawPiece(ctx, img, store.imageW, store.imageH, spec, piece.x, piece.y, l.scale, {
        highlight: id === store.selectedId,
        placed: piece.placed,
        lockColor: locker?.color,
      });
    }
  }
  // Cursor pemain lain (nama + warna).
  if (inRoom.value) {
    for (const p of room.players) {
      if (p.id === room.myId || !p.cursor) continue;
      drawCursor(ctx, p.cursor.x, p.cursor.y, p.name, p.color);
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

// Konversi posisi pointer (client) ke koordinat board logis.
function toBoard(e: PointerEvent): { x: number; y: number } {
  const rect = canvasRef.value!.getBoundingClientRect();
  const f = fit.value;
  const { zoom, x: camX, y: camY } = camera.value;
  const total = f.scale * zoom;
  return {
    x: (e.clientX - rect.left - (f.x + camX)) / total,
    y: (e.clientY - rect.top - (f.y + camY)) / total,
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
  // Interaksi pertama user: buka kunci audio supaya bunyi snap boleh jalan.
  ensureAudio();
  canvas.setPointerCapture(e.pointerId);
  const { x: bx, y: by } = toBoard(e);
  const id = hitTest(bx, by);
  if (id !== null) {
    const piece = store.pieces.find((p) => p.id === id);
    if (!piece || piece.placed) return;
    // Anggota grup piece ini (dirinya saja kalau tidak punya grup).
    const members = groupMembers(piece, store.pieces);
    if (inRoom.value) {
      // Piece/grup yang dipegang pemain lain tidak bisa direbut.
      if (members.some((m) => m.lockedBy && m.lockedBy !== room.myId)) {
        return;
      }
      dragStartPos.value = { x: piece.x, y: piece.y };
      // Grab optimistis: langsung drag, server mengonfirmasi atau
      // menolak (lihat watcher grabDenied). Server mengunci seluruh grup.
      room.sendGrab(id);
    }
    drag.value = { id, dx: bx - piece.x, dy: by - piece.y };
    store.selectPiece(id);
    // Naikkan seluruh grup ke atas (urutan relatif dipertahankan).
    const memberIds = new Set(members.map((m) => m.id));
    zOrder.value = [
      ...zOrder.value.filter((z) => !memberIds.has(z)),
      ...zOrder.value.filter((z) => memberIds.has(z)),
    ];
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
  if (inRoom.value) room.sendCursor(bx, by);
  if (drag.value) {
    const l = layout.value;
    const spec = specById.value.get(drag.value.id);
    if (!l || !spec) return;
    const pw = spec.w * l.scale;
    const ph = spec.h * l.scale;
    const nx = Math.min(l.boardW - pw * 0.5, Math.max(-pw * 0.5, bx - drag.value.dx));
    const ny = Math.min(l.boardH - ph * 0.5, Math.max(-ph * 0.5, by - drag.value.dy));
    store.movePiece(drag.value.id, nx, ny);
    if (inRoom.value) room.sendMove(drag.value.id, nx, ny);
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
  // Hover: kursor grab di atas piece, dilarang kalau piece/grupnya
  // dipegang pemain lain.
  const id = hitTest(bx, by);
  if (id === null) {
    canvas.style.cursor = "default";
  } else {
    const piece = store.pieces.find((p) => p.id === id);
    const heldByOther = piece
      ? groupMembers(piece, store.pieces).some(
          (m) => m.lockedBy && m.lockedBy !== room.myId,
        )
      : false;
    canvas.style.cursor = heldByOther ? "not-allowed" : "grab";
  }
}

function onPointerUp(e: PointerEvent) {
  const canvas = canvasRef.value;
  if (drag.value) {
    if (inRoom.value) {
      // Multiplayer: server yang menentukan snap (authoritative).
      const piece = store.pieces.find((p) => p.id === drag.value!.id);
      if (piece) room.sendDrop(drag.value.id, piece.x, piece.y);
    } else {
      store.dropPiece(drag.value.id);
    }
    drag.value = null;
    dragStartPos.value = null;
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
  const f = fit.value;
  const { zoom, x: camX, y: camY } = camera.value;
  const next = Math.min(3, Math.max(0.5, zoom * factor));
  const k = next / zoom;
  // Zoom di sekitar titik layar: offset total bergeser, pan dikoreksi.
  const offX = f.x + camX;
  const offY = f.y + camY;
  camera.value = {
    zoom: next,
    x: px - (px - offX) * k - f.x,
    y: py - (py - offY) * k - f.y,
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

// Rapikan: acak ulang posisi piece yang belum terpasang. Di room,
// server yang melakukannya (state disiarkan ke semua pemain).
function onSort() {
  if (inRoom.value) room.sendSort();
  else store.sortPieces();
  draw();
}

function toggleMute() {
  if (muted.value) ensureAudio();
  setMuted(!muted.value);
}

// Tutup lightbox gambar dengan tombol Escape.
function onEscape(e: KeyboardEvent) {
  if (e.key === "Escape") showFullImage.value = false;
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
  (l) => {
    // Layout logis tetap per gambar, jadi watcher ini hanya scatter
    // sekali saat game dimulai; resize tidak mengubah posisi piece.
    // immediate: layout sudah final saat mount (tidak bergantung pada
    // ukuran container lagi), jadi tanpa ini applyLayout tidak pernah
    // jalan dan semua piece menumpuk di (0, 0).
    if (!l) return;
    store.applyLayout(l);
    draw();
  },
  { immediate: true },
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

watch(
  () => room.players,
  () => draw(),
  { deep: true },
);

watch(
  () => room.grabDenied,
  (denied) => {
    if (!denied || !drag.value || denied.pieceId !== drag.value.id) return;
    // Server menolak grab (piece direbut pemain lain): kembalikan
    // piece ke posisi sebelum drag dan batalkan drag.
    if (dragStartPos.value) {
      store.movePiece(
        denied.pieceId,
        dragStartPos.value.x,
        dragStartPos.value.y,
      );
    }
    drag.value = null;
    dragStartPos.value = null;
    store.selectPiece(null);
    draw();
  },
);

let observer: ResizeObserver | null = null;

onMounted(() => {
  resizeCanvas();
  window.addEventListener("keydown", onEscape);
  // QA saja (dev): buka store ke window supaya Playwright bisa membaca
  // state piece (groupId, posisi) untuk asersi. Tidak ada di production.
  if (import.meta.env.DEV) {
    (window as unknown as { __puzzleGame?: unknown }).__puzzleGame = {
      game: store,
      room,
    };
  }
  if (wrapRef.value) {
    observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(wrapRef.value);
  }
});

onUnmounted(() => {
  observer?.disconnect();
  window.removeEventListener("keydown", onEscape);
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
      class="absolute top-3 right-3 flex flex-col items-center gap-1 rounded-full bg-surface-1 p-1 shadow-md sm:top-auto sm:right-3 sm:bottom-3 sm:flex-row"
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
      <span class="my-1 h-px w-5 bg-hairline sm:mx-1 sm:my-0 sm:h-5 sm:w-px" />
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
        <span class="hidden sm:inline">Preview</span>
      </button>
      <span class="my-1 h-px w-5 bg-hairline sm:mx-1 sm:my-0 sm:h-5 sm:w-px" />
      <button
        type="button"
        class="flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold text-ink hover:bg-surface-3"
        title="Rapikan piece yang belum terpasang"
        aria-label="Rapikan piece"
        @click="onSort"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22" /><path d="m18 2 4 4-4 4" /><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" /><path d="m18 14 4 4-4 4" /></svg>
        <span class="hidden sm:inline">Rapikan</span>
      </button>
      <button
        type="button"
        class="flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold text-ink hover:bg-surface-3"
        title="Lihat gambar asli"
        aria-label="Lihat gambar asli"
        @click="showFullImage = true"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
        <span class="hidden sm:inline">Gambar</span>
      </button>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-surface-3"
        :aria-label="muted ? 'Nyalakan suara' : 'Matikan suara'"
        :title="muted ? 'Nyalakan suara' : 'Matikan suara'"
        @click="toggleMute"
      >
        <svg v-if="muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z" /><line x1="22" x2="16" y1="9" y2="15" /><line x1="16" x2="22" y1="9" y2="15" /></svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
      </button>
    </div>
    <div
      v-if="showFullImage"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      @click="showFullImage = false"
    >
      <figure class="max-w-3xl" @click.stop>
        <img
          :src="store.imageUrl"
          :alt="store.imageName"
          class="max-h-[80vh] w-auto max-w-full rounded-2xl shadow-lg"
        />
        <figcaption
          class="mt-3 flex items-center justify-between gap-4 text-sm text-white"
        >
          <span>{{ store.imageName }}</span>
          <button
            type="button"
            class="rounded-full bg-surface-1 px-4 py-1.5 font-semibold text-ink hover:bg-surface-2"
            @click="showFullImage = false"
          >
            Tutup
          </button>
        </figcaption>
      </figure>
    </div>
  </div>
</template>
