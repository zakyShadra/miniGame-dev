// Bot AI naval (N3): 3 level (Medium / Hard / Extreme). TypeScript murni,
// tanpa Three.js / window / DOM, agar bisa dipakai ulang server PartyServer
// (N5). Gerakan sengaja acak dan sulit ditebak: waypoint acak, timing
// tembak acak, manuver menghindar acak, sesekali manuver palsu. Tanpa
// rute patroli tetap.
//
// Cara pakai (orchestrator, tiap tick):
//   const d = bot.update(state, TICK_DT);
//   inputs.set(botId, d.input);
//   if (d.fireAt) fireVolley(state, botId, d.fireAt.x, d.fireAt.z);
//   if (d.useAbility) useAbility(state, botId);

import { GRAVITY, getShip, hasLineOfSight, shipForward } from "./sim";
import { getShipDef } from "./ships";
import type { GameState, IslandDef, ShipDef, ShipId, ShipInput, ShipState } from "./types";

export type BotLevel = "medium" | "hard" | "extreme";

export interface BotDecision {
  input: ShipInput;
  fireAt: { x: number; z: number } | null;
  useAbility: boolean;
}

export interface BotLevelInfo {
  name: string;
  label: string;
  botShip: ShipId;
  mapId: string;
  desc: string;
}

export const BOT_LEVELS: Record<BotLevel, BotLevelInfo> = {
  medium: {
    name: "Medium",
    label: "Medium",
    botShip: "galleon",
    mapId: "teluk",
    desc: "Mendekati lawan dan menembak bila dalam jangkauan. Bidik kasar, jarang menghindar.",
  },
  hard: {
    name: "Hard",
    label: "Hard",
    botShip: "frigate",
    mapId: "kepulauan",
    desc: "Pakai cover pulau, jaga jarak ideal, bidik dengan lead. Menghindar setengah waktu.",
  },
  extreme: {
    name: "Extreme",
    label: "BOSS",
    botShip: "battleship",
    mapId: "labirin",
    desc: "Agresif dan taktis: kemampuan kapal dipakai di momen tepat, gerakan sangat tidak terduga.",
  },
};

interface BotTuning {
  /** Error bidik (meter) per volley. */
  aimErrMin: number;
  aimErrMax: number;
  /** Jeda acak setelah reload siap sebelum menembak (detik). */
  fireDelayMin: number;
  fireDelayMax: number;
  /** Peluang menghindar saat peluru musuh diprediksi jatuh dekat. */
  evadeChance: number;
  /** Jeda antar manuver acak (detik). */
  maneuverMin: number;
  maneuverMax: number;
  /** Peluang memakai kemampuan saat ada kesempatan. */
  abilityChance: number;
  /** Pakai cover pulau + cari LoS (hard + extreme). */
  useCover: boolean;
  /** Jaga jarak ideal dari target (null = kejar langsung). */
  idealRange: [number, number] | null;
}

