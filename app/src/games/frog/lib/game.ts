// Orkestrasi game katak solo (F1): loop fixed-timestep 60 Hz, input
// keyboard/mouse, kamera third-person orbit, lidah, kroak.

import { getLevel } from "../../../../../shared/frog/levels";
import { DragOrbit } from "../../naval/lib/cameraDrag";
import { FrogScene } from "./scene";
import {
  playBounce,
  playCoin,
  playCroak,
  playDoorOpen,
  playEatFly,
  playJump,
  playKiss,
  playLand,
  playLick,
  playOrb,
  playRing,
  playTongueFire,
  playTongueStick,
  playWin,
} from "./audio";
import {
  TICK_DT,
  createFrogGame,
  mouthPos,
  releaseTongue,
  stepFrog,
  tryFire,
} from "../../../../../shared/frog/sim";
import { AIM_FACING_KEY, HIGH_CAM_KEY, readPref, writePref } from "./preferences";
import type { FrogGameState, FrogSimEvent } from "../../../../../shared/frog/types";

export interface FrogHud {
  fliesGot: number;
  fliesTotal: number;
  /** Orb hijau yang sudah diambil / total (F6.11). */
  orbsGot: number;
  orbsTotal: number;
  /** Koin emas yang sudah diambil / total (F6.11). */
  coinsGot: number;
  coinsTotal: number;
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
  /** Id definisi level (F3, default bengkel). */
  levelId?: string;
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
  /** Input analog joystick sentuh (x kanan +, y bawah +). */
  private touch = { x: 0, y: 0 };
  /** Status pintu frame sebelumnya (buat bunyi saat terbuka). */
  private prevDoorOpen = false;
  private drag: DragOrbit;
  private disposed = false;
  private won = false;
  private croakUntil = 0;
  private lastMouse: { x: number; y: number } | null = null;
  private frames = 0;
  private fpsT = 0;
  private fps = 0;
  /** Kamera sudut tinggi (F6.13, dari localStorage). */
  highCam = readPref(HIGH_CAM_KEY);
  /** Bidik lidah ke arah hadap katak (F6.14, dari localStorage).
   * Default false (bidik klik mouse, sinar kamera). */
  aimFacing = readPref(AIM_FACING_KEY);

  constructor(container: HTMLElement, opts: FrogGameOptions) {
    this.container = container;
    this.opts = opts;
    const level = getLevel(opts.levelId ?? "bengkel");
    this.state = createFrogGame(level);
    this.scene = new FrogScene(container, level);
    this.scene.highCam = this.highCam;
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
      // Pintu latch terbuka (transisi): bunyi gemuruh besi.
      if (this.state.doorOpen && !this.prevDoorOpen) playDoorOpen();
      this.prevDoorOpen = this.state.doorOpen;
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
    // Bidik arah hadap (F6.14): lidah meluncur dari mulut ke arah
    // katak menghadap (miring ke atas 0.35 supaya lentera di atas
    // masih kena toleransi bidik), tanpa klik mouse. Cocok untuk
    // gamepad/mobile. Default: sinar kamera dari posisi kursor.
    if (this.aimFacing) {
      const f = this.state.frog.facing;
      const dir = { x: Math.sin(f), y: 0.35, z: Math.cos(f) };
      const l = Math.hypot(dir.x, dir.y, dir.z);
      tryFire(this.state, mouthPos(this.state.frog), {
        x: dir.x / l,
        y: dir.y / l,
        z: dir.z / l,
      });
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

  /** Kroak: bubble teks di atas katak selama 1.4 detik + bunyi. */
  croak(): void {
    if (this.won) return;
    playCroak();
    this.croakUntil = this.state.time + CROAK_DURATION;
  }

  /** Input sentuh (dari FrogTouchControls): joystick analog + lompat. */
  setTouchMove(x: number, y: number): void {
    this.touch = { x, y };
  }

  queueJump(): void {
    this.jumpQueued = true;
  }

  /** Orbit kamera dari drag sentuh (dx piksel, skala sama seperti drag mouse). */
  orbitBy(dx: number): void {
    this.scene.addOrbit(dx * 0.005);
  }

  /** Toggle kamera sudut tinggi (F6.13, tombol HUD / tombol C). */
  toggleHighCam(): void {
    this.highCam = !this.highCam;
    this.scene.highCam = this.highCam;
    writePref(HIGH_CAM_KEY, this.highCam);
  }

  /** Toggle bidik arah hadap (F6.14, tombol HUD / tombol B). */
  toggleAimFacing(): void {
    this.aimFacing = !this.aimFacing;
    writePref(AIM_FACING_KEY, this.aimFacing);
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
    if (ev.type === "land") {
      this.scene.playEvent("land");
      playLand();
    }
    if (ev.type === "jump") playJump();
    if (ev.type === "tongue-fire") playTongueFire();
    if (ev.type === "tongue-attach") playTongueStick();
    if (ev.type === "fly") {
      this.scene.playEvent("fly", 0, ev.flyId);
      playEatFly();
    }
    if (ev.type === "ring") {
      this.scene.playEvent("ring", 0, ev.ringId);
      playRing();
    }
    if (ev.type === "orb") {
      this.scene.playEvent("orb", 0, ev.orbId);
      playOrb();
    }
    if (ev.type === "coin") {
      this.scene.playEvent("coin", 0, ev.coinId);
      playCoin();
    }
    if (ev.type === "kiss") {
      this.scene.playEvent("kiss", 0, undefined, ev.pos);
      playKiss();
    }
    if (ev.type === "pulldoor") {
      this.scene.playEvent("pulldoor", 0, ev.doorId);
      playDoorOpen();
    }
    if (ev.type === "lick") {
      this.scene.playEvent("lick", 0, undefined, ev.pos);
      playLick();
    }
    if (ev.type === "bounce") {
      this.scene.playEvent("bounce", 0, ev.mushroomId);
      playBounce();
    }
    if (ev.type === "win" && !this.won) {
      this.won = true;
      playWin();
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
    // Joystick sentuh: atas = maju (y bawah +), kanan = kanan.
    fwd += -this.touch.y;
    right += this.touch.x;
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
      orbsGot: this.state.orbsGot.length,
      orbsTotal: this.state.level.orbs?.length ?? 0,
      coinsGot: this.state.coinsGot.length,
      coinsTotal: this.state.level.coins?.length ?? 0,
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
    } else if (e.code === "KeyC") {
      this.toggleHighCam();
    } else if (e.code === "KeyB") {
      this.toggleAimFacing();
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
