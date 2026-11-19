// Store naval (Pinia): fase game + HUD reaktif. Instance NavalGame
// disimpan NON-reaktif (seperti chess.js di store catur); HUD di-sync
// lewat callback ~10 Hz dari game loop.

import { ref } from "vue";
import { defineStore } from "pinia";
import { MATCH_DURATION, NavalGame, type NavalHud, type NavalWinner } from "../lib/game";
import { getShipDef } from "../lib/ships";
import type { ShipId } from "../lib/types";

export type NavalPhase = "setup" | "playing" | "over";

/** HUD awal dari stats kapal yang dipilih (musuh latihan = Galleon). */
function freshHud(shipId: ShipId): NavalHud {
  const me = getShipDef(shipId);
  const foe = getShipDef("galleon");
  return {
    speed: 0,
    maxSpeed: me.maxSpeed,
    headingDeg: 90,
    hp: me.hp,
    maxHp: me.hp,
    dummyHp: foe.hp,
    dummyMaxHp: foe.hp,
    dummyVisible: true,
    px: -270,
    pz: 0,
    dx: 270,
    dz: 0,
    distance: 0,
    timeLeft: MATCH_DURATION,
    reloadFrac: 1,
    reloadLeft: 0,
    abilityFrac: 1,
    abilityLeft: 0,
    abilityName: me.abilityName,
    shipName: me.name,
    dummyName: foe.name,
  };
}

export const useNavalStore = defineStore("naval", () => {
  const phase = ref<NavalPhase>("setup");
  // Default Frigate (kapal pemain di preview yang di-approve).
  const selectedShip = ref<ShipId>("frigate");
  const hud = ref<NavalHud>(freshHud("frigate"));
  const winner = ref<NavalWinner | null>(null);

  let game: NavalGame | null = null;

  /** Masuk layar game (render container dulu, game dipasang menyusul). */
  function begin(): void {
    hud.value = freshHud(selectedShip.value);
    winner.value = null;
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
      onMatchEnd: (w) => {
        winner.value = w;
        phase.value = "over";
      },
    });
  }

  /** Main lagi: game baru dengan kapal yang sama. */
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
    winner.value = null;
    phase.value = "setup";
  }

  return { phase, selectedShip, hud, winner, begin, attachGame, rematch, toSetup };
});
