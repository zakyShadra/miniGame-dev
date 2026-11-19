<!-- Modal hasil game ala chess.com (round 2, tugas 5): kartu charcoal
di tengah papan, TANPA dimming (papan tetap terang, pointer-events
hanya di kartu). Shell yang sama untuk menang/kalah/remis, konten
beda. Stats klasifikasi muncul setelah analisa selesai; dua tombol
mode (Cepat + Thinking) supaya user bisa pilih dari modal, dan
muncul lagi setelah selesai untuk analisa ulang mode lain. Tanpa
confetti, tanpa pulse/glow (chess.com memang tidak punya itu).
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { Color } from "chess.js";
import { useChessStore } from "../stores/chess";
import type { AnalysisMode } from "../lib/analysis";

const store = useChessStore();

const rematching = ref(false);

// Judul ikut mode: mode bot bicara soal "kamu", mode lokal menyebut
// warna pemenang, mode online menyebut kamu/lawan.
const title = computed(() => {
  const end = store.gameEnd;
  if (!end) return "";
  if (end.winner === null) return "Remis";
  if (store.mode === "bot") {
    return end.winner === store.humanColor ? "Kamu Menang!" : "Bot Menang";
  }
  if (store.mode === "online") {
    return end.winner === store.onlineColor
      ? "Kamu Menang!"
      : `${store.opponentName || "Lawan"} Menang`;
  }
  return end.winner === "w" ? "Putih Menang!" : "Hitam Menang!";
});

const subtitle = computed(() => {
  switch (store.gameEnd?.kind) {
    case "checkmate":
      return "Skakmat";
    case "resign":
      return "Menyerah";
    case "stalemate":
      return "Stalemate";
    case "repetition":
      return "Pengulangan 3x";
    case "insufficient":
      return "Materi tidak cukup";
    case "fifty":
      return "Aturan 50 langkah";
    default:
      return "Remis";
  }
});

// Trofi emas kalau ada pemenang yang "dirayakan": mode bot hanya
// kalau manusia yang menang, mode lokal selalu (tidak ada "kamu").
// Kalah di mode bot = trofi abu-abu, remis = simbol 1/2.
const trophyState = computed<"gold" | "gray" | "half">(() => {
  const end = store.gameEnd;
  if (!end || end.winner === null) return "half";
  if (store.mode === "bot" && end.winner !== store.humanColor)
    return "gray";
  if (store.mode === "online" && end.winner !== store.onlineColor)
    return "gray";
  return "gold";
});

// Stats klasifikasi milik siapa: mode bot = manusia, mode lokal =
// pemenang (remis = Putih), mode online = warna sendiri.
const statsColor = computed<Color>(() => {
  if (store.mode === "bot") return store.humanColor;
  if (store.mode === "online") return store.onlineColor ?? "w";
  return store.gameEnd?.winner ?? "w";
});
const stats = computed(() => {
  const a = store.analysis;
  if (!a) return null;
  const c = a.counts[statsColor.value];
  return {
    best: c.best + c.brilliant,
    excellent: c.excellent,
    miss: c.mistake + c.blunder,
  };
});

const analysisBusy = computed(
  () =>
    store.analysisStatus === "running" ||
    store.analysisStatus === "loading",
);

// Label tombol rematch di mode online: permintaan pertama menunggu
// lawan, permintaan lawan bisa diterima. Di luar online selalu
// "Main Lagi".
const rematchLabel = computed(() => {
  if (store.mode !== "online") return rematching.value ? "Memulai..." : "Main Lagi";
  const pending = store.rematchPendingBy;
  if (pending === null) return "Rematch";
  if (pending === store.onlineColor) return "Menunggu lawan...";
  return "Terima rematch";
});
const rematchDisabled = computed(
  () =>
    rematching.value ||
    (store.mode === "online" &&
      store.rematchPendingBy === store.onlineColor),
);

async function rematch() {
  if (rematchDisabled.value) return;
  // Online: rematch = permintaan ke server, game baru dimulai saat
  // lawan menerima (warna ditukar). Modal tetap terbuka sampai
  // game baru jalan (applyOnlineState menutupnya).
  if (store.mode === "online") {
    store.requestRematch();
    return;
  }
  rematching.value = true;
  try {
    if (store.mode === "bot") {
      // Warna sama seperti game barusan (bukan random ulang).
      await store.newBotGame(store.botLevel, store.humanColor);
    } else {
      store.newLocalGame();
    }
  } catch {
    // Engine gagal load (seharusnya tidak terjadi: engine sudah
    // siap dari game barusan). Modal tetap terbuka.
  } finally {
    rematching.value = false;
  }
}

