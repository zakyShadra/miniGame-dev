// Orkestrasi game naval solo (N1): loop fixed-timestep 20 Hz, input
// keyboard/mouse, dummy latihan yang berlayar melingkar. Combat (tembak)
// menyusul di N2; di sini turet hanya mengikuti titik aim mouse.

import { MAP_OPEN_BAY } from "./maps";
import { NavalScene } from "./scene";
import { getShipDef } from "./ships";
import {
  TICK_DT,
  createGame,
  fireVolley,
  getShip,
  hasLineOfSight,
  stepGame,
  useAbility,
} from "./sim";
import type { GameState, ShipId, ShipInput, SimEvent } from "./types";

export interface NavalHud {
  speed: number;
  maxSpeed: number;
  headingDeg: number;
  hp: number;
  maxHp: number;
  dummyHp: number;
  dummyMaxHp: number;
  dummyVisible: boolean;
  /** Posisi buat minimap (meter, koordinat arena). */
  px: number;
  pz: number;
  dx: number;
  dz: number;
  /** Jarak ke musuh (meter). */
  distance: number;
  /** Sisa waktu match (detik). */
  timeLeft: number;
  /** 0..1, 1 = meriam siap tembak. */
  reloadFrac: number;
  /** Sisa reload (detik), 0 bila siap. */
  reloadLeft: number;
  /** 0..1, 1 = kemampuan siap. */
  abilityFrac: number;
  /** Sisa cooldown kemampuan (detik), 0 bila siap. */
  abilityLeft: number;
  abilityName: string;
  shipName: string;
  dummyName: string;
  /** Jarak ke titik aim (m), -1 bila mouse belum pernah bergerak. */
  aimDist: number;
  /** Waktu terbang peluru ke titik aim (detik), -1 bila di luar jangkauan. */
  aimLead: number;
  /** Garis bidik ke titik aim terhalang pulau. */
  aimBlocked: boolean;
  /** Titik aim di luar jangkauan meriam (v^2/g). */
  aimOutOfRange: boolean;
}

export type NavalWinner = "player" | "dummy" | "draw";

export interface DamageNumber {
  x: number;
  y: number;
  amount: number;
}

export interface NavalGameOptions {
  shipId: ShipId;
  onHud: (hud: NavalHud) => void;
  onMatchEnd: (winner: NavalWinner) => void;
  onDamage: (d: DamageNumber) => void;
  onPlayerHit: () => void;
}

const PLAYER_ID = "player";
const DUMMY_ID = "dummy";
/** Durasi match (detik). Habis waktu = HP tertinggi menang. */
export const MATCH_DURATION = 300;

/** Dummy latihan: throttle + rudder konstan (melingkar pelan). Bukan AI. */
const DUMMY_INPUT: ShipInput = { throttle: 0.45, rudder: 0.18 };

export class NavalGame {
  readonly state: GameState;
  readonly scene: NavalScene;
  private container: HTMLElement;
  private opts: NavalGameOptions;
  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private hudT = 0;
  private keys = new Set<string>();
  private orbiting = false;
  private lastOrbitX = 0;
  private disposed = false;
  private over = false;

