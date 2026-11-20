// Game katak remote (co-op): render + prediksi client untuk match yang
// simulasinya jalan di server (PartyServer, tick 20 Hz, sim 60 Hz).
// Katak sendiri diprediksi lokal (jalankan sim co-op dengan input
// sendiri) lalu direkonsiliasi lembut ke posisi server; katak pasangan
// diinterpolasi antar snapshot (delay render 100 ms, tidak pernah
// ekstrapolasi). Server yang memutuskan puzzle, lalat, dan menang;
// client hanya mengirim input + aksi lidah. Meniru naval remote.ts.

import { getLevel } from "../../../../../shared/frog/levels";
import {
  TICK_DT,
  TONGUE_TIMEOUT,
  createCoopGame,
  releaseTongueCoop,
  stepCoop,
  tryFireCoop,
} from "../../../../../shared/frog/sim";
import type {
  FrogCoopState,
  FrogInput,
  FrogState,
  TongueState,
  Vec3,
} from "../../../../../shared/frog/types";
import type { FrogSnap, FrogSnapshot } from "../../../../../shared/types";
import { DragOrbit } from "../../naval/lib/cameraDrag";
import { FrogScene, type FrogRemoteView } from "./scene";
import {
  attenByDistance,
  playBounce,
  playCroak,
  playDoorOpen,
  playEatFly,
  playJump,
  playLand,
  playTongueFire,
  playTongueStick,
  playWin,
} from "./audio";

export interface FrogCoopHud {
  fliesGot: number;
  fliesTotal: number;
  tongueMode: "idle" | "flying" | "attached";
  partnerTongueMode: "idle" | "flying" | "attached";
  /** Waktu match (detik, jam server). */
  time: number;
  /** FPS render (diukur per detik). */
  fps: number;
  /** Draw call + segitiga frame terakhir. */
  calls: number;
  triangles: number;
  doorOpen: boolean;
  buttonDown: boolean;
  atGoalMe: boolean;
  atGoalPartner: boolean;
  /** Posisi bubble kroak di layar (null bila tidak kroak). */
  croakMe: { x: number; y: number } | null;
  croakPartner: { x: number; y: number } | null;
}

export interface FrogRemoteOptions {
  onInput: (input: FrogInput) => void;
  onFire: (origin: Vec3, dir: Vec3) => void;
  onRelease: () => void;
  onCroak: () => void;
  onHud: (hud: FrogCoopHud) => void;
  onWin: (time: number, fliesGot: number) => void;
}

export interface FrogRemoteStart {
  myIndex: 0 | 1;
  myColor: "orange" | "green";
  partnerColor: "orange" | "green";
  /** Id definisi level co-op (F3, dari room). */
  levelId: string;
}

/** Delay render interpolasi (ms): pasangan digambar 100 ms di masa lalu. */
const INTERP_DELAY_MS = 100;
/** Selisih prediksi vs server di atas ini (m) direkonsiliasi lembut. */
const RECONCILE_DIST = 0.5;
const CROAK_DURATION = 1.4;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function snapToTongue(s: FrogSnap): TongueState {
  return {
    mode: s.tongue.mode,
    anchorId: null,
    anchor:
      s.tongue.mode === "idle"
        ? null
        : { x: s.tongue.ax, y: s.tongue.ay, z: s.tongue.az },
    anchorFrog: s.tongue.anchorFrog,
    length: 0,
    restLength: 0,
    timeLeft: s.tongue.mode === "attached" ? TONGUE_TIMEOUT : 0,
    flyTime: 0,
  };
}

export class FrogRemoteGame {
  private container: HTMLElement;
  private opts: FrogRemoteOptions;
  private scene: FrogScene | null = null;
  private pred: FrogCoopState | null = null;
  private myIndex: 0 | 1 = 0;
  private partnerIndex: 0 | 1 = 1;

  private prevSnap: FrogSnapshot | null = null;
  private curSnap: FrogSnapshot | null = null;
  private prevRecvAt = 0;
  private curRecvAt = 0;
  /** State shared dari snapshot terakhir (server authoritative). */
  private shared = {
    t: 0,
    fliesGot: [] as string[],
    usedAnchors: [] as string[],
    doorOpen: false,
    buttonDown: false,
    atGoal: [false, false] as [boolean, boolean],
    croakUntil: [0, 0] as [number, number],
  };

