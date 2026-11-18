<script setup lang="ts">
import { useRoomStore } from "../stores/room";

const room = useRoomStore();
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
    >
      <span class="h-2.5 w-2.5 rounded-full" :style="{ background: p.color }" />
      {{ p.name }}
      <span v-if="p.id === room.myId" class="text-subtle">(kamu)</span>
    </span>
  </div>
</template>