  constructor(container: HTMLElement, opts: NavalGameOptions) {
    this.container = container;
    this.opts = opts;
    this.state = createGame(MAP_OPEN_BAY, [
      { id: PLAYER_ID, defId: opts.shipId, spawn: "A" },
      { id: DUMMY_ID, defId: "galleon", spawn: "B" },
    ]);
    this.scene = new NavalScene(container, MAP_OPEN_BAY);
    this.scene.addShip(PLAYER_ID, getShipDef(opts.shipId));
    this.scene.addShip(DUMMY_ID, getShipDef("galleon"), { enemy: true });
    this.scene.followId = PLAYER_ID;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    container.addEventListener("mousemove", this.onMouseMove);
    container.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onOrbitMove);
    window.addEventListener("mouseup", this.onMouseUp);
    container.addEventListener("wheel", this.onWheel, { passive: true });
    container.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.onResize);

    // Hook debug buat QA Playwright (bukan bagian gameplay).
    (window as unknown as { __naval?: unknown }).__naval = {
      game: this,
      state: this.state,
      scene: this.scene,
    };

    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      this.acc += dt;
      while (this.acc >= TICK_DT) {
        const events = stepGame(this.state, this.collectInputs(), TICK_DT);
        for (const ev of events) this.handleEvent(ev);
        this.acc -= TICK_DT;
      }
      this.checkMatchEnd();
      const alpha = this.acc / TICK_DT;
      this.scene.render(this.state, alpha, this.state.time, dt);
      this.hudT += dt;
      if (this.hudT > 0.1) {
        this.hudT = 0;
        this.opts.onHud(this.snapshotHud());
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Teruskan event sim ke efek visual + angka damage + flash kena hit. */
  private handleEvent(ev: SimEvent): void {
    this.scene.playEvent(ev);
    if (ev.type === "hit" && ev.byShipId === PLAYER_ID) {
      const pt = this.scene.projectToScreen(ev.x, ev.y + 2, ev.z);
      if (pt) this.opts.onDamage({ x: pt.x, y: pt.y, amount: ev.damage });
    }
    if (ev.type === "hit" && ev.shipId === PLAYER_ID) {
      this.opts.onPlayerHit();
    }
  }

  /** Match selesai: tenggelam (winnerId sim) atau waktu habis (HP tertinggi). */
  private checkMatchEnd(): void {
    if (this.over) return;
    const p = getShip(this.state, PLAYER_ID)!;
    const d = getShip(this.state, DUMMY_ID)!;
    let winner: NavalWinner | null = null;
    if (this.state.winnerId === PLAYER_ID) winner = "player";
    else if (this.state.winnerId === DUMMY_ID) winner = "dummy";
    else if (this.state.time >= MATCH_DURATION) {
      winner = p.hp > d.hp ? "player" : d.hp > p.hp ? "dummy" : "draw";
    }
    if (winner) {
      this.over = true;
      this.opts.onMatchEnd(winner);
    }
  }

  private collectInputs(): Map<string, ShipInput> {
    if (this.over) {
      return new Map([
        [PLAYER_ID, { throttle: 0, rudder: 0 }],
        [DUMMY_ID, { throttle: 0, rudder: 0 }],
      ]);
    }
    let throttle = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) throttle += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) throttle -= 1;
    let rudder = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) rudder -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) rudder += 1;
    // Q/E mengorbit kamera (bukan kendali kapal).
    if (this.keys.has("KeyQ")) this.scene.addOrbit(0.02);
    if (this.keys.has("KeyE")) this.scene.addOrbit(-0.02);
    return new Map([
      [PLAYER_ID, { throttle, rudder }],
      [DUMMY_ID, DUMMY_INPUT],
    ]);
  }

  private snapshotHud(): NavalHud {
    const p = getShip(this.state, PLAYER_ID)!;
    const d = getShip(this.state, DUMMY_ID)!;
    const def = getShipDef(this.opts.shipId);
    const t = this.state.time;
    const reloadLeft = Math.max(0, def.reloadSeconds - (t - p.lastFireAt));
    const abilityLeft = Math.max(0, p.abilityReadyAt - t);
    // Info bidik: jarak + lead balistik + halangan pulau + jangkauan.
    let aimDist = -1;
    let aimLead = -1;
    let aimBlocked = false;
    let aimOutOfRange = false;
    if (this.scene.aimX !== null && this.scene.aimZ !== null) {
      aimDist = Math.hypot(this.scene.aimX - p.x, this.scene.aimZ - p.z);
      const v = def.shellSpeed;
      const maxRange = (v * v) / 9.8;
      aimOutOfRange = aimDist > maxRange;
      if (!aimOutOfRange) {
        const theta = 0.5 * Math.asin(Math.min(1, (9.8 * aimDist) / (v * v)));
        aimLead = aimDist / (v * Math.cos(theta));
      }
      aimBlocked = !hasLineOfSight(
        this.state.map.islands,
        p.x,
        p.z,
        this.scene.aimX,
        this.scene.aimZ,
      );
    }
    return {
      speed: p.speed,
      maxSpeed: def.maxSpeed,
      headingDeg: ((p.heading * 180) / Math.PI + 360) % 360,
      hp: p.hp,
      maxHp: p.maxHp,
      dummyHp: d.hp,
      dummyMaxHp: d.maxHp,
      dummyVisible: hasLineOfSight(this.state.map.islands, p.x, p.z, d.x, d.z),
      px: p.x,
      pz: p.z,
      dx: d.x,
      dz: d.z,
      distance: Math.hypot(d.x - p.x, d.z - p.z),
      timeLeft: Math.max(0, MATCH_DURATION - t),
      reloadFrac: 1 - reloadLeft / def.reloadSeconds,
      reloadLeft,
      abilityFrac:
        def.abilityCooldown >= 9000
          ? abilityLeft <= 0
            ? 1
            : 0
          : 1 - abilityLeft / def.abilityCooldown,
      abilityLeft,
      abilityName: def.abilityName,
      shipName: def.name,
      dummyName: getShipDef("galleon").name,
      aimDist,
      aimLead,
      aimBlocked,
      aimOutOfRange,
    };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Space") {
      e.preventDefault();
      if (!this.over) useAbility(this.state, PLAYER_ID);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    const p = this.scene.screenToAim(e.clientX, e.clientY);
    if (p) {
      this.scene.aimX = p.x;
      this.scene.aimZ = p.z;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      // Klik kiri: tembak satu volley ke titik aim.
      if (!this.over && this.scene.aimX !== null && this.scene.aimZ !== null) {
        fireVolley(this.state, PLAYER_ID, this.scene.aimX, this.scene.aimZ);
      }
    } else if (e.button === 2) {
      this.orbiting = true;
      this.lastOrbitX = e.clientX;
    }
  };

  private onOrbitMove = (e: MouseEvent): void => {
    if (!this.orbiting) return;
    this.scene.addOrbit((e.clientX - this.lastOrbitX) * 0.005);
    this.lastOrbitX = e.clientX;
  };

  private onMouseUp = (): void => {
    this.orbiting = false;
  };

  private onWheel = (e: WheelEvent): void => {
    this.scene.addZoom(e.deltaY * 0.03);
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onResize = (): void => {
    this.scene.resize();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.container.removeEventListener("mousemove", this.onMouseMove);
    this.container.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onOrbitMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.container.removeEventListener("wheel", this.onWheel);
    this.container.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("resize", this.onResize);
    delete (window as unknown as { __naval?: unknown }).__naval;
    this.scene.dispose();
  }
}