  private raf = 0;
  private inputTimer = 0;
  private lastT = 0;
  private acc = 0;
  private hudT = 0;
  private keys = new Set<string>();
  private jumpQueued = false;
  private jumpSendPending = false;
  /** Input analog joystick sentuh (x kanan +, y bawah +). */
  private touch = { x: 0, y: 0 };
  /** Status pintu + kroak pasangan snapshot sebelumnya (buat bunyi). */
  private prevDoorOpen = false;
  private prevPartnerCroakUntil = 0;
  private drag: DragOrbit;
  private disposed = false;
  private over = false;
  private croakUntilMe = 0;
  private lastMouse: { x: number; y: number } | null = null;
  private frames = 0;
  private fpsT = 0;
  private fps = 0;

  constructor(container: HTMLElement, opts: FrogRemoteOptions) {
    this.container = container;
    this.opts = opts;
    this.drag = new DragOrbit(
      () => this.toggleTongue(),
      (dx) => this.scene?.addOrbit(dx * 0.005),
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

    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    // Input dikirim via interval sendiri (50 ms), TIDAK terikat rAF:
    // di perangkat lambat frame rate turun tapi input harus tetap 20 Hz.
    this.inputTimer = window.setInterval(() => {
      if (!this.over) this.opts.onInput(this.collectSendInput());
    }, 50);
  }

  /** Pasang scene + sim prediksi untuk satu match. */
  start(cfg: FrogRemoteStart): void {
    this.scene?.dispose();
    this.myIndex = cfg.myIndex;
    this.partnerIndex = cfg.myIndex === 0 ? 1 : 0;
    const level = getLevel(cfg.levelId);
    this.scene = new FrogScene(this.container, level, cfg.myColor);
    this.scene.addPartner(cfg.partnerColor);
    this.scene.orbitYaw = 0;
    this.pred = createCoopGame(level);
    this.prevSnap = null;
    this.curSnap = null;
    this.shared = {
      t: 0,
      fliesGot: [],
      usedAnchors: [],
      doorOpen: false,
      buttonDown: false,
      atGoal: [false, false],
      croakUntil: [0, 0],
    };
    this.over = false;
    this.acc = 0;
    this.prevDoorOpen = false;
    this.prevPartnerCroakUntil = 0;

    // Hook debug buat QA Playwright (bukan bagian gameplay).
    (window as unknown as { __frogRemote?: unknown }).__frogRemote = {
      game: this,
      scene: this.scene,
      pred: this.pred,
    };
  }

  /** Terapkan snapshot server: simpan buat interpolasi, mainkan event,
   * rekonsiliasi prediksi katak sendiri. */
  applySnapshot(snap: FrogSnapshot): void {
    this.prevSnap = this.curSnap;
    this.prevRecvAt = this.curRecvAt;
    this.curSnap = snap;
    this.curRecvAt = performance.now();
    this.shared.t = snap.t;
    this.shared.fliesGot = [...snap.fliesGot];
    this.shared.usedAnchors = [...snap.usedAnchors];
    this.shared.doorOpen = snap.doorOpen;
    this.shared.buttonDown = snap.buttonDown;
    this.shared.atGoal = [...snap.atGoal] as [boolean, boolean];
    this.shared.croakUntil = [...snap.croakUntil] as [number, number];

    const pred = this.pred;
    if (pred) {
      const me = snap.frogs[this.myIndex];
      const f = pred.frogs[this.myIndex];
      // Rekonsiliasi lembut: selisih kecil langsung ditempel, selisih
      // besar ditarik 30% per snapshot supaya tidak teleport.
      const dx = me.x - f.pos.x;
      const dy = me.y - f.pos.y;
      const dz = me.z - f.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > RECONCILE_DIST) {
        f.pos.x += dx * 0.3;
        f.pos.y += dy * 0.3;
        f.pos.z += dz * 0.3;
      } else {
        f.pos.x = me.x;
        f.pos.y = me.y;
        f.pos.z = me.z;
      }
      f.prevPos = { ...f.pos };
      // Field otoritatif server selalu ditempel.
      f.vel = { x: me.vx, y: me.vy, z: me.vz };
      f.facing = me.facing;
      f.onGround = me.onGround;
      // Lidah server menimpa prediksi lokal (tembakan optimis yang
      // ditolak server langsung dikoreksi).
      pred.tongues[this.myIndex] = snapToTongue(me);
      // Posisi + lidah pasangan di sim prediksi ikut snapshot (target
      // pegas lidah ke pasangan tetap segar, dan tarikan lidah pasangan
      // ke saya ikut terprediksi lokal; tanpa ini pred tidak tahu
      // pasangan sedang menarik saya sampai snapshot mengoreksinya).
      const p = snap.frogs[this.partnerIndex];
      const pf = pred.frogs[this.partnerIndex];
      pf.pos = { x: p.x, y: p.y, z: p.z };
      pf.prevPos = { ...pf.pos };
      pf.vel = { x: p.vx, y: p.vy, z: p.vz };
      pf.facing = p.facing;
      pf.onGround = p.onGround;
      pred.tongues[this.partnerIndex] = snapToTongue(p);
    }

    for (const ev of snap.events) {
      if (ev.type === "land") this.scene?.playEvent("land", ev.frog);
      if (ev.type === "bounce") this.scene?.playEvent("bounce", ev.frog, ev.mushroomId);
      if (ev.type === "fly") this.scene?.playEvent("fly", ev.frog, ev.flyId);
      this.playEventSound(ev.type, ev.frog);
    }

    // Pintu terbuka (transisi): gemuruh besi. Kroak pasangan (croakUntil
    // naik): kroak dengan volume atenuasi jarak.
    if (snap.doorOpen && !this.prevDoorOpen) playDoorOpen();
    this.prevDoorOpen = snap.doorOpen;
    if (snap.croakUntil[this.partnerIndex] > this.prevPartnerCroakUntil) {
      playCroak(this.partnerVol());
    }
    this.prevPartnerCroakUntil = snap.croakUntil[this.partnerIndex];

    if (snap.won && !this.over) {
      this.over = true;
      playWin();
      this.opts.onWin(snap.t, snap.fliesGot.length);
    }
  }

