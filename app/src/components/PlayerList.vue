<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoomStore } from "../stores/room";
import type { PlayerState } from "../../../shared/types";

const room = useRoomStore();

// Jam tampilan, di-refresh tiap 5 detik supaya label AFK muncul
// tanpa menunggu pesan baru dari server.
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 5000);
});

onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});

// AFK = cursor pemain lain diam lebih dari 30 detik. Diri sendiri
// tidak pernah ditandai AFK.
function isAfk(p: PlayerState): boolean {
  if (p.id === room.myId) return false;
  const last = room.lastCursorAt[p.id] ?? now.value;
  return now.value - last > 30000;
}
</script>

<template>
  <div
    v-if="room.status === 'connected'"
    class="flex flex-wrap items-center gap-1.5"
  >
    <span
      v-for="p in room.players"
      :key="p.id"
      class="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-body"
      :class="{ 'opacity-60': isAfk(p) }"
    >
      <span class="h-2.5 w-2.5 rounded-full" :style="{ background: p.color }" />
      {{ p.name }}
      <span v-if="p.id === room.myId" class="text-subtle">(kamu)</span>
      <span v-else-if="isAfk(p)" class="text-subtle">AFK</span>
    </span>
  </div>
</template>
