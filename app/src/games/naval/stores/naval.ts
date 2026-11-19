// Store naval (Pinia): fase game + HUD reaktif. Instance NavalGame
// disimpan NON-reaktif (seperti chess.js di store catur); HUD di-sync
// lewat callback ~10 Hz dari game loop.

import { ref } from "vue";
import { defineStore } from "pinia";
import { MATCH_DURATION, NavalGame, type NavalHud, type NavalWinner } from "../lib/game";
import { BOT_LEVELS, type BotLevel } from "../../../../../shared/naval/bot";
import { getShipDef } from "../../../../../shared/naval/ships";
import type { ShipId } from "../../../../../shared/naval/types";

export type NavalPhase = "setup" | "playing" | "over";
export type NavalLevel = 1 | 2 | 3;

/** Nomor level (1-3) -> BotLevel (menentukan kapal musuh + map). */
export const LEVEL_TO_BOT: Record<NavalLevel, BotLevel> = {
  1: "medium",
  2: "hard",
  3: "extreme",
};

/** localStorage: level tertinggi yang sudah terbuka. */
const UNLOCK_KEY = "minigame:naval-unlocked";

function readUnlocked(): number {
  try {
    const v = Number(localStorage.getItem(UNLOCK_KEY));
    if (Number.isInteger(v) && v >= 1 && v <= 3) return v;
  } catch {
    // localStorage tidak tersedia: mulai dari level 1.
  }
  return 1;
}

/** HUD awal dari stats kapal yang dipilih + kapal musuh level saat ini. */
function freshHud(shipId: ShipId, level: NavalLevel): NavalHud {
  const me = getShipDef(shipId);
  const info = BOT_LEVELS[LEVEL_TO_BOT[level]];
  const foe = getShipDef(info.botShip);
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
    dummyName: `${foe.name} · Lv ${level} ${info.label}`,
    aimDist: -1,
    aimLead: -1,
    aimBlocked: false,
    aimOutOfRange: false,
  };
}

export interface DamageNum {
  id: number;
  x: number;
  y: number;
  amount: number;
}

export const useNavalStore = defineStore("naval", () => {
  const phase = ref<NavalPhase>("setup");
  // Default Frigate (kapal pemain di preview yang di-approve).
  const selectedShip = ref<ShipId>("frigate");
  /** Level yang dipilih di setup (1-3). */
  const level = ref<NavalLevel>(1);
  /** Level tertinggi yang terbuka (persist localStorage). */
  const unlockedLevel = ref<number>(readUnlocked());
  /** Level yang baru terbuka dari kemenangan terakhir (buat modal). */
  const justUnlocked = ref<number | null>(null);
  const hud = ref<NavalHud>(freshHud("frigate", 1));
  const winner = ref<NavalWinner | null>(null);
  const damageNums = ref<DamageNum[]>([]);
  const hitFlash = ref(0);

  let game: NavalGame | null = null;
  let dmgId = 0;

  /** Masuk layar game (render container dulu, game dipasang menyusul). */
  function begin(): void {
    hud.value = freshHud(selectedShip.value, level.value);
    winner.value = null;
    justUnlocked.value = null;
    damageNums.value = [];
    phase.value = "playing";
  }

  /** Pasang game ke container yang sudah ter-render. */
  function attachGame(container: HTMLElement): void {
    disposeGame();
    const botLevel = LEVEL_TO_BOT[level.value];
    game = new NavalGame(container, {
      shipId: selectedShip.value,
      botLevel,
      mapId: BOT_LEVELS[botLevel].mapId,
      onHud: (h) => {
        hud.value = h;
      },
      onMatchEnd: (w) => {
        winner.value = w;
        // Menang di level tertinggi yang terbuka = buka level berikutnya.
        if (w === "player" && level.value === unlockedLevel.value && level.value < 3) {
          unlockedLevel.value = level.value + 1;
          justUnlocked.value = unlockedLevel.value;
          try {
            localStorage.setItem(UNLOCK_KEY, String(unlockedLevel.value));
          } catch {
            // localStorage tidak tersedia: unlock hanya di sesi ini.
          }
        }
        phase.value = "over";
      },
      onDamage: (d) => {
        const id = ++dmgId;
        damageNums.value.push({ ...d, id });
        setTimeout(() => {
          damageNums.value = damageNums.value.filter((n) => n.id !== id);
        }, 1000);
      },
      onPlayerHit: () => {
        hitFlash.value++;
      },
    });
  }

  /** Main lagi: game baru dengan kapal yang sama. */
  function rematch(): void {
    disposeGame();
    begin();
  }

  /** Kontrol sentuh (dari NavalTouchControls). No-op bila game belum jalan. */
  function setTouchInput(input: { throttle: number; rudder: number }): void {
    game?.setTouchInput(input);
  }

  function touchFire(): void {
    game?.fireAtAim();
  }

  function touchAbility(): void {
    game?.useAbilityNow();
  }

  function touchAim(clientX: number, clientY: number): void {
    game?.setAimFromScreen(clientX, clientY);
  }

  function disposeGame(): void {
    game?.dispose();
    game = null;
  }

  function toSetup(): void {
    disposeGame();
    winner.value = null;
    justUnlocked.value = null;
    phase.value = "setup";
  }

  return { phase, selectedShip, level, unlockedLevel, justUnlocked, hud, winner, damageNums, hitFlash, begin, attachGame, rematch, toSetup, setTouchInput, touchFire, touchAbility, touchAim };
});