function analyze(mode: AnalysisMode) {
  // Mode dipilih user (bukan hardwired Cepat): modal tetap terbuka,
  // stats mengisi sendiri begitu analisa selesai.
  void store.startAnalysis(mode);
}
</script>

<template>
  <div
    v-if="store.endModalVisible && store.gameEnd"
    data-testid="game-end-modal"
    class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
  >
    <div
      class="modal-pop pointer-events-auto relative w-[86%] max-w-[300px] rounded-2xl bg-[#262421] p-5 text-center text-white shadow-2xl"
    >
      <button
        type="button"
        data-testid="game-end-close"
        aria-label="Tutup hasil game"
        class="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-zinc-400 transition hover:bg-white/10 hover:text-white"
        @click="store.dismissEndModal()"
      >
        &times;
      </button>

      <!-- Trofi / simbol remis -->
      <div class="mb-1 flex justify-center">
        <svg
          v-if="trophyState !== 'half'"
          viewBox="0 0 24 24"
          class="h-10 w-10"
          :class="trophyState === 'gold' ? 'text-amber-400' : 'text-zinc-500'"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M5 3h14v2h3v3a5 5 0 0 1-5 5h-.42A6 6 0 0 1 13 16.92V18h3v2H8v-2h3v-1.08A6 6 0 0 1 7.42 13H7a5 5 0 0 1-5-5V5h3V3zm0 4H3v1a3 3 0 0 0 3 3V7zm14 0v4a3 3 0 0 0 3-3V7h-3zM12 15a4 4 0 0 0 4-4V5H8v6a4 4 0 0 0 4 4z"
          />
        </svg>
        <span
          v-else
          class="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-600 text-lg font-black"
          aria-hidden="true"
          >½</span
        >
      </div>

      <h2
        data-testid="game-end-title"
        class="font-display text-xl font-bold"
      >
        {{ title }}
      </h2>
      <p
        data-testid="game-end-subtitle"
        class="mt-0.5 text-sm text-zinc-400"
      >
        {{ subtitle }}
      </p>

      <!-- Stats klasifikasi (setelah analisa selesai) -->
      <div
        v-if="stats"
        data-testid="game-end-stats"
        class="mt-3 flex justify-center gap-1.5"
      >
        <span
          class="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
        >
          <span class="text-green-400">★</span> {{ stats.best }} Best
        </span>
        <span
          class="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
        >
          <span class="text-teal-400">●</span> {{ stats.excellent }} Excellent
        </span>
        <span
          class="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
        >
          <span class="text-red-400">✕</span> {{ stats.miss }} Miss
        </span>
      </div>
      <p
        v-else-if="analysisBusy"
        class="mt-3 text-xs text-zinc-400"
      >
        Menganalisa... {{ store.analysisProgress.done }}/{{
          store.analysisProgress.total
        }}
      </p>
      <p v-else class="mt-3 text-xs text-zinc-400">
        Analisa untuk melihat stats langkahmu.
      </p>

      <div class="mt-4 flex flex-col gap-2">
        <button
          type="button"
          data-testid="game-end-rematch"
          :disabled="rematchDisabled"
          class="rounded-full bg-primary py-2.5 text-sm font-bold text-white transition hover:bg-primary-hover disabled:opacity-50"
          @click="rematch()"
        >
          {{ rematchLabel }}
        </button>
        <!-- Pilih mode dari modal (idle maupun selesai = analisa
        ulang). Saat analisa jalan, tombol diganti indikator. -->
        <template v-if="!analysisBusy">
          <button
            type="button"
            data-testid="game-end-analyze"
            class="rounded-full bg-white/10 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
            @click="analyze('fast')"
          >
            Analisa Cepat
          </button>
          <button
            type="button"
            data-testid="game-end-analyze-thinking"
            class="rounded-full bg-white/10 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
            @click="analyze('thinking')"
          >
            Thinking
          </button>
        </template>
        <button
          v-else
          type="button"
          disabled
          class="rounded-full bg-white/10 py-2.5 text-sm font-semibold text-white opacity-50"
        >
          Menganalisa...
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Modal muncul membesar dari kecil (chess.com tidak tertangkap
frame-by-frame, jadi pakai pop halus standar). */
@keyframes modal-pop {
  0% {
    transform: scale(0.85);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
.modal-pop {
  animation: modal-pop 0.2s ease-out;
}
</style>
