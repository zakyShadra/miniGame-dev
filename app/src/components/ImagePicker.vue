<script setup lang="ts">
import { computed, ref } from "vue";
import { PRESET_IMAGES, useGameStore } from "../stores/game";
import { compressImage, uploadImage, validateImageFile } from "../lib/images";

const store = useGameStore();
const fileInput = ref<HTMLInputElement | null>(null);
const status = ref("");
const error = ref("");

// Foto upload tampil di depan preset, supaya gampang dipilih lagi.
const allImages = computed(() => [
  ...store.uploadedImages,
  ...PRESET_IMAGES,
]);

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = "";
  const invalid = validateImageFile(file);
  if (invalid) {
    error.value = invalid;
    return;
  }
  try {
    status.value = "Mengompres...";
    const { blob } = await compressImage(file);
    status.value = "Mengunggah...";
    const url = await uploadImage(blob);
    const name =
      file.name.replace(/\.[^.]+$/, "").slice(0, 20) || "Foto sendiri";
    const img = { name, url };
    store.addUploadedImage(img);
    store.selectedImage = img;
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Upload gagal, coba lagi.";
  } finally {
    status.value = "";
    if (fileInput.value) fileInput.value.value = "";
  }
}
</script>

<template>
  <div>
    <h2 class="mt-6 text-sm font-semibold text-ink">Pilih gambar</h2>
    <div class="mt-2 grid grid-cols-3 gap-2">
      <button
        v-for="img in allImages"
        :key="img.url"
        type="button"
        class="overflow-hidden rounded-xl border-2 transition"
        :class="
          store.selectedImage.url === img.url
            ? 'border-primary'
            : 'border-transparent hover:border-hairline-strong'
        "
        @click="store.selectedImage = img"
      >
        <img
          :src="img.url"
          :alt="img.name"
          class="aspect-[3/2] w-full object-cover"
        />
        <span
          class="block truncate bg-surface-1 px-1 py-1 text-center text-[11px] font-medium text-body"
        >
          {{ img.name }}
        </span>
      </button>
      <button
        type="button"
        :disabled="!!status"
        class="overflow-hidden rounded-xl border-2 border-dashed border-hairline-strong transition hover:border-primary disabled:opacity-60"
        @click="fileInput?.click()"
      >
        <span
          class="flex aspect-[3/2] w-full flex-col items-center justify-center gap-1 bg-surface-2 text-muted"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          <span class="px-1 text-[11px] font-medium">
            {{ status || "Upload foto" }}
          </span>
        </span>
        <span
          class="block bg-surface-1 px-1 py-1 text-center text-[11px] font-medium text-body"
        >
          Foto sendiri
        </span>
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onFile"
    />
    <p v-if="error" class="mt-2 text-xs text-red-500">{{ error }}</p>
  </div>
</template>
