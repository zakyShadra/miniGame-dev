// Simulasi naval murni (tanpa Three.js): gerak kapal, peluru, tabrakan,
// line-of-sight, tenggelam. Deterministik, fixed timestep 20 Hz.
// Dirancang agar bisa dipakai ulang server (PartyServer) di N5.

import { getShipDef } from "./ships";
import type {
  GameState,
  IslandDef,
  MapDef,
  ShipDef,
  ShipInput,
  ShipState,
  SimEvent,
  Vec2,
} from "./types";

export const TICK_HZ = 20;
export const TICK_DT = 1 / TICK_HZ;
export const GRAVITY = 9.8;
export const SINK_DURATION = 4;

export function shipForward(heading: number): Vec2 {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/** Tinggi gelombang di (x, z) pada waktu t. Dipakai air + goyangan kapal. */
export function waveHeight(x: number, z: number, t: number): number {
  return (
    0.32 * Math.sin(x * 0.08 + t * 0.9) +
    0.22 * Math.sin(z * 0.11 - t * 0.7) +
    0.13 * Math.sin((x + z) * 0.05 + t * 1.3)
  );
}

export function createShip(
  id: string,
  defId: ShipDef["id"],
  x: number,
  z: number,
  heading: number,
): ShipState {
  const def = getShipDef(defId);
  return {
    id,
    defId,
    x,
    z,
    prevX: x,
    prevZ: z,
    heading,
    prevHeading: heading,
    speed: 0,
    turn: 0,
    heel: 0,
    hp: def.hp,
    maxHp: def.hp,
    alive: true,
    sinking: false,
    sinkTime: 0,
    lastFireAt: -999,
    abilityReadyAt: 0,
    abilityUntil: 0,
    throttle: 0,
    rudder: 0,
  };
}

/** Spawn yang dipakai satu kapal di createGame (C = co-op pemain ke-2). */
export type SpawnSlot = "A" | "B" | "C";

export function createGame(
  map: MapDef,
  ships: Array<{ id: string; defId: ShipDef["id"]; spawn: SpawnSlot }>,
): GameState {
  return {
    map,
    ships: ships.map((s) => {
      const sp =
        s.spawn === "A"
          ? map.spawnA
          : s.spawn === "B"
            ? map.spawnB
            : (map.spawnC ?? { x: map.spawnA.x, z: map.spawnA.z + 60, heading: map.spawnA.heading });
      return createShip(s.id, s.defId, sp.x, sp.z, sp.heading);
    }),
    shells: [],
    time: 0,
    nextShellId: 1,
    winnerId: null,
    lastHitterId: null,
  };
}

export function getShip(state: GameState, id: string): ShipState | undefined {
  return state.ships.find((s) => s.id === id);
}

function isDiving(ship: ShipState, time: number): boolean {
  return ship.defId === "submarine" && ship.abilityUntil > time;
}

function hasArmor(ship: ShipState, time: number): boolean {
  return ship.defId === "battleship" && ship.abilityUntil > time;
}

/** Garis pandang A -> B terhalang pulau? (segmen 2D vs lingkaran pulau). */
export function hasLineOfSight(
  islands: IslandDef[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  for (const isl of islands) {
    if (segmentCircleHit(ax, az, bx, bz, isl.x, isl.z, isl.radius + 1) !== null) {
      return false;
    }
  }
  return true;
}

/** Titik potong pertama segmen (ax,az)->(bx,bz) dengan lingkaran, atau null. */
function segmentCircleHit(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): { t: number; x: number; z: number } | null {
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
  const sq = Math.sqrt(disc);
  const t = (-b - sq) / (2 * a);
  if (t < 0 || t > 1) return null;
  return { t, x: ax + dx * t, z: az + dz * t };
}

function stepShip(
  state: GameState,
  ship: ShipState,
  input: ShipInput,
  dt: number,
  events: SimEvent[],
): void {
  ship.prevX = ship.x;
  ship.prevZ = ship.z;
  ship.prevHeading = ship.heading;
  ship.throttle = input.throttle;
  ship.rudder = input.rudder;

  if (ship.sinking) {
    ship.speed *= Math.max(0, 1 - 2 * dt);
    ship.sinkTime += dt;
    if (ship.sinkTime >= SINK_DURATION && ship.alive) {
      ship.alive = false;
      events.push({ type: "sunk", shipId: ship.id });
      // Pemenang hanya bila tepat satu kapal tersisa hidup (di 1v1 sama
      // seperti dulu; di co-op 3 kapal, penentuan menang tim di orchestrator).
      if (state.winnerId === null) {
        const alive = state.ships.filter((s) => s.alive);
        const last = alive[0];
        if (alive.length === 1 && last) state.winnerId = last.id;
      }
    }
    return;
  }
  if (!ship.alive) return;

  moveShip(state, ship, input, dt, events);
}

/**
 * Fisika gerak satu kapal saja: kecepatan, belok, kemiringan lambung,
 * posisi, tabrakan pulau, batas arena. Diekspor buat prediksi client
 * (N5). Jangan dipanggil untuk kapal yang sedang tenggelam / mati.
 */
export function moveShip(
  state: GameState,
  ship: ShipState,
  input: ShipInput,
  dt: number,
  events?: SimEvent[],
): void {
  const def = getShipDef(ship.defId);
  // Kecepatan: mendekati target dengan akselerasi / deselerasi (momentum).
  const target =
    input.throttle >= 0 ? input.throttle * def.maxSpeed : input.throttle * def.reverseSpeed;
  const rate = Math.abs(target) > Math.abs(ship.speed) ? def.accel : def.decel;
  const diff = target - ship.speed;
  ship.speed += Math.max(-rate * dt, Math.min(rate * dt, diff));

  // Belok: butuh laju untuk otoritas kemudi; mundur membalik arah belok.
  const authority = 0.25 + 0.75 * Math.min(1, Math.abs(ship.speed) / 6);
  const dir = ship.speed >= 0 ? 1 : -1;
  ship.turn = input.rudder * def.turnRate * authority * dir;
  ship.heading += ship.turn * dt;

  // Kemiringan lambung saat belok (visual): miring ke luar belokan.
  const heelTarget = Math.max(-0.14, Math.min(0.14, -ship.turn * Math.abs(ship.speed) * 0.02));
  ship.heel += (heelTarget - ship.heel) * Math.min(1, 3 * dt);

  const fwd = shipForward(ship.heading);
  ship.x += fwd.x * ship.speed * dt;
  ship.z += fwd.z * ship.speed * dt;

  // Tabrakan pulau: dorong keluar + redam laju (bump).
  for (const isl of state.map.islands) {
    const dx = ship.x - isl.x;
    const dz = ship.z - isl.z;
    const dist = Math.hypot(dx, dz);
    const minDist = isl.radius + def.radius * 0.8;
    if (dist < minDist && dist > 0.001) {
      const nx = dx / dist;
      const nz = dz / dist;
      ship.x = isl.x + nx * minDist;
      ship.z = isl.z + nz * minDist;
      const into = fwd.x * -nx + fwd.z * -nz;
      if (ship.speed > 4 && into > 0.3) {
        events?.push({ type: "bump", shipId: ship.id });
      }
      if (into > 0) ship.speed *= 0.35;
    }
  }

  // Batas arena: tahan di dalam lingkaran.
  const dc = Math.hypot(ship.x, ship.z);
  const maxR = state.map.arenaRadius - def.radius;
  if (dc > maxR) {
    ship.x *= maxR / dc;
    ship.z *= maxR / dc;
    ship.speed *= 0.5;
  }
}

/**
 * Tabrakan antar kapal: semua pasangan (bukan hanya 2 kapal pertama).
 * Iterasi 3x agar kluster 3+ kapal terurai; di 1v1 pass ke-2/3 no-op.
 */
function stepShipPair(state: GameState, events: SimEvent[]): void {
  const ships = state.ships;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i];
        const b = ships[j];
        if (!a || !b) continue;
        if (!a.alive || !b.alive || a.sinking || b.sinking) continue;
        const ra = getShipDef(a.defId).radius;
        const rb = getShipDef(b.defId).radius;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minDist = (ra + rb) * 0.8;
        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const nz = dz / dist;
          const overlap = (minDist - dist) / 2;
          a.x -= nx * overlap;
          a.z -= nz * overlap;
          b.x += nx * overlap;
          b.z += nz * overlap;
          a.speed *= 0.5;
          b.speed *= 0.5;
          if (pass === 0 && (Math.abs(a.speed) > 3 || Math.abs(b.speed) > 3)) {
            events.push({ type: "bump", shipId: a.id });
            events.push({ type: "bump", shipId: b.id });
          }
        }
      }
    }
  }
}

