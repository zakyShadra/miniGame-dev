// Simulasi katak murni (tanpa Three.js): gerak platformer, lompat,
// tabrakan AABB, lidah pegas, lalat, goal, respawn. Deterministik,
// fixed timestep 60 Hz. Inti step digeneralisasi untuk 1-2 katak:
// solo (F1) memakai wrapper stepFrog, co-op (F2) memakai stepCoop
// dengan puzzle tombol-pintu dan lidah ke katak pasangan.

import { getLevel } from "./levels";
import type {
  CoopSimEvent,
  FrogCoopState,
  FrogGameState,
  FrogInput,
  FrogSimEvent,
  FrogState,
  LevelDef,
  MoverDef,
  PlatformDef,
  TongueState,
  Vec3,
} from "./types";

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
export const GRAVITY = 22;
export const JUMP_VEL = 9;
/** Gerak dasar merangkak (F6.7, Froggin): 4 m/s, dari 6 m/s.
 * Lompatan tetap mencapai platform yang ada: jarak lompat datar maks
 * ~3.3 m, celah lompatan terlebar antar platform (buku terbang atap
 * ke b4, 3 m) masih bisa dilewati. */
export const MOVE_SPEED = 4;
export const GROUND_ACCEL = 40;
export const AIR_ACCEL = 18;
/** Friksi tanah RENDAH (F6.7): katak "terpeleset" saat berhenti
 * mendadak, meluncur ~0.6 m dari kecepatan penuh sebelum berhenti
 * (dari 30, berhenti hampir seketika). */
export const GROUND_FRICTION = 14;
/** Kecepatan horizontal maks saat berayun (pegas boleh melampaui 4). */
export const SWING_MAX_SPEED = 11;
export const TONGUE_RANGE = 12;
export const TONGUE_TIMEOUT = 5;
export const TONGUE_FLY_TIME = 0.12;
/** Toleransi bidik: anchor kena bila sinar kamera lewat dalam 1.5 m
 * darinya. (Cone dari mulut tidak cocok: paralaks kamera vs mulut
 * mencapai 0.64 rad, melebihi cone.) */
export const TONGUE_RAY_RADIUS = 1.5;
export const SPRING_K = 30;
export const SPRING_DAMP = 2.5;
/** Lidah ke pasangan menggulung tali (m/detik) sampai panjang minimum. */
export const TONGUE_REEL_SPEED = 4;
export const TONGUE_MIN_REST = 1.5;
/** Lontaran vertikal jamur lompat (m/s): apex ~3.27 m. */
export const MUSHROOM_BOUNCE = 12;
/** Ciuman lidah (F6.8): dua ujung lidah bertemu dalam jarak ini (m). */
export const KISS_TIP_DIST = 1.0;
/** Ciuman lidah (F6.8): kedua katak saling jilat + pusat badan
 * sedekat ini (m). Lidah ke pasangan menggulung sampai 1.5 m, jadi
 * 2.5 m memberi ruang sebelum katak bertabrakan. */
export const KISS_FROG_DIST = 2.5;
/** Jeda minimum antar ciuman (detik). */
export const KISS_COOLDOWN = 3;
/** Pintu tarik (F6.3): kecepatan geser saat 2 lidah menempel
 * (progres/detik, terbuka penuh ~2.9 detik). 1 lidah tidak menggeser. */
export const PULL_RATE = 0.35;
/** Pintu tarik (F6.3): kecepatan kembali menggeser saat < 2 lidah
 * menempel (progres/detik, "It goes back"). */
export const PULL_DECAY = 0.2;
/** Jilat iseng (F6.15): lidah "jilat saja" lepas sendiri setelah
 * ini (detik), tanpa menarik pasangan. */
export const LICK_TIME = 0.6;
/** Setengah lebar badan katak + tinggi badan (meter). */
const HALF_X = 0.4;
const HALF_Z = 0.4;
const HEIGHT = 0.7;

function freshFrog(spawn: Vec3): FrogState {
  return {
    pos: { ...spawn },
    vel: { x: 0, y: 0, z: 0 },
    prevPos: { ...spawn },
    onGround: false,
    facing: Math.PI,
    checkpoint: { ...spawn },
  };
}

function freshTongue(): TongueState {
  return {
    mode: "idle",
    anchorId: null,
    anchor: null,
    anchorFrog: null,
    lick: false,
    length: 0,
    restLength: 0,
    timeLeft: 0,
    flyTime: 0,
  };
}

export function createFrogGame(level: LevelDef = getLevel("bengkel")): FrogGameState {
  return {
    level,
    frog: freshFrog(level.spawn),
    tongue: freshTongue(),
    fliesGot: [],
    ringsHit: [],
    orbsGot: [],
    coinsGot: [],
    pullProgress: {},
    doorOpen: false,
    buttonDown: false,
    pressedButtons: [],
    won: false,
    time: 0,
  };
}

export function createCoopGame(
  level: LevelDef = getLevel("workshop-coop"),
): FrogCoopState {
  return {
    level,
    frogs: [freshFrog(level.spawn), freshFrog(level.spawn2 ?? level.spawn)],
    tongues: [freshTongue(), freshTongue()],
    fliesGot: [],
    ringsHit: [],
    orbsGot: [],
    coinsGot: [],
    pullProgress: {},
    usedAnchors: [],
    buttonDown: false,
    doorOpen: false,
    atGoal: [false, false],
    won: false,
    time: 0,
    lastKissAt: -99,
  };
}

