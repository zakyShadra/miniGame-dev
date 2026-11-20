// Simulasi katak murni (tanpa Three.js): gerak platformer, lompat,
// tabrakan AABB, lidah pegas, lalat, goal, respawn. Deterministik,
// fixed timestep 60 Hz. Dirancang agar bisa dipakai ulang server
// (PartyServer) di F2.

import { getLevel } from "./levels";
import type {
  FrogGameState,
  FrogInput,
  FrogSimEvent,
  LevelDef,
  PlatformDef,
  Vec3,
} from "./types";

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
export const GRAVITY = 22;
export const JUMP_VEL = 9;
export const MOVE_SPEED = 6;
export const GROUND_ACCEL = 40;
export const AIR_ACCEL = 18;
export const GROUND_FRICTION = 30;
/** Kecepatan horizontal maks saat berayun (pegas boleh melampaui 6). */
export const SWING_MAX_SPEED = 11;
export const TONGUE_RANGE = 12;
export const TONGUE_TIMEOUT = 5;
export const TONGUE_FLY_TIME = 0.12;
/** Setengah sudut kerucut bidik lidah (radian, ~34 derajat). */
export const TONGUE_AIM_CONE = 0.6;
export const SPRING_K = 30;
export const SPRING_DAMP = 2.5;
/** Setengah lebar badan katak + tinggi badan (meter). */
const HALF_X = 0.4;
const HALF_Z = 0.4;
const HEIGHT = 0.7;

export function createFrogGame(level: LevelDef = getLevel("bengkel")): FrogGameState {
  const spawn = { ...level.spawn };
  return {
    level,
    frog: {
      pos: { ...spawn },
      vel: { x: 0, y: 0, z: 0 },
      prevPos: { ...spawn },
      onGround: false,
      facing: Math.PI,
      checkpoint: { ...spawn },
    },
    tongue: {
      mode: "idle",
      anchorId: null,
      anchor: null,
      length: 0,
      restLength: 0,
      timeLeft: 0,
      flyTime: 0,
    },
    fliesGot: [],
    won: false,
    time: 0,
  };
}

