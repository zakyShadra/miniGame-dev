// Orkestrasi game naval solo (N1): loop fixed-timestep 20 Hz, input
// keyboard/mouse, dummy latihan yang berlayar melingkar. Combat (tembak)
// menyusul di N2; di sini turet hanya mengikuti titik aim mouse.

import { MAP_OPEN_BAY } from "./maps";
import { NavalScene } from "./scene";
import { getShipDef } from "./ships";
import {
  TICK_DT,
  createGame,
  getShip,
  hasLineOfSight,
  stepGame,
} from "./sim";
import type { GameState, ShipId, ShipInput } from "./types";

export interface NavalHud {
  speed: number;
  headingDeg: number;
  hp: number;
  maxHp: number;
  dummyHp: number;
  dummyMaxHp: number;
  dummyVisible: boolean;
}

export interface NavalGameOptions {
  shipId: ShipId;
  onHud: (hud: NavalHud) => void;
}

const PLAYER_ID = "player";
const DUMMY_ID = "dummy";

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

  constructor(container: HTMLElement, opts: NavalGameOptions) {
    this.container = container;
    this.opts = opts;
    this.state = createGame(
      MAP_OPEN_BAY,
      { id: PLAYER_ID, defId: opts.shipId },
      { id: DUMMY_ID, defId: "galleon" },
    );
    this.scene = new NavalScene(container, MAP_OPEN_BAY);
    this.scene.addShip(PLAYER_ID, getShipDef(opts.shipId));
    this.scene.addShip(DUMMY_ID, getShipDef("galleon"), { sailColor: "#3a6ea5", hullColor: "#5a4a3a" });
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
        stepGame(this.state, this.collectInputs(), TICK_DT);
        this.acc -= TICK_DT;
      }
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

  private collectInputs(): Map<string, ShipInput> {
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
    return {
      speed: p.speed,
      headingDeg: ((p.heading * 180) / Math.PI + 360) % 360,
      hp: p.hp,
      maxHp: p.maxHp,
      dummyHp: d.hp,
      dummyMaxHp: d.maxHp,
      dummyVisible: hasLineOfSight(this.state.map.islands, p.x, p.z, d.x, d.z),
    };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    const p = this.scene.screenToWater(e.clientX, e.clientY);
    if (p) {
      this.scene.aimX = p.x;
      this.scene.aimZ = p.z;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 2) {
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