/** Jarak terdekat titik ke segmen; dipakai tes tabrakan peluru. */
function segmentPointDist(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (len2 > 0) {
    t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2));
  }
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const cz = az + abz * t;
  return Math.hypot(px - cx, py - cy, pz - cz);
}

function damageShip(
  state: GameState,
  ship: ShipState,
  amount: number,
  byShipId: string,
  x: number,
  y: number,
  z: number,
  events: SimEvent[],
): void {
  if (!ship.alive || ship.sinking) return;
  const final = hasArmor(ship, state.time) ? amount * 0.7 : amount;
  ship.hp = Math.max(0, ship.hp - final);
  state.lastHitterId = byShipId;
  events.push({ type: "hit", shipId: ship.id, byShipId, damage: final, x, y, z });
  if (ship.hp <= 0) {
    ship.sinking = true;
    ship.sinkTime = 0;
    events.push({ type: "sink-start", shipId: ship.id });
  }
}

function stepShells(state: GameState, dt: number, events: SimEvent[]): void {
  for (const sh of state.shells) {
    if (!sh.alive) continue;
    const px = sh.x;
    const py = sh.y;
    const pz = sh.z;
    sh.vy -= GRAVITY * dt;
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    sh.z += sh.vz * dt;

    // Pulau memblokir: segmen memotong silinder pulau di bawah puncaknya.
    let blocked = false;
    for (const isl of state.map.islands) {
      const hit = segmentCircleHit(px, pz, sh.x, sh.z, isl.x, isl.z, isl.radius);
      if (hit) {
        const yAt = py + (sh.y - py) * hit.t;
        if (yAt < isl.height) {
          events.push({ type: "island-hit", x: hit.x, y: Math.max(1, yAt), z: hit.z });
          sh.alive = false;
          blocked = true;
          break;
        }
      }
    }
    if (blocked) continue;

    // Kapal: 3 bola hit (haluan, tengah, buritan) sepanjang lambung.
    for (const ship of state.ships) {
      if (ship.id === sh.fromShipId || !ship.alive || ship.sinking) continue;
      if (isDiving(ship, state.time)) continue;
      const def = getShipDef(ship.defId);
      const fwd = shipForward(ship.heading);
      const hr = Math.max(def.beam * 0.75, 6);
      for (const off of [-def.length * 0.28, 0, def.length * 0.28]) {
        const cx = ship.x + fwd.x * off;
        const cz = ship.z + fwd.z * off;
        if (segmentPointDist(cx, 4, cz, px, py, pz, sh.x, sh.y, sh.z) < hr) {
          damageShip(state, ship, sh.damage, sh.fromShipId, cx, 4, cz, events);
          sh.alive = false;
          break;
        }
      }
      if (!sh.alive) break;
    }
    if (!sh.alive) continue;

    // Air: cipratan (+ damage area kalau peluru splash).
    if (sh.y <= 0) {
      events.push({ type: "splash", x: sh.x, z: sh.z });
      if (sh.splashRadius > 0) {
        for (const ship of state.ships) {
          if (ship.id === sh.fromShipId || !ship.alive || ship.sinking) continue;
          if (Math.hypot(ship.x - sh.x, ship.z - sh.z) < sh.splashRadius + defRadius(ship)) {
            damageShip(state, ship, sh.damage * 0.6, sh.fromShipId, ship.x, 3, ship.z, events);
          }
        }
      }
      sh.alive = false;
    }
  }
  state.shells = state.shells.filter((s) => s.alive);
}

