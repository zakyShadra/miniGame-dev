// Orkestrasi game katak solo (F1): loop fixed-timestep 60 Hz, input
// keyboard/mouse, kamera third-person orbit, lidah, kroak.

import { getLevel } from "../../../../../shared/frog/levels";
import { DragOrbit } from "../../naval/lib/cameraDrag";
import { FrogScene } from "./scene";
import {
  TICK_DT,
  createFrogGame,
  releaseTongue,
  stepFrog,
  tryFire,
} from "../../../../../shared/frog/sim";
import type { FrogGameState, FrogSimEvent } from "../../../../../shared/frog/types";

export interface FrogHud {
  fliesGot: number;
  fliesTotal: number;
  tongueMode: "idle" | "flying" | "attached";
  /** Waktu level (detik). */
  time: number;
  /** FPS render (diukur per detik). */
  fps: number;
  /** Draw call + segitiga frame terakhir. */
  calls: number;
  triangles: number;
}

export interface FrogGameOptions {
  onHud: (hud: FrogHud) => void;
  onWin: (time: number, fliesGot: number) => void;
  onCroak: (pos: { x: number; y: number } | null) => void;
}

const CROAK_DURATION = 1.4;

export class FrogGame {
  readonly state: FrogGameState;
  readonly scene: FrogScene;
  private container: HTMLElement;
  private opts: FrogGameOptions;
  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private hudT = 0;
  private keys = new Set<string>();
  private jumpQueued = false;
  private drag: DragOrbit;
  private disposed = false;
  private won = false;
  private croakUntil = 0;
  private lastMouse: { x: number; y: number } | null = null;
  private frames = 0;
  private fpsT = 0;
  private fps = 0;

  constructor(container: HTMLElement, opts: FrogGameOptions) {
    this.container = container;
    this.opts = opts;
    const level = getLevel("bengkel");
    this.state = createFrogGame(level);
    this.scene = new FrogScene(container, level);
    // Kamera awal di belakang spawn (katak menghadap -z, ke arah level).
    this.scene.orbitYaw = 0;
    this.drag = new DragOrbit(
      () => this.toggleTongue(),
      (dx) => this.scene.addOrbit(dx * 0.005),
    );

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
    (window as unknown as { __frog?: unknown }).__frog = {
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
      this.frames++;
      this.fpsT += dt;
      if (this.fpsT >= 1) {
        this.fps = Math.round(this.frames / this.fpsT);
        this.frames = 0;
        this.fpsT = 0;
      }
      this.acc += dt;
      while (this.acc >= TICK_DT) {
        const events = stepFrog(this.state, this.collectInput(), TICK_DT);
        for (const ev of events) this.handleEvent(ev);
        this.acc -= TICK_DT;
      }
      const alpha = this.acc / TICK_DT;
      this.scene.render(this.state, alpha, this.state.time, dt);
      this.syncCroak();
      this.hudT += dt;
      if (this.hudT > 0.1) {
        this.hudT = 0;
        this.opts.onHud(this.snapshotHud());
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Tembak / lepas lidah (klik kiri atau tombol J). */
  toggleTongue(): void {
    if (this.won) return;
    if (this.state.tongue.mode !== "idle") {
      releaseTongue(this.state);
      return;
    }
    // Bidik dari posisi kursor terakhir; belum ada = tengah layar.
    // Sinar berawal di kamera (paralaks kamera vs mulut terlalu besar
    // untuk cone dari mulut).
    const rect = this.container.getBoundingClientRect();
    const mx = this.lastMouse?.x ?? rect.left + rect.width / 2;
    const my = this.lastMouse?.y ?? rect.top + rect.height / 2;
    const cam = this.scene.cameraPosition;
    tryFire(
      this.state,
      { x: cam.x, y: cam.y, z: cam.z },
      this.scene.screenToAimDir(mx, my),
    );
  }

  /** Kroak: bubble teks di atas katak selama 1.4 detik. */
  croak(): void {
    if (this.won) return;
    this.croakUntil = this.state.time + CROAK_DURATION;
  }

  private syncCroak(): void {
    if (this.state.time < this.croakUntil) {
      const f = this.state.frog;
      const pt = this.scene.projectToScreen(f.pos.x, f.pos.y + 1.6, f.pos.z);
      this.opts.onCroak(pt);
    } else if (this.croakUntil > 0) {
      this.croakUntil = 0;
      this.opts.onCroak(null);
    }
  }

  private handleEvent(ev: FrogSimEvent): void {
    if (ev.type === "land") this.scene.playEvent("land");
    if (ev.type === "win" && !this.won) {
      this.won = true;
      this.opts.onWin(this.state.time, this.state.fliesGot.length);
    }
  }

  private collectInput(): { moveX: number; moveZ: number; jump: boolean } {
    if (this.won) return { moveX: 0, moveZ: 0, jump: false };
    let fwd = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
    let right = 0;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) right += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) right -= 1;
    // Maju = menjauhi kamera; kanan = tegak lurus maju (searah jarum jam
    // dilihat dari atas).
    const yaw = this.scene.cameraYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    // Q/E mengorbit kamera (bukan kendali katak).
    if (this.keys.has("KeyQ")) this.scene.addOrbit(0.03);
    if (this.keys.has("KeyE")) this.scene.addOrbit(-0.03);
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return { moveX: fx * fwd + rx * right, moveZ: fz * fwd + rz * right, jump };
  }

  private snapshotHud(): FrogHud {
    const stats = this.scene.getStats();
    return {
      fliesGot: this.state.fliesGot.length,
      fliesTotal: this.state.level.flies.length,
      tongueMode: this.state.tongue.mode,
      time: this.state.time,
      fps: this.fps,
      calls: stats.calls,
      triangles: stats.triangles,
    };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Space") {
      e.preventDefault();
      this.jumpQueued = true;
    } else if (e.code === "KeyJ") {
      this.toggleTongue();
    } else if (e.code === "KeyK") {
      this.croak();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.lastMouse = { x: e.clientX, y: e.clientY };
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.drag.onDown(e);
  };

  private onOrbitMove = (e: MouseEvent): void => {
    this.drag.onMove(e);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.drag.onUp(e);
  };

  private onWheel = (e: WheelEvent): void => {
    this.scene.addZoom(e.deltaY * 0.01);
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
    delete (window as unknown as { __frog?: unknown }).__frog;
    this.scene.dispose();
  }
}
