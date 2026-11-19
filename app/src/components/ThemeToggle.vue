<!-- Toggle dark/light mode global (dipakai di home + semua game).
Tema disimpan di localStorage (lib/theme.ts) dan berlaku app-wide
lewat class .dark di <html>. Varian glass buat layar naval yang
background-nya kaca gelap di kedua tema. -->
<script setup lang="ts">
import { useTheme } from "../lib/theme";

defineProps<{ glass?: boolean }>();

const { darkMode, toggleDarkMode } = useTheme();
</script>

<template>
  <button
    type="button"
    data-testid="theme-toggle"
    :class="[
      'shrink-0 rounded-full p-2 transition',
      glass
        ? 'text-white/80 hover:bg-white/10 hover:text-white'
        : 'text-muted hover:bg-surface-2 hover:text-ink',
    ]"
    :aria-label="darkMode ? 'Mode terang' : 'Mode gelap'"
    @click="toggleDarkMode()"
  >
    <svg
      v-if="!darkMode"
      viewBox="0 0 24 24"
      class="h-5 w-5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
    <svg
      v-else
      viewBox="0 0 24 24"
      class="h-5 w-5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  </button>
</template>