function defRadius(ship: ShipState): number {
  return getShipDef(ship.defId).radius;
}

/** Satu tick simulasi (dt tetap 1/20 dtk). Kembalikan event frame ini. */
export function stepGame(
  state: GameState,
  inputs: Map<string, ShipInput>,
  dt: number = TICK_DT,
): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.winnerId !== null) return events;
  state.time += dt;
  for (const ship of state.ships) {
    stepShip(state, ship, inputs.get(ship.id) ?? { throttle: 0, rudder: 0 }, dt, events);
  }
  stepShipPair(state, events);
  stepShells(state, dt, events);
  return events;
}

/** Tembak satu volley ke titik (aimX, aimZ). False bila reload / mati / menyelam. */
export function fireVolley(
  state: GameState,
  shipId: string,
  aimX: number,
  aimZ: number,
): boolean {
  const ship = getShip(state, shipId);
  if (!ship || !ship.alive || ship.sinking) return false;
  if (isDiving(ship, state.time)) return false;
  const def = getShipDef(ship.defId);
  if (state.time - ship.lastFireAt < def.reloadSeconds) return false;

  // Balistik: sudut elevasi agar peluru jatuh di jarak target.
  const dx = aimX - ship.x;
  const dz = aimZ - ship.z;
  const dist = Math.hypot(dx, dz);
  const v = def.shellSpeed;
  const maxRange = (v * v) / GRAVITY;
  const d = Math.min(dist, maxRange * 0.98);
  const sin2 = Math.min(1, (GRAVITY * d) / (v * v));
  const elev = 0.5 * Math.asin(sin2);
  const dirX = dist > 0.01 ? dx / dist : 1;
  const dirZ = dist > 0.01 ? dz / dist : 0;

  // Meriam Ganda: volley berikutnya 2x peluru (kemampuan Galleon).
  const doubleShot = ship.defId === "galleon" && ship.abilityUntil > state.time;
  if (doubleShot) ship.abilityUntil = 0;
  const count = def.volleyCount * (doubleShot ? 2 : 1);
  const splash = ship.defId === "frigate" && ship.abilityUntil > state.time ? 14 : 0;
  if (splash > 0) ship.abilityUntil = 0;

  const mx = ship.x;
  const my = 4 + waveHeight(ship.x, ship.z, state.time);
  const mz = ship.z;
  for (let i = 0; i < count; i++) {
    const spread = (i - (count - 1) / 2) * def.volleySpread;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    const hx = dirX * cos - dirZ * sin;
    const hz = dirX * sin + dirZ * cos;
    const speed = v * (1 + (Math.random() - 0.5) * 0.04);
    state.shells.push({
      id: state.nextShellId++,
      x: mx,
      y: my,
      z: mz,
      vx: hx * speed * Math.cos(elev),
      vy: speed * Math.sin(elev),
      vz: hz * speed * Math.cos(elev),
      fromShipId: shipId,
      damage: def.damage,
      splashRadius: splash,
      alive: true,
    });
  }
  ship.lastFireAt = state.time;
  return true;
}

/** Aktifkan kemampuan kapal. False bila cooldown / mati / menyelam. */
export function useAbility(state: GameState, shipId: string): boolean {
  const ship = getShip(state, shipId);
  if (!ship || !ship.alive || ship.sinking) return false;
  if (state.time < ship.abilityReadyAt) return false;
  const def = getShipDef(ship.defId);
  switch (def.ability) {
    case "double-shot":
      ship.abilityUntil = state.time + 6;
      break;
    case "armor":
      ship.abilityUntil = state.time + 8;
      break;
    case "splash":
      ship.abilityUntil = state.time + 6;
      break;
    case "dive":
      ship.abilityUntil = state.time + 5;
      break;
    case "radar":
      ship.abilityUntil = state.time + 5;
      break;
  }
  ship.abilityReadyAt = state.time + def.abilityCooldown;
  return true;
}
