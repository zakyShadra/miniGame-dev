// Store katak (Pinia): fase game + HUD reaktif. Instance FrogGame
// disimpan NON-reaktif (seperti NavalGame di store naval); HUD di-sync
// lewat callback ~10 Hz dari game loop.

import { ref } from "vue";
import { defineStore } from "pinia";
import { FrogGame, type FrogHud } from "../lib/game";

export type FrogPhase = "setup" | "playing" | "won";
export type FrogColorChoice = "orange" | "purple";

function freshHud(): FrogHud {
  return {
    fliesGot: 0,
    fliesTotal: 5,
    tongueMode: "idle",
    time: 0,
    fps: 0,
    calls: 0,
    triangles: 0,
  };
}

export const useFrogStore = defineStore("frog", () => {
  const phase = ref<FrogPhase>("setup");
  // F1 solo: hanya oranye. Ungu dibuka di F2 (co-op).
  const selectedColor = ref<FrogColorChoice>("orange");
  const hud = ref<FrogHud>(freshHud());
  const winTime = ref(0);
  const winFlies = ref(0);
  /** Posisi bubble kroak di layar (null bila tidak kroak). */
  const croakPos = ref<{ x: number; y: number } | null>(null);

  let game: FrogGame | null = null;

  /** Masuk layar game (render container dulu, game dipasang menyusul). */
  function begin(): void {
    hud.value = freshHud();
    winTime.value = 0;
    winFlies.value = 0;
    croakPos.value = null;
    phase.value = "playing";
  }

  /** Pasang game ke container yang sudah ter-render. */
  function attachGame(container: HTMLElement): void {
    disposeGame();
    game = new FrogGame(container, {
      onHud: (h) => {
        hud.value = h;
      },
      onWin: (time, flies) => {
        winTime.value = time;
        winFlies.value = flies;
        phase.value = "won";
      },
      onCroak: (pos) => {
        croakPos.value = pos;
      },
    });
  }

  /** Main lagi: game baru dari spawn. */
  function rematch(): void {
    disposeGame();
    begin();
  }

  function disposeGame(): void {
    game?.dispose();
    game = null;
  }

  function toSetup(): void {
    disposeGame();
    croakPos.value = null;
    phase.value = "setup";
  }

  return {
    phase,
    selectedColor,
    hud,
    winTime,
    winFlies,
    croakPos,
    begin,
    attachGame,
    rematch,
    toSetup,
  };
});
