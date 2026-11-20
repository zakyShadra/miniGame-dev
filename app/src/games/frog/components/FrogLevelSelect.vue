<!-- Kartu pilih level katak (F3): dipakai setup solo + form co-op.
Level terbuka berurutan; yang terkunci tidak bisa dipilih. -->
<script setup lang="ts">
import { LEVEL_PACK } from "../../../../../shared/frog/levels";

defineProps<{
  selected: string;
  unlocked: number;
  completed: string[];
}>();
defineEmits<{ select: [id: string] }>();
</script>

<template>
  <div class="grid grid-cols-2 gap-2">
    <button
      v-for="(m, i) in LEVEL_PACK"
      :key="m.id"
      type="button"
      :disabled="i >= unlocked"
      class="rounded-xl border-2 p-3 text-left transition"
      :class="[
        selected === m.id
          ? 'border-primary bg-surface-2'
          : 'border-hairline bg-surface-1 hover:border-primary',
        i >= unlocked ? 'cursor-not-allowed opacity-60' : '',
      ]"
      @click="$emit('select', m.id)"
    >
      <span class="flex items-center gap-2">
        <span class="font-display text-sm font-bold text-ink">{{ i + 1 }}. {{ m.name }}</span>
        <span v-if="completed.includes(m.id)" class="ml-auto shrink-0 text-xs font-bold text-success">
          Selesai ✓
        </span>
        <svg
          v-else-if="i >= unlocked"
          class="ml-auto h-4 w-4 shrink-0 text-muted"
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
      </span>
      <span class="mt-1 block text-xs text-muted">{{ m.desc }}</span>
      <span class="mt-1 block text-xs font-semibold text-body">{{ m.puzzles }} puzzle</span>
    </button>
  </div>
</template>