/** Posisi mulut katak (pangkal lidah). */
export function mouthPos(f: { pos: Vec3 }): Vec3 {
  return { x: f.pos.x, y: f.pos.y + 0.62, z: f.pos.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function overlaps(frog: { pos: Vec3 }, p: PlatformDef): boolean {
  return (
    frog.pos.x + HALF_X > p.min.x &&
    frog.pos.x - HALF_X < p.max.x &&
    frog.pos.y + HEIGHT > p.min.y &&
    frog.pos.y < p.max.y &&
    frog.pos.z + HALF_Z > p.min.z &&
    frog.pos.z - HALF_Z < p.max.z
  );
}

/** Segmen a->b memotong AABB? (slab test, t di [0,1]). */
function segmentHitsBox(a: Vec3, b: Vec3, p: PlatformDef): boolean {
  let tmin = 0;
  let tmax = 1;
  for (const ax of ["x", "y", "z"] as const) {
    const d = b[ax] - a[ax];
    if (Math.abs(d) < 1e-9) {
      if (a[ax] < p.min[ax] || a[ax] > p.max[ax]) return false;
    } else {
      let t1 = (p.min[ax] - a[ax]) / d;
      let t2 = (p.max[ax] - a[ax]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/** Garis pandang mulut -> anchor jelas (tidak menembus platform)? */
export function hasLineOfSight(platforms: PlatformDef[], a: Vec3, b: Vec3): boolean {
  for (const p of platforms) {
    if (segmentHitsBox(a, b, p)) return false;
  }
  return true;
}

/** Tembak lidah ke arah aimDir (ternormalisasi). False bila tidak ada
 * anchor dalam jangkauan + kerucut bidik + garis pandang jelas. */
export function tryFire(state: FrogGameState, aimDir: Vec3): boolean {
  const t = state.tongue;
  if (t.mode !== "idle") return false;
  const mouth = mouthPos(state.frog);
  let best: { id: string; pos: Vec3; angle: number } | null = null;
  for (const a of state.level.anchors) {
    const d = sub(a.pos, mouth);
    const dist = len(d);
    if (dist > TONGUE_RANGE || dist < 0.5) continue;
    const cos = (d.x * aimDir.x + d.y * aimDir.y + d.z * aimDir.z) / dist;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle > TONGUE_AIM_CONE) continue;
    if (!hasLineOfSight(state.level.platforms, mouth, a.pos)) continue;
    if (!best || angle < best.angle) best = { id: a.id, pos: { ...a.pos }, angle };
  }
  if (!best) return false;
  t.mode = "flying";
  t.anchorId = best.id;
  t.anchor = best.pos;
  t.length = len(sub(best.pos, mouth));
  t.flyTime = TONGUE_FLY_TIME;
  return true;
}

/** Lepas lidah (tombol lagi / lompat / timeout). */
export function releaseTongue(state: FrogGameState): boolean {
  const t = state.tongue;
  if (t.mode === "idle") return false;
  t.mode = "idle";
  t.anchorId = null;
  t.anchor = null;
  t.length = 0;
  t.restLength = 0;
  t.timeLeft = 0;
  t.flyTime = 0;
  return true;
}

function stepTongue(state: FrogGameState, dt: number, events: FrogSimEvent[]): void {
  const t = state.tongue;
  const f = state.frog;
  if (t.mode === "flying") {
    t.flyTime -= dt;
    if (t.flyTime <= 0 && t.anchor) {
      t.mode = "attached";
      const d = len(sub(t.anchor, mouthPos(f)));
      t.length = d;
      t.restLength = d * 0.75;
      t.timeLeft = TONGUE_TIMEOUT;
      events.push({ type: "tongue-attach", anchorId: t.anchorId! });
    }
    return;
  }
  if (t.mode !== "attached" || !t.anchor) return;
  t.timeLeft -= dt;
  if (t.timeLeft <= 0) {
    releaseTongue(state);
    events.push({ type: "tongue-release" });
    return;
  }
  // Pegas tali: hanya menarik saat tegang (tali tidak bisa mendorong).
  const c = { x: f.pos.x, y: f.pos.y + 0.5, z: f.pos.z };
  const d = sub(t.anchor, c);
  const dist = len(d);
  t.length = dist;
  if (dist < 0.01) return;
  const dir = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
  const stretch = Math.max(0, dist - t.restLength);
  const vRad = f.vel.x * dir.x + f.vel.y * dir.y + f.vel.z * dir.z;
  const pull = SPRING_K * stretch - SPRING_DAMP * vRad;
  f.vel.x += dir.x * pull * dt;
  f.vel.y += dir.y * pull * dt;
  f.vel.z += dir.z * pull * dt;
}

/** Satu tick simulasi (dt tetap 1/60 dtk). Kembalikan event frame ini. */
export function stepFrog(
  state: FrogGameState,
  input: FrogInput,
  dt: number = TICK_DT,
): FrogSimEvent[] {
  const events: FrogSimEvent[] = [];
  if (state.won) return events;
  state.time += dt;
  const f = state.frog;
  const wasGround = f.onGround;
  const fallSpeed = -f.vel.y;
  f.prevPos = { ...f.pos };

  // Lompat: dari tanah, atau lepas dari ayunan (lompat di udara).
  if (input.jump) {
    if (state.tongue.mode !== "idle") {
      releaseTongue(state);
      events.push({ type: "tongue-release" });
      f.vel.y = JUMP_VEL;
      f.onGround = false;
      events.push({ type: "jump" });
    } else if (f.onGround) {
      f.vel.y = JUMP_VEL;
      f.onGround = false;
      events.push({ type: "jump" });
    }
  }

  // Gerak horizontal: akselerasi ke arah input, friksi saat diam di tanah.
  let wx = input.moveX;
  let wz = input.moveZ;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
  }
  const accel = f.onGround ? GROUND_ACCEL : AIR_ACCEL;
  f.vel.x += wx * accel * dt;
  f.vel.z += wz * accel * dt;
  if (wl < 0.1 && f.onGround) {
    const sp = Math.hypot(f.vel.x, f.vel.z);
    const dec = GROUND_FRICTION * dt;
    if (sp <= dec) {
      f.vel.x = 0;
      f.vel.z = 0;
    } else {
      f.vel.x *= (sp - dec) / sp;
      f.vel.z *= (sp - dec) / sp;
    }
  }
  const maxSp = state.tongue.mode === "attached" ? SWING_MAX_SPEED : MOVE_SPEED;
  const hSp = Math.hypot(f.vel.x, f.vel.z);
  if (hSp > maxSp) {
    f.vel.x *= maxSp / hSp;
    f.vel.z *= maxSp / hSp;
  }
  if (wl > 0.1) f.facing = Math.atan2(wx, wz);

  stepTongue(state, dt, events);

  // Gravitasi + integrasi per sumbu dengan tabrakan AABB.
  f.vel.y -= GRAVITY * dt;
  const plats = state.level.platforms;
  f.pos.x += f.vel.x * dt;
  for (const p of plats) {
    if (!overlaps(f, p)) continue;
    f.pos.x = f.vel.x > 0 ? p.min.x - HALF_X : p.max.x + HALF_X;
    f.vel.x = 0;
  }
  f.pos.z += f.vel.z * dt;
  for (const p of plats) {
    if (!overlaps(f, p)) continue;
    f.pos.z = f.vel.z > 0 ? p.min.z - HALF_Z : p.max.z + HALF_Z;
    f.vel.z = 0;
  }
  f.onGround = false;
  f.pos.y += f.vel.y * dt;
  for (const p of plats) {
    if (!overlaps(f, p)) continue;
    if (f.vel.y <= 0) {
      f.pos.y = p.max.y;
      f.vel.y = 0;
      f.onGround = true;
    } else {
      f.pos.y = p.min.y - HEIGHT;
      f.vel.y = 0;
    }
  }
  if (!wasGround && f.onGround && fallSpeed > 2) events.push({ type: "land" });

  // Batas arena: tahan di dalam (dinding bengkel).
  const b = state.level.bounds;
  if (f.pos.x < b.minX) {
    f.pos.x = b.minX;
    f.vel.x = 0;
  } else if (f.pos.x > b.maxX) {
    f.pos.x = b.maxX;
    f.vel.x = 0;
  }
  if (f.pos.z < b.minZ) {
    f.pos.z = b.minZ;
    f.vel.z = 0;
  } else if (f.pos.z > b.maxZ) {
    f.pos.z = b.maxZ;
    f.vel.z = 0;
  }

  // Checkpoint: posisi terakhir saat berpijak di tanah.
  if (f.onGround) f.checkpoint = { ...f.pos };

  // Jatuh keluar arena: respawn di checkpoint.
  if (f.pos.y < b.killY) {
    f.pos = { ...f.checkpoint };
    f.prevPos = { ...f.checkpoint };
    f.vel = { x: 0, y: 0, z: 0 };
    releaseTongue(state);
    events.push({ type: "respawn" });
  }

  // Lalat: makan saat cukup dekat.
  const c = { x: f.pos.x, y: f.pos.y + 0.5, z: f.pos.z };
  for (const fly of state.level.flies) {
    if (state.fliesGot.includes(fly.id)) continue;
    if (len(sub(fly.pos, c)) < 1.3) {
      state.fliesGot.push(fly.id);
      events.push({ type: "fly", flyId: fly.id });
    }
  }

  // Goal: dekat portal dan di ketinggian yang sama.
  const g = state.level.goal;
  if (
    Math.hypot(f.pos.x - g.pos.x, f.pos.z - g.pos.z) < g.radius &&
    Math.abs(f.pos.y - g.pos.y) < 2
  ) {
    state.won = true;
    events.push({ type: "win" });
  }

  return events;
}
