// Store katak (Pinia): fase game + HUD reaktif. Instance FrogGame
// disimpan NON-reaktif (seperti NavalGame di store naval); HUD di-sync
// lewat callback ~10 Hz dari game loop. F3: pilih level + progresi
// (level terbuka berurutan, tersimpan di localStorage).

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { getLevel, getLevelMeta, LEVEL_PACK } from "../../../../../shared/frog/levels";
import { markCompleted, readCompleted, readUnlocked } from "../lib/progress";
import { FrogGame, type FrogHud } from "../lib/game";

export type FrogPhase = "setup" | "playing" | "won";
export type FrogColorChoice = "orange" | "green";

function freshHud(): FrogHud {
  return {
    fliesGot: 0,
    fliesTotal: 5,
    orbsGot: 0,
    orbsTotal: 0,
    coinsGot: 0,
    coinsTotal: 0,
    tongueMode: "idle",
    time: 0,
    fps: 0,
    calls: 0,
    triangles: 0,
  };
}

export const useFrogStore = defineStore("frog", () => {
  const phase = ref<FrogPhase>("setup");
  // F1 solo: hanya oranye. Hijau dibuka di F2 (co-op).
  const selectedColor = ref<FrogColorChoice>("orange");
  /** Id pack level yang dipilih di setup (F3). */
  const selectedLevel = ref("bengkel");
  /** Jumlah level yang terbuka (progresi, localStorage). */
  const unlocked = ref(readUnlocked());
  /** Id pack level yang sudah selesai. */
  const completed = ref<string[]>(readCompleted());
  const hud = ref<FrogHud>(freshHud());
  const winTime = ref(0);
  const winFlies = ref(0);
  const winFliesTotal = ref(5);
  /** Posisi bubble kroak di layar (null bila tidak kroak). */
  const croakPos = ref<{ x: number; y: number } | null>(null);

  const selectedMeta = computed(() => getLevelMeta(selectedLevel.value));
  /** Ada level berikutnya setelah yang dipilih (buat tombol modal). */
  const hasNext = computed(
    () =>
      LEVEL_PACK.findIndex((m) => m.id === selectedLevel.value) + 1 <
      LEVEL_PACK.length,
  );
  /** Jumlah lalat di level yang dipilih (buat teks setup). */
  const selectedFliesTotal = computed(
    () => getLevel(selectedMeta.value.soloId).flies.length,
  );

  let game: FrogGame | null = null;

  /** Pilih level (hanya yang sudah terbuka). */
  function selectLevel(id: string): void {
    const idx = LEVEL_PACK.findIndex((m) => m.id === id);
    if (idx >= 0 && idx < unlocked.value) selectedLevel.value = id;
  }

  /** Masuk layar game (render container dulu, game dipasang menyusul). */
  function begin(): void {
    hud.value = freshHud();
    hud.value.fliesTotal = selectedFliesTotal.value;
    winTime.value = 0;
    winFlies.value = 0;
    winFliesTotal.value = selectedFliesTotal.value;
    croakPos.value = null;
    phase.value = "playing";
  }

  /** Pasang game ke container yang sudah ter-render. */
  function attachGame(container: HTMLElement): void {
    disposeGame();
    game = new FrogGame(container, {
      levelId: selectedMeta.value.soloId,
      onHud: (h) => {
        hud.value = h;
      },
      onWin: (time, flies) => {
        winTime.value = time;
        winFlies.value = flies;
        const p = markCompleted(selectedLevel.value);
        unlocked.value = p.unlocked;
        completed.value = p.completed;
        phase.value = "won";
      },
      onCroak: (pos) => {
        croakPos.value = pos;
      },
    });
  }

  /** Main lagi: game baru dari spawn (level yang sama). */
  function rematch(): void {
    disposeGame();
    begin();
  }

  /** Lanjut ke level berikutnya (dari modal menang). */
  function nextLevel(): void {
    const idx = LEVEL_PACK.findIndex((m) => m.id === selectedLevel.value);
    if (idx + 1 >= LEVEL_PACK.length) return;
    selectedLevel.value = LEVEL_PACK[idx + 1]!.id;
    disposeGame();
    begin();
  }

  function disposeGame(): void {
    game?.dispose();
    game = null;
  }

  /** Input sentuh (dari FrogTouchControls, diteruskan ke game). */
  function touchMove(x: number, y: number): void {
    game?.setTouchMove(x, y);
  }

  function touchJump(): void {
    game?.queueJump();
  }

  function touchTongue(): void {
    game?.toggleTongue();
  }

  function touchCroak(): void {
    game?.croak();
  }

  function touchOrbit(dx: number): void {
    game?.orbitBy(dx);
  }

  function toSetup(): void {
    disposeGame();
    croakPos.value = null;
    phase.value = "setup";
  }

  return {
    phase,
    selectedColor,
    selectedLevel,
    selectedMeta,
    hasNext,
    selectedFliesTotal,
    unlocked,
    completed,
    hud,
    winTime,
    winFlies,
    winFliesTotal,
    croakPos,
    selectLevel,
    begin,
    attachGame,
    rematch,
    nextLevel,
    toSetup,
    touchMove,
    touchJump,
    touchTongue,
    touchCroak,
    touchOrbit,
  };
});
