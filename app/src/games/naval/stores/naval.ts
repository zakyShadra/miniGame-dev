// Store naval (Pinia): fase game + HUD reaktif. Instance NavalGame
// disimpan NON-reaktif (seperti chess.js di store catur); HUD di-sync
// lewat callback ~10 Hz dari game loop.

import { ref } from "vue";
import { defineStore } from "pinia";
import { NavalGame, type NavalHud } from "../lib/game";
import { getShipDef } from "../lib/ships";
import type { ShipId } from "../lib/types";

export type NavalPhase = "setup" | "playing";

/** HUD awal dari stats kapal yang dipilih (musuh latihan = Galleon). */
function freshHud(shipId: ShipId): NavalHud {
  const me = getShipDef(shipId);
  const foe = getShipDef("galleon");
  return {
    speed: 0,
    headingDeg: 90,
    hp: me.hp,
    maxHp: me.hp,
    dummyHp: foe.hp,
    dummyMaxHp: foe.hp,
    dummyVisible: true,
  };
}

export const useNavalStore = defineStore("naval", () => {
  const phase = ref<NavalPhase>("setup");
  // Default Frigate (kapal pemain di preview yang di-approve).
  const selectedShip = ref<ShipId>("frigate");
  const hud = ref<NavalHud>(freshHud("frigate"));

  let game: NavalGame | null = null;

  /** Masuk layar game (render container dulu, game dipasang menyusul). */
  function begin(): void {
    hud.value = freshHud(selectedShip.value);
    phase.value = "playing";
  }

  /** Pasang game ke container yang sudah ter-render. */
  function attachGame(container: HTMLElement): void {
    disposeGame();
    game = new NavalGame(container, {
      shipId: selectedShip.value,
      onHud: (h) => {
        hud.value = h;
      },
    });
  }

  function disposeGame(): void {
    game?.dispose();
    game = null;
  }

  function toSetup(): void {
    disposeGame();
    phase.value = "setup";
  }

  return { phase, selectedShip, hud, begin, attachGame, toSetup };
});