const TUNING: Record<BotLevel, BotTuning> = {
  // aimErr (m) | fireDelay (d) | evade | manuver (d) | ability | cover | jarak ideal (m)
  medium: { aimErrMin: 15, aimErrMax: 25, fireDelayMin: 0.5, fireDelayMax: 2, evadeChance: 0.2, maneuverMin: 8, maneuverMax: 15, abilityChance: 0.1, useCover: false, idealRange: null },
  hard: { aimErrMin: 5, aimErrMax: 10, fireDelayMin: 0.2, fireDelayMax: 0.8, evadeChance: 0.5, maneuverMin: 6, maneuverMax: 11, abilityChance: 0.5, useCover: true, idealRange: [180, 280] },
  extreme: { aimErrMin: 2, aimErrMax: 5, fireDelayMin: 0, fireDelayMax: 0.3, evadeChance: 0.8, maneuverMin: 4, maneuverMax: 8, abilityChance: 1, useCover: true, idealRange: [180, 280] },
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Selisih sudut ke [-PI, PI]. */
function wrapAngle(a: number): number {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

function isDiving(ship: ShipState, time: number): boolean {
  return ship.defId === "submarine" && ship.abilityUntil > time;
}

export class BotController {
  private level: BotLevel;
  private botShipId: string;
  private rng: () => number;
  private tuning: BotTuning;

  private waypoint: { x: number; z: number } | null = null;
  private waypointUntil = 0;
  private lastRepickAt = -999;
  private evadeUntil = 0;
  private evadeRudder = 0;
  private evadeThrottle = 1;
  private maneuverUntil = 0;
  private maneuverRudder = 0;
  private maneuverThrottle = 1;
  private maneuverPhase2Until = 0;
  private maneuverPhase2Rudder = 0;
  private maneuverPhase2Throttle = 1;
  private nextManeuverAt = 0;
  private reverseUntil = 0;
  private reverseRudder = 0;
  private slowTime = 0;
  /** Posisi + waktu buat deteksi stuck berbasis posisi. */
  private stuckPos: { x: number; z: number } | null = null;
  private stuckSince = 0;
  private lastFireAtSeen: number = Number.NaN;
  private nextFireAt = 0;
  private nextAbilityAt = 0;
  private answeredShells = new Set<number>();

  constructor(level: BotLevel, botShipId: string, opts?: { rng?: () => number }) {
    this.level = level;
    this.botShipId = botShipId;
    this.rng = opts?.rng ?? Math.random;
    this.tuning = TUNING[level];
    this.reset();
  }

  reset(): void {
    this.waypoint = null;
    this.waypointUntil = 0;
    this.lastRepickAt = -999;
    this.evadeUntil = 0;
    this.maneuverUntil = 0;
    this.maneuverPhase2Until = 0;
    this.nextManeuverAt =
      this.tuning.maneuverMin + this.rng() * (this.tuning.maneuverMax - this.tuning.maneuverMin);
    this.reverseUntil = 0;
    this.slowTime = 0;
    this.stuckPos = null;
    this.stuckSince = 0;
    this.lastFireAtSeen = Number.NaN;
    this.nextFireAt = 0;
    this.nextAbilityAt = 0;
    this.answeredShells.clear();
  }

  update(state: GameState, dt: number): BotDecision {
    const idle: BotDecision = { input: { throttle: 0, rudder: 0 }, fireAt: null, useAbility: false };
    const bot = getShip(state, this.botShipId);
    if (!bot || !bot.alive || bot.sinking) return idle;
    const t = state.time;
    const def = getShipDef(bot.defId);
    const target = this.pickTarget(state, bot);

    this.updateStuck(bot, dt, t);
    this.checkIncoming(state, bot, t);
    if (t >= this.nextManeuverAt && t >= this.evadeUntil && t >= this.reverseUntil) {
      this.startRandomManeuver(t);
    }
    this.updateWaypoint(state, bot, target, t);

    const input = this.steer(state, bot, t);
    const fireAt = isDiving(bot, t) ? null : this.aim(state, bot, target, def, t);
    const useAbility = this.decideAbility(state, bot, target, t);
    return { input, fireAt, useAbility };
  }

  /** Musuh terdekat yang hidup dan tidak menyelam (null bila tak ada). */
  private pickTarget(state: GameState, bot: ShipState): ShipState | null {
    let best: ShipState | null = null;
    let bestD = Infinity;
    for (const s of state.ships) {
      if (s.id === bot.id || !s.alive || s.sinking) continue;
      if (isDiving(s, state.time)) continue;
      const d = Math.hypot(s.x - bot.x, s.z - bot.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // ----- gerak -----

  /**
   * Anti-stuck: lambat (speed < 1) ATAU posisi nyaris tidak berubah
   * padahal throttle jalan -> waypoint baru + mundur sebentar.
   */
  private updateStuck(bot: ShipState, dt: number, t: number): void {
    if (t < this.reverseUntil) return;
    if (bot.throttle > 0.3 && Math.abs(bot.speed) < 1) {
      this.slowTime += dt;
    } else {
      this.slowTime = 0;
    }
    // Deteksi posisi: belum pindah 5 m dalam 4 detik padahal throttle jalan.
    if (!this.stuckPos) {
      this.stuckPos = { x: bot.x, z: bot.z };
      this.stuckSince = t;
    } else if (Math.hypot(bot.x - this.stuckPos.x, bot.z - this.stuckPos.z) > 8) {
      this.stuckPos = { x: bot.x, z: bot.z };
      this.stuckSince = t;
    }
    const posStuck = bot.throttle > 0.3 && t - this.stuckSince > 4;
    if (this.slowTime > 3 || posStuck) {
      this.slowTime = 0;
      this.stuckPos = { x: bot.x, z: bot.z };
      this.stuckSince = t;
      this.waypoint = null;
      this.waypointUntil = 0;
      this.reverseUntil = t + 1.5;
      this.reverseRudder = this.rng() < 0.5 ? -0.7 : 0.7;
    }
  }

  /** Evasion: peluru musuh yang diprediksi jatuh < 30 m dalam < 2 detik. */
  private checkIncoming(state: GameState, bot: ShipState, t: number): void {
    if (t < this.evadeUntil) return;
    for (const id of this.answeredShells) {
      if (!state.shells.some((s) => s.id === id)) this.answeredShells.delete(id);
    }
    const fwd = shipForward(bot.heading);
    for (const sh of state.shells) {
      if (sh.fromShipId === bot.id || this.answeredShells.has(sh.id)) continue;
      const disc = sh.vy * sh.vy + 2 * GRAVITY * sh.y;
      const tof = (sh.vy + Math.sqrt(Math.max(0, disc))) / GRAVITY;
      if (tof < 0 || tof > 2) continue;
      const lx = sh.x + sh.vx * tof;
      const lz = sh.z + sh.vz * tof;
      if (Math.hypot(lx - bot.x, lz - bot.z) > 30) continue;
      // Satu peluru hanya diundi sekali (gagal = tidak menghindar).
      this.answeredShells.add(sh.id);
      if (this.rng() >= this.tuning.evadeChance) continue;
      const tx = lx - bot.x;
      const tz = lz - bot.z;
      const cross = fwd.x * tz - fwd.z * tx;
      this.evadeRudder = cross > 0 ? 1 : -1; // belok menjauhi titik jatuh
      this.evadeThrottle = this.rng() < 0.5 ? 1 : 0.25;
      this.evadeUntil = t + 1.2 + this.rng() * 1.3;
      return;
    }
  }

  /** Manuver acak berkala; 25% berupa manuver palsu (belok lalu balik). */
  private startRandomManeuver(t: number): void {
    const fake = this.rng() < 0.25;
    const rudder = (this.rng() < 0.5 ? -1 : 1) * (0.6 + this.rng() * 0.4);
    const throttle = this.rng() < 0.3 ? 0.2 + this.rng() * 0.3 : 0.7 + this.rng() * 0.3;
    const dur = 1 + this.rng() * 1.5;
    this.maneuverRudder = rudder;
    this.maneuverThrottle = throttle;
    this.maneuverUntil = t + dur;
    if (fake) {
      this.maneuverPhase2Rudder = -rudder;
      this.maneuverPhase2Throttle = throttle;
      this.maneuverPhase2Until = t + dur + 0.6 + this.rng() * 0.6;
    } else {
      this.maneuverPhase2Until = 0;
    }
    this.nextManeuverAt =
      t + this.tuning.maneuverMin + this.rng() * (this.tuning.maneuverMax - this.tuning.maneuverMin);
  }

  /**
   * Pilih waypoint. Ganti tiap 4-9 detik (acak), saat sampai, atau saat
   * jalur terhalang pulau. Bias per level: medium mengejar target,
   * hard/extreme menjaga jarak ideal + cover + LoS.
   */
  private updateWaypoint(
    state: GameState,
    bot: ShipState,
    target: ShipState | null,
    t: number,
  ): void {
    const def = getShipDef(bot.defId);
    let repick = this.waypoint === null || t >= this.waypointUntil;
    if (this.waypoint) {
      const dWp = Math.hypot(this.waypoint.x - bot.x, this.waypoint.z - bot.z);
      if (dWp < 30) repick = true;
      if (
        !repick &&
        t - this.lastRepickAt > 1 &&
        this.pathBlocked(state, bot.x, bot.z, this.waypoint.x, this.waypoint.z, def.radius)
      ) {
        repick = true;
      }
    }
    if (!repick) return;
    this.lastRepickAt = t;
    this.waypointUntil = t + 4 + this.rng() * 5;

    const hpFrac = bot.hp / bot.maxHp;
    if (target && hpFrac < 0.4 && this.tuning.useCover) {
      const cover = this.coverPoint(state, bot, target);
      if (cover) {
        // Jalur langsung ke balik pulau menembus pulau: itari lewat samping
        // dulu (titik rounding), baru ke titik cover.
        if (this.pathBlocked(state, bot.x, bot.z, cover.point.x, cover.point.z, def.radius)) {
          const round = this.roundingPoint(state, bot, target, cover.island);
          this.waypoint = round ?? cover.point;
        } else {
          this.waypoint = cover.point;
        }
        return;
      }
    }
    let desired: { x: number; z: number };
    if (!target) {
      desired = this.randomPoint(state, bot);
    } else {
      const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
      const los = hasLineOfSight(state.map.islands, bot.x, bot.z, target.x, target.z);
      if (!los && this.tuning.useCover) {
        const p = this.randomPointWithLos(state, bot, target);
        if (p) {
          this.waypoint = this.resolveWaypoint(state, bot, p);
          return;
        }
      }
      const ideal = this.tuning.idealRange;
      if (ideal) {
        if (dist > ideal[1] || dist < ideal[0]) {
          const mid = (ideal[0] + ideal[1]) / 2;
          const dx = bot.x - target.x;
          const dz = bot.z - target.z;
          const d = Math.hypot(dx, dz) || 1;
          desired = { x: target.x + (dx / d) * mid, z: target.z + (dz / d) * mid };
        } else {
          desired = this.randomRingPoint(state, bot, target, ideal[0], ideal[1]);
        }
      } else {
        const ang = this.rng() * Math.PI * 2;
        const off = 30 + this.rng() * 30;
        desired = { x: target.x + Math.cos(ang) * off, z: target.z + Math.sin(ang) * off };
      }
    }
    // Jalur ke waypoint terhalang pulau: ganti dengan titik detour di
    // samping pulau pertama yang menghalangi (bot mengitarinya).
    this.waypoint = this.resolveWaypoint(state, bot, desired);
  }

  /**
   * Kembalikan waypoint yang jalurnya bersih: bila jalur bot -> target
   * memotong pulau, kembalikan titik detour di samping pulau pertama yang
   * menghalangi (utamakan sisi yang jalur lanjutannya juga bersih).
   */
  private resolveWaypoint(
    state: GameState,
    bot: ShipState,
    target: { x: number; z: number },
  ): { x: number; z: number } {
    const defR = getShipDef(bot.defId).radius;
    if (!this.pathBlocked(state, bot.x, bot.z, target.x, target.z, defR)) return target;
    const isl = this.firstBlockingIsland(state, bot.x, bot.z, target.x, target.z, defR);
    if (!isl) return target;
    const dx = target.x - bot.x;
    const dz = target.z - bot.z;
    const d = Math.hypot(dx, dz) || 1;
    const px = -dz / d;
    const pz = dx / d;
    const r = isl.radius + 45;
    let best: { x: number; z: number } | null = null;
    let bestScore = Infinity;
    for (const side of [1, -1]) {
      const x = isl.x + px * r * side;
      const z = isl.z + pz * r * side;
      if (Math.hypot(x, z) > state.map.arenaRadius - 40) continue;
      if (this.pointBlocked(state, x, z, 20)) continue;
      const fromBlocked = this.pathBlocked(state, bot.x, bot.z, x, z, defR);
      const onwardBlocked = this.pathBlocked(state, x, z, target.x, target.z, defR);
      const score =
        Math.hypot(x - bot.x, z - bot.z) + (fromBlocked ? 5000 : 0) + (onwardBlocked ? 10000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
    return best ?? target;
  }

  /** Pulau pertama yang memotong segmen (ax,az) -> (bx,bz) (+margin). */
  private firstBlockingIsland(
    state: GameState,
    ax: number,
    az: number,
    bx: number,
    bz: number,
    shipRadius: number,
  ): IslandDef | null {
    let best: IslandDef | null = null;
    let bestT = Infinity;
    for (const isl of state.map.islands) {
      const t = this.segCircleT(ax, az, bx, bz, isl.x, isl.z, isl.radius + shipRadius);
      if (t !== null && t < bestT) {
        bestT = t;
        best = isl;
      }
    }
    return best;
  }

  /** Parameter t pertama segmen memotong lingkaran, atau null. */
  private segCircleT(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    r: number,
  ): number | null {
    const dx = bx - ax;
    const dz = bz - az;
    const fx = ax - cx;
    const fz = az - cz;
    const a = dx * dx + dz * dz;
    if (a === 0) return null;
    const b = 2 * (fx * dx + fz * dz);
    const c = fx * fx + fz * fz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > 1) return null;
    return t;
  }

  /** Titik di balik pulau terdekat (pulau di antara bot dan target). */
  private coverPoint(
    state: GameState,
    bot: ShipState,
    target: ShipState,
  ): { point: { x: number; z: number }; island: IslandDef } | null {
    let best: { point: { x: number; z: number }; island: IslandDef } | null = null;
    let bestD = Infinity;
    for (const isl of state.map.islands) {
      const dBot = Math.hypot(isl.x - bot.x, isl.z - bot.z);
      if (dBot > 180) continue;
      const dx = isl.x - target.x;
      const dz = isl.z - target.z;
      const d = Math.hypot(dx, dz) || 1;
      const px = isl.x + (dx / d) * (isl.radius + 45);
      const pz = isl.z + (dz / d) * (isl.radius + 45);
      if (Math.hypot(px, pz) > state.map.arenaRadius - 40) continue;
      if (this.pointBlocked(state, px, pz, 20)) continue;
      if (hasLineOfSight(state.map.islands, px, pz, target.x, target.z)) continue;
      if (dBot < bestD) {
        bestD = dBot;
        best = { point: { x: px, z: pz }, island: isl };
      }
    }
    return best;
  }

  /**
   * Titik di samping pulau buat mengitarinya menuju cover. Sisi dipilih
   * dari posisi bot terhadap sumbu target -> pulau (stabil selama bot
   * mendekat dari sisinya, tidak flip-flop).
   */
  private roundingPoint(
    state: GameState,
    bot: ShipState,
    target: ShipState,
    island: IslandDef,
  ): { x: number; z: number } | null {
    const dx = island.x - target.x;
    const dz = island.z - target.z;
    const d = Math.hypot(dx, dz) || 1;
    const px = -dz / d;
    const pz = dx / d;
    const r = island.radius + 40;
    const cross = dx * (bot.z - target.z) - dz * (bot.x - target.x);
    const sides = cross >= 0 ? [1, -1] : [-1, 1];
    for (const side of sides) {
      const x = island.x + px * r * side;
      const z = island.z + pz * r * side;
      if (Math.hypot(x, z) > state.map.arenaRadius - 40) continue;
      if (this.pointBlocked(state, x, z, 20)) continue;
      return { x, z };
    }
    return null;
  }

  /**
   * Titik acak di arena. Bila `from` diisi, utamakan titik yang jalurnya
   * dari kapal tidak memotong pulau (waypoint yang tak terjangkau membuat
   * bot kandas menabrak pulau berulang-ulang).
   */
  private randomPoint(state: GameState, from?: ShipState): { x: number; z: number } {
    const maxR = state.map.arenaRadius - 50;
    const defR = from ? getShipDef(from.defId).radius : 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 10; i++) {
        const r = Math.sqrt(this.rng()) * maxR;
        const a = this.rng() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (this.pointBlocked(state, x, z, 25)) continue;
        if (pass === 0 && from && this.pathBlocked(state, from.x, from.z, x, z, defR)) continue;
        return { x, z };
      }
    }
    return { x: 0, z: 0 };
  }

  private randomPointWithLos(
    state: GameState,
    bot: ShipState,
    target: ShipState,
  ): { x: number; z: number } | null {
    // Utamakan titik di cincin jarak ideal (tetap bisa menembak dari sana).
    const ideal = this.tuning.idealRange;
    if (ideal) {
      for (let i = 0; i < 8; i++) {
        const p = this.randomRingPoint(state, bot, target, ideal[0], ideal[1]);
        if (hasLineOfSight(state.map.islands, p.x, p.z, target.x, target.z)) return p;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 8; i++) {
        const p = this.randomPoint(state, pass === 0 ? bot : undefined);
        if (hasLineOfSight(state.map.islands, p.x, p.z, target.x, target.z)) return p;
      }
    }
    return null;
  }

  private randomRingPoint(
    state: GameState,
    bot: ShipState,
    target: ShipState,
    rMin: number,
    rMax: number,
  ): { x: number; z: number } {
    // Sudut di-bias ke arah tengah arena (+-120 derajat): target sering di
    // tepi arena, cincin penuh 360 derajat banyak jatuh di luar arena.
    const base = Math.atan2(-target.z, -target.x);
    const defR = getShipDef(bot.defId).radius;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 8; i++) {
        const a = base + (this.rng() - 0.5) * 2 * 2.1;
        const r = rMin + this.rng() * (rMax - rMin);
        const x = target.x + Math.cos(a) * r;
        const z = target.z + Math.sin(a) * r;
        if (Math.hypot(x, z) > state.map.arenaRadius - 40) continue;
        if (this.pointBlocked(state, x, z, 25)) continue;
        if (pass === 0 && this.pathBlocked(state, bot.x, bot.z, x, z, defR)) continue;
        return { x, z };
      }
    }
    return this.randomPoint(state, bot);
  }

  /** Titik (x, z) masuk pulau (+margin)? */
  private pointBlocked(state: GameState, x: number, z: number, margin: number): boolean {
    for (const isl of state.map.islands) {
      if (Math.hypot(x - isl.x, z - isl.z) < isl.radius + margin) return true;
    }
    return false;
  }

  /** Segmen (ax,az) -> (bx,bz) memotong pulau (+jari-jari kapal)? */
  private pathBlocked(
    state: GameState,
    ax: number,
    az: number,
    bx: number,
    bz: number,
    shipRadius: number,
  ): boolean {
    for (const isl of state.map.islands) {
      if (this.segPointDist(isl.x, isl.z, ax, az, bx, bz) < isl.radius + shipRadius) {
        return true;
      }
    }
    return false;
  }

  private segPointDist(
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): number {
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    let t = 0;
    if (len2 > 0) {
      t = clamp(((px - ax) * abx + (pz - az) * abz) / len2, 0, 1);
    }
    return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
  }

  /**
   * Steering: prioritas mundur anti-stuck > menghindar > manuver >
   * waypoint. Semua cabang (kecuali mundur) difilter avoidance pulau,
   * supaya manuver acak pun tidak menabrakkan bot ke pulau.
   */
  private steer(state: GameState, bot: ShipState, t: number): ShipInput {
    if (t < this.reverseUntil) return { throttle: -0.7, rudder: this.reverseRudder };
    let input: ShipInput;
    if (t < this.evadeUntil) {
      input = { throttle: this.evadeThrottle, rudder: this.evadeRudder };
    } else if (t < this.maneuverUntil) {
      input = { throttle: this.maneuverThrottle, rudder: this.maneuverRudder };
    } else if (t < this.maneuverPhase2Until) {
      input = { throttle: this.maneuverPhase2Throttle, rudder: this.maneuverPhase2Rudder };
    } else {
      const wp = this.waypoint;
      if (!wp) return { throttle: 0, rudder: 0 };
      input = this.steerTo(state, bot, wp.x, wp.z);
    }
    return this.avoidIslands(state, bot, input);
  }

  /**
   * Rudder proporsional terhadap error heading; throttle mengecil saat
   * belok tajam. Tepi arena membalik haluan ke tengah.
   */
  private steerTo(state: GameState, bot: ShipState, tx: number, tz: number): ShipInput {
    let dx = tx - bot.x;
    let dz = tz - bot.z;
    const dist = Math.hypot(dx, dz);
    const dc = Math.hypot(bot.x, bot.z);
    if (dc > state.map.arenaRadius - 60) {
      dx = -bot.x;
      dz = -bot.z;
    }
    const desired = Math.atan2(dx, dz);
    const err = wrapAngle(desired - bot.heading);
    const rudder = clamp(err * 2.5, -1, 1);
    let throttle = 1;
    if (Math.abs(err) > 1.0) throttle = 0.35;
    else if (Math.abs(err) > 0.5) throttle = 0.6;
    // Pelan saat mendekat, berhenti di waypoint (penting di cover: jangan
    // overshoot keluar bayangan pulau).
    if (dist < 25) throttle = 0;
    else if (dist < 60) throttle = Math.min(throttle, 0.5);
    return { throttle, rudder };
  }

  /**
   * Filter avoidance: bila probe 55 m di depan masuk pulau, belok ke sisi
   * yang lapang. Pilihan sisi deterministik (berbasis clearance), bukan
   * acak tiap tick, supaya tidak berosilasi.
   */
  private avoidIslands(state: GameState, bot: ShipState, input: ShipInput): ShipInput {
    if (input.throttle <= 0) return input;
    const def = getShipDef(bot.defId);
    const margin = def.radius + 12;
    const fwd = shipForward(bot.heading);
    if (!this.pointBlocked(state, bot.x + fwd.x * 55, bot.z + fwd.z * 55, margin)) {
      return input;
    }
    const leftH = bot.heading - 0.6;
    const rightH = bot.heading + 0.6;
    const leftClear = !this.pointBlocked(
      state,
      bot.x + Math.sin(leftH) * 55,
      bot.z + Math.cos(leftH) * 55,
      margin,
    );
    const rightClear = !this.pointBlocked(
      state,
      bot.x + Math.sin(rightH) * 55,
      bot.z + Math.cos(rightH) * 55,
      margin,
    );
    let rudder: number;
    if (leftClear && !rightClear) rudder = -1;
    else if (rightClear && !leftClear) rudder = 1;
    else if (!leftClear && !rightClear) {
      // Kedua sisi terhalang: pilih sisi dengan jarak bebas lebih besar.
      rudder =
        this.sideClearance(state, bot, leftH) >= this.sideClearance(state, bot, rightH) ? -1 : 1;
    } else {
      // Kedua sisi lapang: belok tajam searah rudder semula.
      rudder = input.rudder >= 0 ? 1 : -1;
    }
    return { throttle: Math.min(input.throttle, 0.6), rudder };
  }

  /** Jarak bebas (m) dari titik probe 55 m ke tepi pulau terdekat. */
  private sideClearance(state: GameState, bot: ShipState, heading: number): number {
    const px = bot.x + Math.sin(heading) * 55;
    const pz = bot.z + Math.cos(heading) * 55;
    let best = Infinity;
    for (const isl of state.map.islands) {
      best = Math.min(best, Math.hypot(px - isl.x, pz - isl.z) - isl.radius);
    }
    return best;
  }

  // ----- tembak -----

  /**
   * Titik bidik (null = jangan tembak). Syarat: reload siap + LoS +
   * dalam jangkauan (v^2/g * 0.95) + jeda acak pasca-reload terlewati.
   * Bidik = posisi target + kecepatan target * waktu terbang (lead,
   * iterasi 2x; busur bila target belok) + kompensasi tinggi luncur
   * meriam + error acak per level.
   */
  private aim(
    state: GameState,
    bot: ShipState,
    target: ShipState | null,
    def: ShipDef,
    t: number,
  ): { x: number; z: number } | null {
    if (!target) return null;
    const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
    const maxRange = (def.shellSpeed * def.shellSpeed) / GRAVITY;
    if (dist > maxRange * 0.95) return null;
    if (!hasLineOfSight(state.map.islands, bot.x, bot.z, target.x, target.z)) return null;
    if (t - bot.lastFireAt < def.reloadSeconds) return null;
    // Jeda acak diset sekali per siklus reload.
    if (this.lastFireAtSeen !== bot.lastFireAt) {
      this.lastFireAtSeen = bot.lastFireAt;
      this.nextFireAt =
        t + this.tuning.fireDelayMin + this.rng() * (this.tuning.fireDelayMax - this.tuning.fireDelayMin);
    }
    if (t < this.nextFireAt) return null;

    const v = def.shellSpeed;
    const tf = shipForward(target.heading);
    const tvx = tf.x * target.speed;
    const tvz = tf.z * target.speed;
    const omega = target.turn; // laju belok target (rad/s)
    let aimX = target.x;
    let aimZ = target.z;
    for (let i = 0; i < 2; i++) {
      const d = Math.hypot(aimX - bot.x, aimZ - bot.z);
      const theta = 0.5 * Math.asin(Math.min(1, (GRAVITY * d) / (v * v)));
      // Waktu terbang ke permukaan air dari tinggi luncur ~4 m.
      const vy0 = v * Math.sin(theta);
      const tof = (vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAVITY * 4)) / GRAVITY;
      if (Math.abs(omega) > 0.02 && Math.abs(target.speed) > 0.5) {
        // Target sedang belok: prediksi sepanjang busur, bukan garis lurus.
        // Posisi(t) = pos + (v/w) * (cos h0 - cos h1, sin h1 - sin h0).
        const h1 = target.heading + omega * tof;
        const r = target.speed / omega;
        aimX = target.x + r * (Math.cos(target.heading) - Math.cos(h1));
        aimZ = target.z + r * (Math.sin(h1) - Math.sin(target.heading));
      } else {
        aimX = target.x + tvx * tof;
        aimZ = target.z + tvz * tof;
      }
    }
    // Kompensasi tinggi luncur: peluru dari y~4 m mendarat lebih jauh dari
    // titik bidik (7-43 m tergantung jarak). Bidik lebih dekat agar peluru
    // jatuh di target, bukan terbang melewatinya.
    const aimDist = Math.hypot(aimX - bot.x, aimZ - bot.z);
    if (aimDist > 10) {
      let shootDist = aimDist;
      for (let k = 0; k < 3; k++) {
        const theta = 0.5 * Math.asin(Math.min(1, (GRAVITY * shootDist) / (v * v)));
        const vy0 = v * Math.sin(theta);
        const range =
          ((v * Math.cos(theta)) / GRAVITY) * (vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAVITY * 4));
        shootDist = Math.max(10, shootDist + (aimDist - range));
      }
      aimX = bot.x + ((aimX - bot.x) / aimDist) * shootDist;
      aimZ = bot.z + ((aimZ - bot.z) / aimDist) * shootDist;
    }
    const err = this.tuning.aimErrMin + this.rng() * (this.tuning.aimErrMax - this.tuning.aimErrMin);
    const ang = this.rng() * Math.PI * 2;
    return { x: aimX + Math.cos(ang) * err, z: aimZ + Math.sin(ang) * err };
  }

  // ----- kemampuan -----

  /** Pakai kemampuan saat ada kesempatan (diundi per jendela ~2 detik). */
  private decideAbility(
    state: GameState,
    bot: ShipState,
    target: ShipState | null,
    t: number,
  ): boolean {
    if (t < bot.abilityReadyAt) return false;
    if (bot.abilityUntil > t) return false;
    if (t < this.nextAbilityAt) return false;
    this.nextAbilityAt = t + 1.5 + this.rng() * 1.5;

    const def = getShipDef(bot.defId);
    const hpFrac = bot.hp / bot.maxHp;
    const underFire = state.shells.some(
      (s) => s.fromShipId !== bot.id && Math.hypot(s.x - bot.x, s.z - bot.z) < 150,
    );
    let opportunity = false;
    switch (def.ability) {
      case "double-shot": {
        if (!target) break;
        const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
        const maxRange = (def.shellSpeed * def.shellSpeed) / GRAVITY;
        opportunity = dist <= maxRange * 0.95 && t - bot.lastFireAt >= def.reloadSeconds;
        break;
      }
      case "armor":
        opportunity = hpFrac < 0.5 && underFire;
        break;
      case "splash": {
        if (!target) break;
        const nearIsland = state.map.islands.some(
          (isl) => Math.hypot(target.x - isl.x, target.z - isl.z) < isl.radius + 40,
        );
        const enemies = state.ships.filter((s) => s.id !== bot.id && s.alive && !s.sinking);
        const clustered =
          enemies.length > 1 &&
          enemies.some((a) => enemies.some((b) => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 60));
        opportunity = nearIsland || clustered;
        break;
      }
      case "dive":
        opportunity =
          hpFrac < 0.35 &&
          (underFire ||
            (!!target && hasLineOfSight(state.map.islands, target.x, target.z, bot.x, bot.z)));
        break;
      case "radar":
        opportunity = target === null;
        break;
    }
    if (!opportunity) return false;
    return this.rng() < this.tuning.abilityChance;
  }
}
