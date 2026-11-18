<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useRoomStore } from "../stores/room";

const room = useRoomStore();
const text = ref("");
const listRef = ref<HTMLDivElement | null>(null);

function nearBottom(): boolean {
  const el = listRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

// Auto-scroll ke pesan terbaru, tapi hanya kalau user sudah di bawah
// (jangan rebut scroll saat dia sedang baca riwayat).
watch(
  () => room.messages.length,
  async () => {
    if (!nearBottom()) return;
    await nextTick();
    const el = listRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

function send() {
  if (!text.value.trim()) return;
  room.sendChat(text.value);
  text.value = "";
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div ref="listRef" class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      <p
        v-if="room.messages.length === 0"
        class="py-6 text-center text-xs text-subtle"
      >
        Belum ada chat. Sapa pasangan mainmu!
      </p>
      <div v-for="(m, i) in room.messages" :key="i">
        <p
          v-if="m.kind === 'system'"
          class="py-0.5 text-center text-[11px] text-subtle"
        >
          {{ m.text }}
        </p>
        <div
          v-else
          class="flex"
          :class="m.playerId === room.myId ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[85%] rounded-xl px-3 py-1.5"
            :class="m.playerId === room.myId ? 'bg-surface-3' : 'bg-surface-2'"
          >
            <p
              v-if="m.playerId !== room.myId"
              class="flex items-center gap-1 text-[11px] font-semibold text-body"
            >
              <span
                class="inline-block h-2 w-2 rounded-full"
                :style="{ background: m.color }"
              />
              {{ m.name }}
            </p>
            <p class="text-sm break-words text-body">{{ m.text }}</p>
            <p class="text-right text-[10px] text-subtle">{{ timeOf(m.at) }}</p>
          </div>
        </div>
      </div>
    </div>
    <form class="flex gap-2 border-t border-hairline p-2" @submit.prevent="send">
      <input
        v-model="text"
        type="text"
        maxlength="500"
        placeholder="Tulis chat..."
        aria-label="Tulis chat"
        class="min-w-0 flex-1 rounded-xl border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary"
      />
      <button
        type="submit"
        :disabled="!text.trim()"
        class="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-40"
      >
        Kirim
      </button>
    </form>
  </div>
</template>