  /** Volume bunyi pasangan dari jarak kedua katak (snapshot terakhir). */
  private partnerVol(): number {
    const snap = this.curSnap;
    if (!snap) return 0.5;
    const me = snap.frogs[this.myIndex];
    const p = snap.frogs[this.partnerIndex];
    return attenByDistance(Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z));
  }

  /** Bunyi event sim server: saya penuh, pasangan teratenuasi jarak. */
  private playEventSound(type: string, frog: 0 | 1): void {
    const vol = frog === this.myIndex ? 1 : this.partnerVol();
    if (type === "jump") playJump(vol);
    else if (type === "land") playLand(vol);
    else if (type === "tongue-fire") playTongueFire(vol);
    else if (type === "tongue-attach") playTongueStick(vol);
    else if (type === "fly") playEatFly(vol);
    else if (type === "bounce") playBounce(vol);
  }

  /** Tembak / lepas lidah (klik kiri atau tombol J). Optimis lokal +
   * kirim ke server; server yang memutuskan. */
  toggleTongue(): void {
    if (this.over || !this.pred || !this.scene) return;
    const t = this.pred.tongues[this.myIndex];
    if (t.mode !== "idle") {
      releaseTongueCoop(this.pred, this.myIndex);
      this.opts.onRelease();
      return;
    }
    const rect = this.container.getBoundingClientRect();
    const mx = this.lastMouse?.x ?? rect.left + rect.width / 2;
    const my = this.lastMouse?.y ?? rect.top + rect.height / 2;
    const cam = this.scene.cameraPosition;
    const origin = { x: cam.x, y: cam.y, z: cam.z };
    const dirV = this.scene.screenToAimDir(mx, my);
    const dir = { x: dirV.x, y: dirV.y, z: dirV.z };
    tryFireCoop(this.pred, this.myIndex, origin, dir);
    this.opts.onFire(origin, dir);
  }

  /** Kroak: bubble lokal langsung + kirim ke server (buat pasangan). */
  croak(): void {
    if (this.over || !this.pred) return;
    playCroak();
    this.croakUntilMe = this.pred.time + CROAK_DURATION;
    this.opts.onCroak();
  }

  /** Input sentuh (dari FrogTouchControls): joystick analog + lompat. */
  setTouchMove(x: number, y: number): void {
    this.touch = { x, y };
  }

  queueJump(): void {
    this.jumpQueued = true;
    this.jumpSendPending = true;
  }

  /** Orbit kamera dari drag sentuh (dx piksel, skala sama seperti drag mouse). */
  orbitBy(dx: number): void {
    this.scene?.addOrbit(dx * 0.005);
  }

  /** Alpha interpolasi pasangan (0..1, render 100 ms di masa lalu). */
  private interpAlpha(now: number): number {
    if (!this.prevSnap || !this.curSnap) return 1;
    const span = this.curRecvAt - this.prevRecvAt;
    if (span <= 0) return 1;
    const rt = now - INTERP_DELAY_MS;
    return Math.max(0, Math.min(1, (rt - this.prevRecvAt) / span));
  }

  /** State katak pasangan hasil interpolasi snapshot (buat render). */
  private interpPartner(now: number): { frog: FrogState; tongue: TongueState } | null {
    const cur = this.curSnap;
    const pred = this.pred;
    if (!cur || !pred) return null;
    const alpha = this.interpAlpha(now);
    const s = cur.frogs[this.partnerIndex];
    const prev = this.prevSnap?.frogs[this.partnerIndex];
    let x = s.x;
    let y = s.y;
    let z = s.z;
    let facing = s.facing;
    if (prev) {
      x = prev.x + (s.x - prev.x) * alpha;
      y = prev.y + (s.y - prev.y) * alpha;
      z = prev.z + (s.z - prev.z) * alpha;
      facing = lerpAngle(prev.facing, s.facing, alpha);
    }
    const frog: FrogState = {
      pos: { x, y, z },
      vel: { x: s.vx, y: s.vy, z: s.vz },
      prevPos: { x, y, z },
      onGround: s.onGround,
      facing,
      checkpoint: { x, y, z },
    };
    const tongue = snapToTongue(s);
    // Lidah pasangan yang nempel ke saya: anchor = posisi saya (live).
    if (tongue.anchorFrog === this.myIndex) {
      const me = pred.frogs[this.myIndex];
      tongue.anchor = { x: me.pos.x, y: me.pos.y + 0.5, z: me.pos.z };
    }
    return { frog, tongue };
  }

  private buildView(now: number): FrogRemoteView | null {
    const pred = this.pred;
    if (!pred) return null;
    const me = pred.frogs[this.myIndex];
    const partner = this.interpPartner(now);
    // Tombol yang tertekan dihitung dari posisi kedua katak (aturan
    // sama seperti sim server).
    const pressed: string[] = [];
    for (const b of pred.level.buttons ?? []) {
      const frogs = [me, partner?.frog].filter(Boolean) as FrogState[];
      if (
        frogs.some(
          (f) =>
            f.onGround &&
            Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z) < b.radius &&
            Math.abs(f.pos.y - b.pos.y) < 1.5,
        )
      ) {
        pressed.push(b.id);
      }
    }
    return {
      me: { frog: me, tongue: pred.tongues[this.myIndex] },
      partner,
      fliesGot: this.shared.fliesGot,
      usedAnchors: this.shared.usedAnchors,
      doorOpen: this.shared.doorOpen,
      pressedButtons: pressed,
    };
  }

  /** Input gerak dari keyboard (relatif kamera), tanpa lompat. */
  private moveInput(): { moveX: number; moveZ: number } {
    let fwd = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
    let right = 0;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) right += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) right -= 1;
    // Joystick sentuh: atas = maju (y bawah +), kanan = kanan.
    fwd += -this.touch.y;
    right += this.touch.x;
    const yaw = this.scene?.cameraYaw ?? 0;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    if (this.keys.has("KeyQ")) this.scene?.addOrbit(0.03);
    if (this.keys.has("KeyE")) this.scene?.addOrbit(-0.03);
    return { moveX: fx * fwd + rx * right, moveZ: fz * fwd + rz * right };
  }

  /** Input buat step sim lokal (lompat dikonsumsi sekali). */
  private collectLocalInput(): FrogInput {
    if (this.over) return { moveX: 0, moveZ: 0, jump: false };
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return { ...this.moveInput(), jump };
  }

  /** Input buat dikirim ke server (flag lompat terpisah dari lokal:
   * lompat harus sampai ke server meski step lokal sudah mengonsumsinya). */
  private collectSendInput(): FrogInput {
    if (this.over) return { moveX: 0, moveZ: 0, jump: false };
    const jump = this.jumpSendPending;
    this.jumpSendPending = false;
    return { ...this.moveInput(), jump };
  }

  private frame = (t: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 1) {
      this.fps = Math.round(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
    }
    const scene = this.scene;
    const pred = this.pred;
    if (!scene || !pred) return;

    // Step sim prediksi 60 Hz (pasangan di-step dengan input nol;
    // posisinya ditimpa snapshot tiap applySnapshot).
    this.acc += dt;
    while (this.acc >= TICK_DT) {
      const input = this.collectLocalInput();
      const inputs: [FrogInput, FrogInput] =
        this.myIndex === 0
          ? [input, { moveX: 0, moveZ: 0, jump: false }]
          : [{ moveX: 0, moveZ: 0, jump: false }, input];
      stepCoop(pred, inputs, TICK_DT);
      this.acc -= TICK_DT;
    }
    const alpha = this.acc / TICK_DT;
    const view = this.buildView(t);
    if (view) scene.renderRemote(view, alpha, this.serverTime(), dt);
    this.hudT += dt;
    if (this.hudT > 0.1) {
      this.hudT = 0;
      this.opts.onHud(this.snapshotHud(t));
    }
  };

  /** Jam server diestimasi dari snapshot terakhir + waktu berlalu. */
  private serverTime(): number {
    return this.shared.t + (performance.now() - this.curRecvAt) / 1000;
  }

  private snapshotHud(now: number): FrogCoopHud {
    const pred = this.pred;
    const stats = this.scene?.getStats() ?? { calls: 0, triangles: 0 };
    const t = this.curSnap ? this.serverTime() : 0;
    const me = pred?.frogs[this.myIndex];
    const partner = this.interpPartner(now)?.frog ?? null;
    let croakMe: { x: number; y: number } | null = null;
    let croakPartner: { x: number; y: number } | null = null;
    if (me && pred && pred.time < this.croakUntilMe) {
      croakMe = this.scene?.projectToScreen(me.pos.x, me.pos.y + 1.6, me.pos.z) ?? null;
    }
    if (partner && this.shared.croakUntil[this.partnerIndex] > t) {
      croakPartner =
        this.scene?.projectToScreen(partner.pos.x, partner.pos.y + 1.6, partner.pos.z) ?? null;
    }
    return {
      fliesGot: this.shared.fliesGot.length,
      fliesTotal: pred?.level.flies.length ?? 7,
      tongueMode: pred?.tongues[this.myIndex].mode ?? "idle",
      partnerTongueMode: this.curSnap?.frogs[this.partnerIndex].tongue.mode ?? "idle",
      time: t,
      fps: this.fps,
      calls: stats.calls,
      triangles: stats.triangles,
      doorOpen: this.shared.doorOpen,
      buttonDown: this.shared.buttonDown,
      atGoalMe: this.shared.atGoal[this.myIndex],
      atGoalPartner: this.shared.atGoal[this.partnerIndex],
      croakMe,
      croakPartner,
    };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Space") {
      e.preventDefault();
      this.jumpQueued = true;
      this.jumpSendPending = true;
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
    this.scene?.addZoom(e.deltaY * 0.01);
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onResize = (): void => {
    this.scene?.resize();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.inputTimer);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.container.removeEventListener("mousemove", this.onMouseMove);
    this.container.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onOrbitMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.container.removeEventListener("wheel", this.onWheel);
    this.container.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("resize", this.onResize);
    delete (window as unknown as { __frogRemote?: unknown }).__frogRemote;
    this.scene?.dispose();
    this.scene = null;
  }
}
