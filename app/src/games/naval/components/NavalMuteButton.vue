<!-- Tombol mute suara (satu preferensi untuk semua game, disimpan di
localStorage lewat lib/sound). Klik juga me-resume AudioContext
supaya suara langsung jalan setelah unmute. -->
<script setup lang="ts">
import { ensureAudio, muted, setMuted } from "../../../lib/sound";

function toggle(): void {
  ensureAudio();
  setMuted(!muted.value);
}
</script>

<template>
  <button
    type="button"
    aria-label="Suara nyala/mati"
    title="Suara nyala/mati"
    class="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[rgba(4,24,32,0.75)] text-white backdrop-blur-md transition hover:bg-[rgba(4,24,32,0.9)]"
    @click="toggle"
  >
    <svg
      v-if="!muted"
      class="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
    <svg
      v-else
      class="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  </button>
</template>