/** Posisi mulut katak (pangkal lidah). */
export function mouthPos(f: { pos: Vec3 }): Vec3 {
  return { x: f.pos.x, y: f.pos.y + 0.62, z: f.pos.z };
}

/** Pusat badan katak (target lidah pasangan + jarak makan lalat). */
function centerPos(f: { pos: Vec3 }): Vec3 {
  return { x: f.pos.x, y: f.pos.y + 0.5, z: f.pos.z };
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

/** Sinar origin + dir (dir ternormalisasi) memotong AABB? Kembalikan
 * jarak t ke titik masuk terdekat, atau null bila tidak kena / origin
 * di dalam kotak (tidak ada permukaan di depan sinar). Slab test,
 * t >= 0. Dipakai F6.1 (lidah nempel dinding). */
function rayHitsBox(origin: Vec3, dir: Vec3, p: PlatformDef): number | null {
  let tmin = 0;
  let tmax = Infinity;
  for (const ax of ["x", "y", "z"] as const) {
    const d = dir[ax];
    if (Math.abs(d) < 1e-9) {
      if (origin[ax] < p.min[ax] || origin[ax] > p.max[ax]) return null;
    } else {
      let t1 = (p.min[ax] - origin[ax]) / d;
      let t2 = (p.max[ax] - origin[ax]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  // tmin 0 = origin di dalam / tepat di permukaan kotak.
  if (tmin <= 0) return null;
  return tmin;
}

/** Platform aktif: pintu hilang dari tabrakan saat terbuka. */
function activePlatforms(level: LevelDef, doorOpen: boolean): PlatformDef[] {
  if (!doorOpen || !level.door) return level.platforms;
  return level.platforms.filter((p) => p.id !== level.door!.platformId);
}

/** Offset platform bergerak di waktu t (sinus bolak-balik). */
export function moverOffset(m: MoverDef, t: number): number {
  return m.amplitude * Math.sin((2 * Math.PI * t) / m.period + (m.phase ?? 0));
}

/** Geser pintu tarik di progres p (meter, searah sumbu definisinya). */
function pullShift(
  def: { axis: "x" | "z"; slide: number },
  progress: number,
): { dx: number; dz: number } {
  const o = def.slide * progress;
  return { dx: def.axis === "x" ? o : 0, dz: def.axis === "z" ? o : 0 };
}

/** Posisi gagang pintu tarik saat ini (ikut bergeser dengan pintu). */
export function pullTargetPos(
  def: { axis: "x" | "z"; slide: number; target: Vec3 },
  progress: number,
): Vec3 {
  const { dx, dz } = pullShift(def, progress);
  return { x: def.target.x + dx, y: def.target.y, z: def.target.z + dz };
}

/** Platform di waktu t: posisi penggerak diterapkan + pintu difilter
 * bila terbuka + platform tersembunyi difilter bila cincinnya belum
 * kena lidah (F6.2) + pintu tarik digeser sesuai progresnya (F6.3).
 * Dipakai sim (tabrakan) dan scene (render). */
export function platformsAt(
  level: LevelDef,
  t: number,
  doorOpen: boolean,
  ringsHit: string[] = [],
  pullProgress: Record<string, number> = {},
): PlatformDef[] {
  const movers = new Map((level.movers ?? []).map((m) => [m.platformId, m]));
  const pulls = new Map((level.pullDoors ?? []).map((d) => [d.platformId, d]));
  return activePlatforms(level, doorOpen)
    .filter((p) => !p.hiddenUntil || ringsHit.includes(p.hiddenUntil))
    .map((p) => {
      const m = movers.get(p.id);
      const pd = pulls.get(p.id);
      const mo = m ? moverOffset(m, t) : 0;
      const dx = (m?.axis === "x" ? mo : 0) + (pd ? pullShift(pd, pullProgress[pd.id] ?? 0).dx : 0);
      const dz = (m?.axis === "z" ? mo : 0) + (pd ? pullShift(pd, pullProgress[pd.id] ?? 0).dz : 0);
      if (dx === 0 && dz === 0) return p;
      return {
        id: p.id,
        min: { x: p.min.x + dx, y: p.min.y, z: p.min.z + dz },
        max: { x: p.max.x + dx, y: p.max.y, z: p.max.z + dz },
      };
    });
}

/** Id tombol yang sedang tertekan (ada katak berdiri di atasnya). */
export function pressedButtons(level: LevelDef, frogs: FrogState[]): string[] {
  const out: string[] = [];
  for (const b of level.buttons ?? []) {
    for (const f of frogs) {
      if (
        f.onGround &&
        Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z) < b.radius &&
        Math.abs(f.pos.y - b.pos.y) < 1.5
      ) {
        out.push(b.id);
        break;
      }
    }
  }
  return out;
}

/** Tembak lidah katak ke-i sepanjang sinar bidik (origin + aimDir,
 * keduanya dari kamera). Target: anchor level (kecuali yang sekali
 * pakai dan sedang habis), lalat yang belum dimakan (F6.4: lalat
 * hanya bisa dimakan dengan lidah), cincin emas yang belum aktif
 * (F6.2), orb hijau + koin emas yang belum diambil (F6.11), gagang
 * pintu tarik yang belum terbuka penuh (F6.3), katak pasangan
 * (co-op), atau permukaan platform/dinding padat pertama yang
 * dipotong sinar (F6.1, fallback bila tidak ada target titik yang
 * kena). Target kena bila: dalam jangkauan lidah dari mulut,
 * sinar lewat dalam TONGUE_RAY_RADIUS darinya, dan garis pandang
 * mulut ke target jelas. False bila tidak ada target yang kena. */
export function tryFireFrog(
  level: LevelDef,
  frogs: FrogState[],
  tongues: TongueState[],
  usedAnchors: string[],
  fliesGot: string[],
  ringsHit: string[],
  orbsGot: string[],
  coinsGot: string[],
  i: number,
  origin: Vec3,
  aimDir: Vec3,
  pullProgress: Record<string, number> = {},
  /** Mode jilat saja (F6.15): bila targetnya katak pasangan, lidah
   * hanya menjilat (tanpa tarik). Target lain tidak terpengaruh. */
  lickOnly = false,
): boolean {
  const t = tongues[i]!;
  if (t.mode !== "idle") return false;
  const mouth = mouthPos(frogs[i]!);
  // Garis pandang memakai posisi pintu tarik saat ini (bukan def
  // statis): pintu yang sudah bergeser tidak lagi menghalangi.
  const plats = activePlatforms(level, false).map((p) => {
    const pd = (level.pullDoors ?? []).find((d) => d.platformId === p.id);
    if (!pd) return p;
    const { dx, dz } = pullShift(pd, pullProgress[pd.id] ?? 0);
    return {
      id: p.id,
      min: { x: p.min.x + dx, y: p.min.y, z: p.min.z + dz },
      max: { x: p.max.x + dx, y: p.max.y, z: p.max.z + dz },
    };
  });
  type Candidate = { id: string; pos: Vec3; rayDist: number; frog: 0 | 1 | null };
  let best: Candidate | null = null;
  // Kandidat bila kena bidik, atau null (assignment best di badan loop,
  // bukan di closure, supaya TS melacak tipenya).
  const consider = (id: string, pos: Vec3, frog: 0 | 1 | null): Candidate | null => {
    const md = sub(pos, mouth);
    const mouthDist = len(md);
    if (mouthDist > TONGUE_RANGE || mouthDist < 0.5) return null;
    const od = sub(pos, origin);
    const along = od.x * aimDir.x + od.y * aimDir.y + od.z * aimDir.z;
    if (along < 0) return null;
    const cx = origin.x + aimDir.x * along;
    const cy = origin.y + aimDir.y * along;
    const cz = origin.z + aimDir.z * along;
    const rayDist = Math.hypot(pos.x - cx, pos.y - cy, pos.z - cz);
    if (rayDist > TONGUE_RAY_RADIUS) return null;
    if (!hasLineOfSight(plats, mouth, pos)) return null;
    return { id, pos: { ...pos }, rayDist, frog };
  };
  for (const a of level.anchors) {
    if (a.oneUse && usedAnchors.includes(a.id)) continue;
    const c = consider(a.id, a.pos, null);
    if (c && (!best || c.rayDist < best.rayDist)) best = c;
  }
  // Lalat yang belum dimakan adalah target lidah (F6.4).
  for (const f of level.flies) {
    if (fliesGot.includes(f.id)) continue;
    const c = consider(`fly:${f.id}`, f.pos, null);
    if (c && (!best || c.rayDist < best.rayDist)) best = c;
  }
  // Cincin emas yang belum aktif adalah target lidah (F6.2).
  for (const r of level.rings ?? []) {
    if (ringsHit.includes(r.id)) continue;
    const c = consider(`ring:${r.id}`, r.pos, null);
    if (c && (!best || c.rayDist < best.rayDist)) best = c;
  }
  // Orb hijau + koin emas yang belum diambil adalah target lidah (F6.11).
  for (const o of level.orbs ?? []) {
    if (orbsGot.includes(o.id)) continue;
    const c = consider(`orb:${o.id}`, o.pos, null);
    if (c && (!best || c.rayDist < best.rayDist)) best = c;
  }
  for (const cn of level.coins ?? []) {
    if (coinsGot.includes(cn.id)) continue;
    const c = consider(`coin:${cn.id}`, cn.pos, null);
    if (c && (!best || c.rayDist < best.rayDist)) best = c;
  }
  // Gagang pintu tarik yang belum terbuka penuh adalah target lidah
  // (F6.3). Gagang ikut bergeser dengan pintu; pintu yang sudah
  // terbuka bukan target lagi.
  for (const pd of level.pullDoors ?? []) {
    if ((pullProgress[pd.id] ?? 0) >= 1) continue;
    const c = consider(`pull:${pd.id}`, pullTargetPos(pd, pullProgress[pd.id] ?? 0), null);
    if (c && (!best || c.rayDist < best.rayDist)) best = c;
  }
  // Katak pasangan adalah target lidah (tarik pasangan menyeberang).
  const j = i === 0 ? 1 : 0;
  if (frogs[j]) {
    const c = consider(`frog:${j}`, centerPos(frogs[j]!), j as 0 | 1);
    if (c && (!best || c.rayDist < best.rayDist)) best = c;
  }
  // Dinding / permukaan platform (F6.1): bila tidak ada target titik
  // yang kena bidik, lidah nempel ke permukaan platform padat pertama
  // yang dipotong sinar (sisi tegak, atas, atau bawah). Platform
  // bergerak dikecualikan: posisi def-nya statis, posisi sim-nya
  // bergeser, jadi titik tempel bisa melayang di udara. Pintu tarik
  // (F6.3) dikecualikan dengan alasan yang sama: tempel ke gagangnya,
  // bukan ke badannya. Langit/latar bukan target: sinar yang tidak
  // memotong platform apa pun gagal.
  if (!best) {
    const moverIds = new Set((level.movers ?? []).map((m) => m.platformId));
    for (const pd of level.pullDoors ?? []) moverIds.add(pd.platformId);
    let wallT = Infinity;
    let wall: { id: string; pos: Vec3 } | null = null;
    for (const p of plats) {
      if (moverIds.has(p.id)) continue;
      const t = rayHitsBox(origin, aimDir, p);
      if (t === null || t >= wallT) continue;
      const hit = {
        x: origin.x + aimDir.x * t,
        y: origin.y + aimDir.y * t,
        z: origin.z + aimDir.z * t,
      };
      const md = len(sub(hit, mouth));
      if (md > TONGUE_RANGE || md < 0.5) continue;
      // Garis pandang mulut ke titik tempel jelas (platform yang
      // ditempel sendiri dikecualikan: titiknya ada di permukaannya).
      if (!hasLineOfSight(plats.filter((q) => q.id !== p.id), mouth, hit)) continue;
      wall = { id: `wall:${p.id}`, pos: hit };
      wallT = t;
    }
    if (wall) best = { id: wall.id, pos: wall.pos, rayDist: 0, frog: null };
  }
  if (!best) return false;
  t.mode = "flying";
  t.anchorId = best.id;
  t.anchor = best.pos;
  t.anchorFrog = best.frog;
  // Jilat saja hanya berlaku ke katak pasangan (F6.15).
  t.lick = lickOnly && best.frog !== null;
  t.length = len(sub(best.pos, mouth));
  t.flyTime = TONGUE_FLY_TIME;
  return true;
}

/** Tembak lidah (solo, F1). */
export function tryFire(state: FrogGameState, origin: Vec3, aimDir: Vec3, lickOnly = false): boolean {
  return tryFireFrog(state.level, [state.frog], [state.tongue], [], state.fliesGot, state.ringsHit, state.orbsGot, state.coinsGot, 0, origin, aimDir, state.pullProgress, lickOnly);
}

/** Tembak lidah katak ke-i (co-op). */
export function tryFireCoop(
  state: FrogCoopState,
  i: 0 | 1,
  origin: Vec3,
  aimDir: Vec3,
  lickOnly = false,
): boolean {
  return tryFireFrog(
    state.level,
    state.frogs,
    state.tongues,
    state.usedAnchors,
    state.fliesGot,
    state.ringsHit,
    state.orbsGot,
    state.coinsGot,
    i,
    origin,
    aimDir,
    state.pullProgress,
    lickOnly,
  );
}

/** Lepas lidah (tombol lagi / lompat / timeout). */
export function releaseTongueState(t: TongueState): boolean {
  if (t.mode === "idle") return false;
  t.mode = "idle";
  t.anchorId = null;
  t.anchor = null;
  t.anchorFrog = null;
  t.lick = false;
  t.length = 0;
  t.restLength = 0;
  t.timeLeft = 0;
  t.flyTime = 0;
  return true;
}

/** Lepas lidah (solo, F1). */
export function releaseTongue(state: FrogGameState): boolean {
  return releaseTongueState(state.tongue);
}

/** Lepas lidah katak ke-i (co-op). */
export function releaseTongueCoop(state: FrogCoopState, i: 0 | 1): boolean {
  return releaseTongueState(state.tongues[i]);
}

function stepTongue(
  level: LevelDef,
  frogs: FrogState[],
  tongues: TongueState[],
  usedAnchors: string[],
  i: number,
  dt: number,
  events: CoopSimEvent[],
  pullProgress: Record<string, number> = {},
): void {
  const t = tongues[i]!;
  const f = frogs[i]!;
  if (t.mode === "flying") {
    t.flyTime -= dt;
    if (t.flyTime <= 0 && t.anchor) {
      t.mode = "attached";
      const d = len(sub(t.anchor, mouthPos(f)));
      t.length = d;
      // Lidah ke pasangan langsung lebih pendek (0.5x, bukan 0.75x):
      // tali harus tegang sejak awal, kalau tidak pasangan jatuh
      // meluncur ke bawah platform dan terjebak di kolongnya.
      t.restLength = d * (t.anchorFrog !== null ? 0.5 : 0.75);
      t.timeLeft = TONGUE_TIMEOUT;
      // Anchor sekali pakai habis begitu ditempeli.
      const def = level.anchors.find((a) => a.id === t.anchorId);
      if (def?.oneUse && t.anchorId && !usedAnchors.includes(t.anchorId)) {
        usedAnchors.push(t.anchorId);
      }
      // Lalat/cincin/orb/koin: tidak ada bunyi nempel, langsung
      // dimakan/diaktifkan/diambil di tick yang sama (eatTongueFlies,
      // activateRings, collectTonguePickups); bunyi + efek dari
      // eventnya masing-masing. anchorId bisa null di sim prediksi
      // co-op (snapToTongue tidak membawa id): pakai ?. supaya step
      // pred tidak crash saat lidah snapshot menempel.
      const isPickup = ["fly:", "ring:", "orb:", "coin:"].some((p) =>
        t.anchorId?.startsWith(p),
      );
      if (!isPickup && !t.lick) {
        events.push({ type: "tongue-attach", anchorId: t.anchorId ?? "", frog: i as 0 | 1 });
      }
      // Jilat saja (F6.15): lepas sendiri setelah 0.6 detik, tanpa
      // bunyi nempel; event "lick" membawa efek + bunyi jilatan.
      if (t.lick) {
        t.timeLeft = LICK_TIME;
        events.push({ type: "lick", pos: { ...t.anchor }, frog: i as 0 | 1 });
      }
    }
    return;
  }
  if (t.mode !== "attached" || !t.anchor) return;
  // Anchor katak: posisi anchor ikut katak pasangan tiap tick.
  const j = t.anchorFrog;
  if (j !== null && frogs[j]) t.anchor = centerPos(frogs[j]!);
  // Anchor pintu tarik (F6.3): gagang ikut bergeser dengan pintu.
  // Pintu berat: lidah TIDAK menarik katak (tidak ada pegas), yang
  // bergerak adalah pintunya (stepPullDoors). Timeout tetap berlaku.
  if (t.anchorId?.startsWith("pull:")) {
    const pd = (level.pullDoors ?? []).find((d) => `pull:${d.id}` === t.anchorId);
    if (pd) t.anchor = pullTargetPos(pd, pullProgress[pd.id] ?? 0);
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) {
      releaseTongueState(t);
      events.push({ type: "tongue-release", frog: i as 0 | 1 });
    }
    return;
  }
  t.timeLeft -= dt;
  if (t.timeLeft <= 0) {
    releaseTongueState(t);
    events.push({ type: "tongue-release", frog: i as 0 | 1 });
    return;
  }
  // Jilat saja (F6.15): tidak menggulung, tidak ada pegas, pasangan
  // tidak ditarik sama sekali.
  if (t.lick) return;
  // Lidah ke pasangan menggulung: kedua katak ditarik mendekat.
  if (j !== null) {
    t.restLength = Math.max(TONGUE_MIN_REST, t.restLength - TONGUE_REEL_SPEED * dt);
  }
  // Pegas tali: hanya menarik saat tegang (tali tidak bisa mendorong).
  // Tarikan di-cap supaya tidak melontarkan katak (slingshot).
  const c = centerPos(f);
  const d = sub(t.anchor, c);
  const dist = len(d);
  t.length = dist;
  if (dist < 0.01) return;
  const dir = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
  const stretch = Math.max(0, dist - t.restLength);
  const vRad = f.vel.x * dir.x + f.vel.y * dir.y + f.vel.z * dir.z;
  const pull = Math.max(-60, Math.min(60, SPRING_K * stretch - SPRING_DAMP * vRad));
  // Lidah ke pasangan: penembak menahan (cuma 25% gaya), pasangan yang
  // ditarik penuh, supaya penyelamat tidak ikut terseret ke jurang.
  const selfFactor = j !== null ? 0.25 : 1;
  f.vel.x += dir.x * pull * selfFactor * dt;
  f.vel.y += dir.y * pull * selfFactor * dt;
  f.vel.z += dir.z * pull * selfFactor * dt;
  if (j !== null && frogs[j]) {
    const o = frogs[j]!;
    o.vel.x -= dir.x * pull * dt;
    o.vel.y -= dir.y * pull * dt;
    o.vel.z -= dir.z * pull * dt;
  }
}

/** Satu tick untuk katak ke-i: gerak, lompat, lidah, tabrakan,
 * checkpoint, respawn. Lalat + goal ditangani pemanggil (shared).
 * plats = platform di waktu sekarang, prevPlats = tick lalu (buat
 * membawa katak yang berdiri di platform bergerak). */
function stepOne(
  level: LevelDef,
  frogs: FrogState[],
  tongues: TongueState[],
  usedAnchors: string[],
  i: number,
  input: FrogInput,
  plats: PlatformDef[],
  prevPlats: PlatformDef[],
  dt: number,
  events: CoopSimEvent[],
  pullProgress: Record<string, number> = {},
): void {
  const f = frogs[i]!;
  const wasGround = f.onGround;
  const fallSpeed = -f.vel.y;

  // Platform bergerak: katak yang berdiri di atasnya ikut terbawa
  // (delta posisi platform sejak tick lalu).
  if (f.onGround) {
    const support = prevPlats.find(
      (p) =>
        Math.abs(f.pos.y - p.max.y) < 0.05 &&
        f.pos.x > p.min.x - HALF_X &&
        f.pos.x < p.max.x + HALF_X &&
        f.pos.z > p.min.z - HALF_Z &&
        f.pos.z < p.max.z + HALF_Z,
    );
    if (support) {
      const cur = plats.find((p) => p.id === support.id);
      if (cur) {
        f.pos.x += cur.min.x - support.min.x;
        f.pos.y += cur.max.y - support.max.y;
        f.pos.z += cur.min.z - support.min.z;
      }
    }
  }
  f.prevPos = { ...f.pos };

  // Lompat: dari tanah, atau lepas dari ayunan (lompat di udara).
  if (input.jump) {
    if (tongues[i]!.mode !== "idle") {
      releaseTongueState(tongues[i]!);
      events.push({ type: "tongue-release", frog: i as 0 | 1 });
      f.vel.y = JUMP_VEL;
      f.onGround = false;
      events.push({ type: "jump", frog: i as 0 | 1 });
    } else if (f.onGround) {
      f.vel.y = JUMP_VEL;
      f.onGround = false;
      events.push({ type: "jump", frog: i as 0 | 1 });
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
  if (wl > 0.1) f.facing = Math.atan2(wx, wz);

  stepTongue(level, frogs, tongues, usedAnchors, i, dt, events, pullProgress);

  // Cap kecepatan horizontal SETELAH pegas (pegas tidak boleh
  // melampaui batas ayun). Katak yang sedang ditarik lidah pasangan
  // juga boleh melaju sampai batas ayun, kalau tidak ia keburu jatuh
  // ke jurang sebelum sampai seberang. Jilatan (F6.15) tidak menarik,
  // jadi tidak dihitung sebagai ditarik.
  const beingPulled = tongues.some(
    (t, k) => k !== i && t.mode === "attached" && t.anchorFrog === i && !t.lick,
  );
  const maxSp =
    tongues[i]!.mode === "attached" || beingPulled ? SWING_MAX_SPEED : MOVE_SPEED;
  const hSp = Math.hypot(f.vel.x, f.vel.z);
  if (hSp > maxSp) {
    f.vel.x *= maxSp / hSp;
    f.vel.z *= maxSp / hSp;
  }

  // Gravitasi + integrasi per sumbu dengan tabrakan AABB. Katak yang
  // digantung lidah pasangan jatuh lebih pelan (lidah menahan berat
  // badannya), kalau tidak ia keburu jatuh sebelum sampai seberang.
  f.vel.y -= (beingPulled ? GRAVITY * 0.35 : GRAVITY) * dt;
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
  if (!wasGround && f.onGround && fallSpeed > 2) {
    events.push({ type: "land", frog: i as 0 | 1 });
  }

  // Jamur lompat: katak yang berpijak di atas jamur dilontarkan ke atas.
  if (f.onGround) {
    for (const m of level.mushrooms ?? []) {
      if (
        Math.hypot(f.pos.x - m.pos.x, f.pos.z - m.pos.z) < m.radius &&
        Math.abs(f.pos.y - m.pos.y) < 0.6
      ) {
        f.vel.y = m.bounce ?? MUSHROOM_BOUNCE;
        f.onGround = false;
        events.push({ type: "bounce", mushroomId: m.id, frog: i as 0 | 1 });
        break;
      }
    }
  }

  // Batas arena: tahan di dalam (dinding bengkel).
  const b = level.bounds;
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

  // Checkpoint: posisi terakhir saat berpijak di tanah DENGAN TOPANGAN
  // (tengah katak 0.3 m di dalam tepi platform). Tanpa margin, checkpoint
  // bisa tepat di ujung dan katak jatuh lagi begitu respawn.
  // Platform bergerak TIDAK jadi checkpoint: platform sudah pindah saat
  // katak respawn, dan katak akan jatuh berulang di titik yang sama.
  if (f.onGround) {
    const moverIds = new Set((level.movers ?? []).map((m) => m.platformId));
    const supported = plats.some(
      (p) =>
        !moverIds.has(p.id) &&
        f.pos.x > p.min.x + 0.3 &&
        f.pos.x < p.max.x - 0.3 &&
        f.pos.z > p.min.z + 0.3 &&
        f.pos.z < p.max.z - 0.3 &&
        Math.abs(f.pos.y - p.max.y) < 0.01,
    );
    if (supported) f.checkpoint = { ...f.pos };
  }

  // Jatuh keluar arena: respawn di checkpoint.
  if (f.pos.y < b.killY) {
    f.pos = { ...f.checkpoint };
    f.prevPos = { ...f.checkpoint };
    f.vel = { x: 0, y: 0, z: 0 };
    releaseTongueState(tongues[i]!);
    events.push({ type: "respawn", frog: i as 0 | 1 });
  }
}

/** Lalat yang kena lidah katak ke-i dimakan (F6.4, shared, dipakai
 * solo + co-op). Lidah yang menempel ke lalat langsung dilepas di
 * tick yang sama: lalat ditarik ke mulut (efek visual di scene) dan
 * masuk fliesGot. Proximity lama (makan dengan mendekat) DIHAPUS:
 * lalat HANYA bisa dimakan dengan lidah. */
function eatTongueFlies(
  tongues: TongueState[],
  fliesGot: string[],
  i: number,
  events: CoopSimEvent[],
): void {
  const t = tongues[i]!;
  if (t.mode !== "attached" || !t.anchorId?.startsWith("fly:")) return;
  const flyId = t.anchorId.slice(4);
  releaseTongueState(t);
  // Dua katak menembak lalat yang sama di tick yang sama: yang kedua
  // tidak memicu event ganda.
  if (fliesGot.includes(flyId)) return;
  fliesGot.push(flyId);
  events.push({ type: "fly", flyId, frog: i as 0 | 1 });
}

/** Cincin emas yang kena lidah katak ke-i diaktifkan (F6.2, shared,
 * dipakai solo + co-op). Lidah yang menempel ke cincin langsung
 * dilepas di tick yang sama: cincin masuk ringsHit (platform
 * tersembunyi yang terikat muncul mulai tick berikutnya) + event
 * "ring" (bunyi + sparkle biru di scene). */
function activateRings(
  tongues: TongueState[],
  ringsHit: string[],
  i: number,
  events: CoopSimEvent[],
): void {
  const t = tongues[i]!;
  if (t.mode !== "attached" || !t.anchorId?.startsWith("ring:")) return;
  const ringId = t.anchorId.slice(5);
  releaseTongueState(t);
  // Dua katak menembak cincin yang sama di tick yang sama: yang kedua
  // tidak memicu event ganda.
  if (ringsHit.includes(ringId)) return;
  ringsHit.push(ringId);
  events.push({ type: "ring", ringId, frog: i as 0 | 1 });
}

/** Orb hijau / koin emas yang kena lidah katak ke-i diambil (F6.11,
 * shared, dipakai solo + co-op). Pola sama seperti lalat (F6.4):
 * lidah yang menempel ke orb/koin langsung dilepas di tick yang
 * sama, item masuk orbsGot/coinsGot + event "orb"/"coin" (bunyi +
 * sparkle di scene). */
function collectTonguePickups(
  tongues: TongueState[],
  orbsGot: string[],
  coinsGot: string[],
  i: number,
  events: CoopSimEvent[],
): void {
  const t = tongues[i]!;
  if (t.mode !== "attached" || !t.anchorId) return;
  const isOrb = t.anchorId.startsWith("orb:");
  const isCoin = t.anchorId.startsWith("coin:");
  if (!isOrb && !isCoin) return;
  const id = t.anchorId.slice(isOrb ? 4 : 5);
  const got = isOrb ? orbsGot : coinsGot;
  releaseTongueState(t);
  // Dua katak menembak item yang sama di tick yang sama: yang kedua
  // tidak memicu event ganda.
  if (got.includes(id)) return;
  got.push(id);
  if (isOrb) events.push({ type: "orb", orbId: id, frog: i as 0 | 1 });
  else events.push({ type: "coin", coinId: id, frog: i as 0 | 1 });
}

/** Pintu tarik (F6.3): geser maju hanya bila >= 2 lidah menempel
 * ke gagangnya di tick ini (butuh 2 katak, seperti di Froggin);
 * bila kurang, pintu kembali menggeser (PULL_DECAY). Terbuka penuh
 * (progres 1) = latch permanen + event "pulldoor" sekali. */
function stepPullDoors(
  level: LevelDef,
  tongues: TongueState[],
  pullProgress: Record<string, number>,
  dt: number,
  events: CoopSimEvent[],
): void {
  for (const pd of level.pullDoors ?? []) {
    const cur = pullProgress[pd.id] ?? 0;
    if (cur >= 1) continue;
    const attached = tongues.filter(
      (t) => t.mode === "attached" && t.anchorId === `pull:${pd.id}`,
    ).length;
    if (attached >= 2) {
      const next = Math.min(1, cur + PULL_RATE * dt);
      pullProgress[pd.id] = next;
      if (next >= 1) events.push({ type: "pulldoor", doorId: pd.id, frog: 0 });
    } else if (cur > 0) {
      pullProgress[pd.id] = Math.max(0, cur - PULL_DECAY * dt);
    }
  }
}

/** Ujung lidah katak ke-i saat ini: anchor bila menempel, titik di
 * antara mulut dan anchor bila masih terbang (F6.8). Null bila lidah
 * idle. */
function tongueTip(frogs: FrogState[], tongues: TongueState[], i: number): Vec3 | null {
  const t = tongues[i]!;
  if (t.mode === "idle" || !t.anchor) return null;
  if (t.mode === "attached") return { ...t.anchor };
  const p = Math.max(0, Math.min(1, 1 - t.flyTime / TONGUE_FLY_TIME));
  const m = mouthPos(frogs[i]!);
  return {
    x: m.x + (t.anchor.x - m.x) * p,
    y: m.y + (t.anchor.y - m.y) * p,
    z: m.z + (t.anchor.z - m.z) * p,
  };
}

/** Ciuman lidah (F6.8, co-op): dua ujung lidah bertemu (dalam
 * KISS_TIP_DIST), ATAU kedua katak saling jilat (lidah masing-masing
 * nempel ke pasangannya) dan sudah dekat. Dua lidah yang nempel ke
 * target yang SAMA (anchor/lalat/cincin yang sama) bukan ciuman:
 * ujungnya memang di titik yang sama. Cooldown 3 detik. Event "kiss"
 * diteruskan server ke kedua pemain lewat snapshot. */
function checkKiss(state: FrogCoopState, events: CoopSimEvent[]): void {
  if (state.time - state.lastKissAt < KISS_COOLDOWN) return;
  const tip0 = tongueTip(state.frogs, state.tongues, 0);
  const tip1 = tongueTip(state.frogs, state.tongues, 1);
  if (!tip0 || !tip1) return;
  const t0 = state.tongues[0]!;
  const t1 = state.tongues[1]!;
  // Dua lidah menuju/menempel target yang SAMA (anchor/lalat/cincin/
  // katak yang sama) bukan ciuman: ujungnya memang bertemu di titik
  // yang sama. Berlaku saat terbang maupun menempel (ujung-ujung
  // sudah berdekatan sebelum keduanya menempel).
  if (t0.anchorId !== null && t0.anchorId === t1.anchorId) return;
  const tipsClose = len(sub(tip0, tip1)) < KISS_TIP_DIST;
  const mutual = t0.anchorFrog === 1 && t1.anchorFrog === 0;
  const frogsClose =
    len(sub(centerPos(state.frogs[0]!), centerPos(state.frogs[1]!))) < KISS_FROG_DIST;
  if (!tipsClose && !(mutual && frogsClose)) return;
  state.lastKissAt = state.time;
  events.push({
    type: "kiss",
    pos: {
      x: (tip0.x + tip1.x) / 2,
      y: (tip0.y + tip1.y) / 2,
      z: (tip0.z + tip1.z) / 2,
    },
    frog: 0,
  });
}

function atGoalPos(level: LevelDef, f: FrogState): boolean {
  const g = level.goal;
  return (
    Math.hypot(f.pos.x - g.pos.x, f.pos.z - g.pos.z) < g.radius &&
    Math.abs(f.pos.y - g.pos.y) < 2
  );
}

/** Satu tick simulasi solo (dt tetap 1/60 dtk). */
export function stepFrog(
  state: FrogGameState,
  input: FrogInput,
  dt: number = TICK_DT,
): FrogSimEvent[] {
  if (state.won) return [];
  state.time += dt;
  const events: CoopSimEvent[] = [];
  // Tombol (solo): sekali ditekan, pintu terbuka permanen (latch),
  // supaya puzzle tombol-pintu bisa diselesaikan 1 katak.
  state.pressedButtons = pressedButtons(state.level, [state.frog]);
  state.buttonDown = state.pressedButtons.length > 0;
  if (state.buttonDown) state.doorOpen = true;
  const plats = platformsAt(state.level, state.time, state.doorOpen, state.ringsHit, state.pullProgress);
  const prevPlats = platformsAt(state.level, state.time - dt, state.doorOpen, state.ringsHit, state.pullProgress);
  stepOne(
    state.level,
    [state.frog],
    [state.tongue],
    [],
    0,
    input,
    plats,
    prevPlats,
    dt,
    events,
    state.pullProgress,
  );
  stepPullDoors(state.level, [state.tongue], state.pullProgress, dt, events);
  eatTongueFlies([state.tongue], state.fliesGot, 0, events);
  activateRings([state.tongue], state.ringsHit, 0, events);
  collectTonguePickups([state.tongue], state.orbsGot, state.coinsGot, 0, events);
  if (atGoalPos(state.level, state.frog)) {
    state.won = true;
    events.push({ type: "win", frog: 0 });
  }
  // Solo tidak butuh indeks katak: kupas lagi jadi event F1.
  return events.map(({ frog: _frog, ...e }) => e);
}

/** Satu tick simulasi co-op (dt tetap 1/60 dtk). */
export function stepCoop(
  state: FrogCoopState,
  inputs: [FrogInput, FrogInput],
  dt: number = TICK_DT,
): CoopSimEvent[] {
  const events: CoopSimEvent[] = [];
  if (state.won) return events;
  state.time += dt;

  // Tombol: tertekan bila ada katak berdiri di atasnya. Pintu terbuka
  // selama ada tombol yang tertekan (dari kedua sisi).
  const level = state.level;
  const pressed = pressedButtons(level, state.frogs).length > 0;
  state.buttonDown = pressed;
  state.doorOpen = !!level.door && pressed;

  const plats = platformsAt(level, state.time, state.doorOpen, state.ringsHit, state.pullProgress);
  const prevPlats = platformsAt(level, state.time - dt, state.doorOpen, state.ringsHit, state.pullProgress);
  stepOne(level, state.frogs, state.tongues, state.usedAnchors, 0, inputs[0], plats, prevPlats, dt, events, state.pullProgress);
  stepOne(level, state.frogs, state.tongues, state.usedAnchors, 1, inputs[1], plats, prevPlats, dt, events, state.pullProgress);
  stepPullDoors(level, state.tongues, state.pullProgress, dt, events);

  // Lidah yang nempel ke katak yang baru respawn ikut lepas (anchor
  // melompat ke checkpoint, tarikan pegas akan menyentak).
  for (const ev of events) {
    if (ev.type !== "respawn") continue;
    const j = ev.frog;
    const other = (j === 0 ? 1 : 0) as 0 | 1;
    if (state.tongues[other].anchorFrog === j) {
      releaseTongueState(state.tongues[other]);
      events.push({ type: "tongue-release", frog: other });
    }
  }

  // Anchor sekali pakai pulih bila SEMUA katak kembali ke sisi spawn
  // (z lebih besar dari anchor) DAN tidak ada lidah yang sedang
  // menempel ke anchor itu: yang mengayun jatuh sebelum sampai
  // seberang tidak membuat level deadlock.
  if (state.usedAnchors.length > 0) {
    state.usedAnchors = state.usedAnchors.filter((id) => {
      const a = level.anchors.find((x) => x.id === id);
      if (!a) return false;
      const inUse = state.tongues.some(
        (t) => t.anchorId === id && t.mode !== "idle",
      );
      if (inUse) return true;
      return !state.frogs.every((f) => f.pos.z > a.pos.z);
    });
  }

  eatTongueFlies(state.tongues, state.fliesGot, 0, events);
  eatTongueFlies(state.tongues, state.fliesGot, 1, events);
  activateRings(state.tongues, state.ringsHit, 0, events);
  activateRings(state.tongues, state.ringsHit, 1, events);
  collectTonguePickups(state.tongues, state.orbsGot, state.coinsGot, 0, events);
  collectTonguePickups(state.tongues, state.orbsGot, state.coinsGot, 1, events);

  // Ciuman lidah (F6.8): dicek SETELAH lidah lalat/cincin/orb/koin
  // dilepas, supaya lidah yang baru saja makan/aktivasi/mengambil
  // tidak ikut dihitung.
  checkKiss(state, events);

  // Goal per katak (menempel); menang saat keduanya sudah sampai.
  let justArrived: 0 | 1 = 0;
  for (const i of [0, 1] as const) {
    if (!state.atGoal[i] && atGoalPos(level, state.frogs[i])) {
      state.atGoal[i] = true;
      justArrived = i;
    }
  }
  if (state.atGoal[0] && state.atGoal[1]) {
    state.won = true;
    events.push({ type: "win", frog: justArrived });
  }

  return events;
}
