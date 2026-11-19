// Store naval (Pinia): fase game + HUD reaktif. Instance NavalGame
// disimpan NON-reaktif (seperti chess.js di store catur); HUD di-sync
// lewat callback ~10 Hz dari game loop.

import { ref } from "vue";
import { defineStore } from "pinia";
import { NavalGame, type NavalHud } from "../lib/game";
import type { ShipId } from "../lib/types";

export type NavalPhase = "setup" | "playing";

const EMPTY_HUD: NavalHud = {
  speed: 0,
  headingDeg: 90,
  hp: 300,
  maxHp: 300,
  dummyHp: 300,
  dummyMaxHp: 300,
  dummyVisible: true,
};

export const useNavalStore = defineStore("naval", () => {
  const phase = ref<NavalPhase>("setup");
  const selectedShip = ref<ShipId>("galleon");
  const hud = ref<NavalHud>({ ...EMPTY_HUD });

  let game: NavalGame | null = null;

  function startGame(container: HTMLElement): void {
    disposeGame();
    hud.value = { ...EMPTY_HUD };
    game = new NavalGame(container, {
      shipId: selectedShip.value,
      onHud: (h) => {
        hud.value = h;
      },
    });
    phase.value = "playing";
  }

  function disposeGame(): void {
    game?.dispose();
    game = null;
  }

  function toSetup(): void {
    disposeGame();
    phase.value = "setup";
  }

  return { phase, selectedShip, hud, startGame, toSetup };
});
