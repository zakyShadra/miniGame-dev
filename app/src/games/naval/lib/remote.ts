// Game naval remote (co-op + PvP): render + prediksi client untuk match
// yang simulasinya jalan di server (PartyServer, tick 20 Hz). Kapal
// sendiri diprediksi lokal (dead reckoning + moveShip) lalu
// direkonsiliasi lembut ke posisi server; kapal lain diinterpolasi antar
// snapshot (delay render 100 ms, tidak pernah ekstrapolasi). Server yang
// memutuskan hit, LoS, dan akhir match; client hanya mengirim input.
// Lawan digeneralisasi: bot (co-op) atau pemain lain (PvP).

import { getMap } from "../../../../../shared/naval/maps";
import { getShipDef } from "../../../../../shared/naval/ships";
import {
  GRAVITY,
  hasLineOfSight,
  moveShip,
} from "../../../../../shared/naval/sim";
import type {
  GameState,
  MapDef,
  ShipDef,
  ShipId,
  ShipInput,
  ShipState,
} from "../../../../../shared/naval/types";
import type { NavalShipSnap, NavalSnapshot } from "../../../../../shared/types";
import { NavalScene } from "./scene";
import { MATCH_DURATION, type DamageNumber, type NavalHud } from "./game";

export interface NavalRemoteGameOptions {
  onInput: (input: ShipInput) => void;
  onFire: (aimX: number, aimZ: number) => void;
  onAbility: () => void;
  onHud: (hud: NavalHud) => void;
  /** Hasil mentah dari server: "players" | "bot" | "draw" (co-op) atau
   * shipKey pemenang "p1" | "p2" | "draw" (PvP). Store yang memetakan
   * ke menang/kalah sesuai mode. */
  onMatchEnd: (winnerId: string) => void;
  onDamage: (d: DamageNumber) => void;
  onPlayerHit: () => void;
}

/** Konfigurasi satu match remote (co-op atau PvP). */
export interface NavalRemoteStart {
  mode: "coop" | "pvp";
  mapId: string;
  myShipId: ShipId;
  myShipKey: "p1" | "p2";
  ships: Array<{ key: string; defId: ShipId; name: string }>;
  /** Lawan: bot (co-op) atau pemain lain (PvP). Mesh-nya ditambah
   * begitu snapshot pertama menyatakan lawan terlihat. */
  opponent: { key: string; defId: ShipId; name: string };
}

/** Delay render interpolasi (ms): kapal remote digambar 100 ms di masa lalu. */
const INTERP_DELAY_MS = 100;
/** Selisih prediksi vs server di atas ini (m) direkonsiliasi lembut. */
const RECONCILE_DIST = 2;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function snapToShipState(s: NavalShipSnap): ShipState {
  return {
    id: s.id,
    defId: s.defId,
    x: s.x,
    z: s.z,
    prevX: s.x,
    prevZ: s.z,
    heading: s.heading,
    prevHeading: s.heading,
    speed: s.speed,
    turn: s.turn,
    heel: s.heel,
    hp: s.hp,
    maxHp: s.maxHp,
    alive: s.alive,
    sinking: s.sinking,
    sinkTime: s.sinkTime,
    lastFireAt: s.lastFireAt,
    abilityReadyAt: s.abilityReadyAt,
    abilityUntil: 0,
    throttle: 0,
    rudder: 0,
  };
}

export class NavalRemoteGame {
  private container: HTMLElement;
  private opts: NavalRemoteGameOptions;
  private scene: NavalScene | null = null;
  private map: MapDef | null = null;
  private synth: GameState | null = null;
  private myShipId: ShipId = "frigate";
  private myShipKey: "p1" | "p2" = "p1";
  private myDef: ShipDef = getShipDef("frigate");
  /** Lawan (bot di co-op, pemain lain di PvP). */
  private foeKey = "bot";
  private foeDef: ShipDef = getShipDef("galleon");
  private foeName = "Bot";

  private prevSnap: NavalSnapshot | null = null;
  private curSnap: NavalSnapshot | null = null;
  private prevRecvAt = 0;
  private curRecvAt = 0;
  /** Prediksi lokal kapal sendiri (di-step tiap frame dengan input). */
  private pred: ShipState | null = null;
  /** Posisi render terakhir per kapal (buat prevX/prevZ scene). */
  private rendered = new Map<string, { x: number; z: number; heading: number }>();
  /** Snapshot lawan terakhir (buat HUD saat lawan tersembunyi). */
  private lastFoeSnap: NavalShipSnap | null = null;
  private foeMesh = false;
  private foeVisible = false;

  private raf = 0;
  private inputTimer = 0;
  private lastT = 0;
  private renderTime = 0;
  private hudT = 0;
  private keys = new Set<string>();
  private orbiting = false;
  private lastOrbitX = 0;
  private disposed = false;
  private over = false;

  constructor(container: HTMLElement, opts: NavalRemoteGameOptions) {
    this.container = container;
    this.opts = opts;

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
      if (!this.over) this.opts.onInput(this.currentInput());
    }, 50);
  }

  /** Pasang scene + kapal untuk satu match. Lawan tidak ditambahkan di
   * sini: mesh-nya diatur snapshot pertama (bisa langsung tersembunyi). */
  start(cfg: NavalRemoteStart): void {
    this.scene?.dispose();
    this.foeKey = cfg.opponent.key;
    this.foeDef = getShipDef(cfg.opponent.defId);
    this.foeName = cfg.opponent.name;
    this.map = getMap(cfg.mapId);
    this.myShipId = cfg.myShipId;
    this.myShipKey = cfg.myShipKey;
    this.myDef = getShipDef(cfg.myShipId);
    this.scene = new NavalScene(this.container, this.map);
    for (const s of cfg.ships) {
      if (s.key === cfg.opponent.key) continue;
      this.scene.addShip(s.key, getShipDef(s.defId));
    }
    this.scene.followId = cfg.myShipKey;
    this.synth = {
      map: this.map,
      ships: [],
      shells: [],
      time: 0,
      nextShellId: 1,
      winnerId: null,
      lastHitterId: null,
    };
    this.prevSnap = null;
    this.curSnap = null;
    this.pred = null;
    this.rendered.clear();
    this.lastFoeSnap = null;
    this.foeMesh = false;
    this.foeVisible = false;
    this.over = false;
    this.renderTime = 0;

    // Hook debug buat QA Playwright (bukan bagian gameplay).
    (window as unknown as { __navalRemote?: unknown }).__navalRemote = {
      game: this,
      scene: this.scene,
    };
  }

  /** Terapkan snapshot server: simpan buat interpolasi, mainkan event,
   * rekonsiliasi prediksi kapal sendiri, atur visibilitas lawan. */
  applySnapshot(snap: NavalSnapshot): void {
    this.prevSnap = this.curSnap;
    this.prevRecvAt = this.curRecvAt;
    this.curSnap = snap;
    this.curRecvAt = performance.now();

    const foeInSnap = snap.ships.some((s) => s.id === this.foeKey);
    this.setFoeVisible(snap.foeVisible && foeInSnap);
    const foeSnap = snap.ships.find((s) => s.id === this.foeKey);
    if (foeSnap) this.lastFoeSnap = foeSnap;

    const me = snap.ships.find((s) => s.id === this.myShipKey);
    if (me) {
      if (!this.pred) {
        this.pred = snapToShipState(me);
      } else {
        // Rekonsiliasi lembut: selisih kecil langsung ditempel, selisih
        // besar ditarik 30% per snapshot supaya tidak teleport.
        const dx = me.x - this.pred.x;
        const dz = me.z - this.pred.z;
        const d = Math.hypot(dx, dz);
        if (d > RECONCILE_DIST) {
          this.pred.x += dx * 0.3;
          this.pred.z += dz * 0.3;
        } else {
          this.pred.x = me.x;
          this.pred.z = me.z;
        }
        // Field otoritatif server selalu ditempel.
        this.pred.heading = me.heading;
        this.pred.speed = me.speed;
        this.pred.turn = me.turn;
        this.pred.heel = me.heel;
        this.pred.hp = me.hp;
        this.pred.alive = me.alive;
        this.pred.sinking = me.sinking;
        this.pred.sinkTime = me.sinkTime;
        this.pred.lastFireAt = me.lastFireAt;
        this.pred.abilityReadyAt = me.abilityReadyAt;
      }
    }

    for (const ev of snap.events) this.handleEvent(ev);

    if (snap.winnerId && !this.over) {
      this.over = true;
      // Hasil mentah diteruskan ke store (mapping menang/kalah beda
      // per mode: co-op "players"/"bot", PvP "p1"/"p2").
      this.opts.onMatchEnd(snap.winnerId);
    }
  }

  /** Tampilkan/sembunyikan mesh lawan (dipanggil applySnapshot; publik
   * buat store bila perlu memaksa). */
  setFoeVisible(v: boolean): void {
    if (v === this.foeVisible) return;
    this.foeVisible = v;
    if (!this.scene) return;
    if (v && !this.foeMesh) {
      this.scene.addShip(this.foeKey, this.foeDef, { enemy: true });
      this.foeMesh = true;
    } else if (!v && this.foeMesh) {
      this.scene.removeShip(this.foeKey);
      this.foeMesh = false;
    }
  }

  private handleEvent(ev: NavalSnapshot["events"][number]): void {
    this.scene?.playEvent(ev);
    if (ev.type === "hit" && ev.byShipId === this.myShipKey) {
      const pt = this.scene?.projectToScreen(ev.x, ev.y + 2, ev.z);
      if (pt) this.opts.onDamage({ x: pt.x, y: pt.y, amount: ev.damage });
    }
    if (ev.type === "hit" && ev.shipId === this.myShipKey) {
      this.opts.onPlayerHit();
    }
  }

  /** Alpha interpolasi kapal remote (0..1, render 100 ms di masa lalu). */
  private interpAlpha(now: number): number {
    if (!this.prevSnap || !this.curSnap) return 1;
    const span = this.curRecvAt - this.prevRecvAt;
    if (span <= 0) return 1;
    const rt = now - INTERP_DELAY_MS;
    return Math.max(0, Math.min(1, (rt - this.prevRecvAt) / span));
  }

  /** Bangun GameState sintetis buat scene.render dari snapshot terakhir:
   * kapal sendiri = prediksi lokal, kapal lain = interpolasi. */
  private buildSynthShips(now: number): void {
    const cur = this.curSnap;
    const synth = this.synth;
    if (!cur || !synth) return;
    const alpha = this.interpAlpha(now);
    const ships: ShipState[] = [];
    for (const s of cur.ships) {
      if (s.id === this.myShipKey && this.pred) {
        const r = this.rendered.get(s.id);
        const st: ShipState = { ...this.pred };
        st.prevX = r?.x ?? st.x;
        st.prevZ = r?.z ?? st.z;
        st.prevHeading = r?.heading ?? st.heading;
        this.rendered.set(s.id, { x: st.x, z: st.z, heading: st.heading });
        ships.push(st);
        continue;
      }
      const prev = this.prevSnap?.ships.find((p) => p.id === s.id);
      let x = s.x;
      let z = s.z;
      let heading = s.heading;
      if (prev) {
        x = prev.x + (s.x - prev.x) * alpha;
        z = prev.z + (s.z - prev.z) * alpha;
        heading = lerpAngle(prev.heading, s.heading, alpha);
      }
      const r = this.rendered.get(s.id);
      const st = snapToShipState(s);
      st.x = x;
      st.z = z;
      st.heading = heading;
      st.prevX = r?.x ?? x;
      st.prevZ = r?.z ?? z;
      st.prevHeading = r?.heading ?? heading;
      this.rendered.set(s.id, { x, z, heading });
      ships.push(st);
    }
    synth.ships = ships;
    synth.shells = cur.shells.map((sh, i) => ({
      id: i + 1,
      x: sh.x,
      y: sh.y,
      z: sh.z,
      vx: 0,
      vy: 0,
      vz: 0,
      fromShipId: "",
      damage: 0,
      splashRadius: 0,
      alive: true,
    }));
    synth.time = cur.t;
  }

  private currentInput(): ShipInput {
    let throttle = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) throttle += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) throttle -= 1;
    let rudder = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) rudder -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) rudder += 1;
    return { throttle, rudder };
  }

  private frame = (t: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    this.renderTime += dt;
    const scene = this.scene;
    const synth = this.synth;
    if (!scene || !synth || !this.map) return;

    if (this.keys.has("KeyQ")) scene.addOrbit(0.02);
    if (this.keys.has("KeyE")) scene.addOrbit(-0.02);

    // Prediksi kapal sendiri: jalankan fisika lokal dengan input sendiri.
    if (this.pred && !this.over && this.pred.alive && !this.pred.sinking) {
      this.pred.prevX = this.pred.x;
      this.pred.prevZ = this.pred.z;
      this.pred.prevHeading = this.pred.heading;
      moveShip(synth, this.pred, this.currentInput(), dt);
    }

    this.buildSynthShips(t);
    // Waktu render = jam lokal (ombak + bendera tetap bergerak meski
    // snapshot berhenti setelah match selesai).
    scene.render(synth, 1, this.renderTime, dt);
    this.hudT += dt;
    if (this.hudT > 0.1) {
      this.hudT = 0;
      this.opts.onHud(this.snapshotHud());
    }
  };

  private snapshotHud(): NavalHud {
    const def = this.myDef;
    const foe = this.lastFoeSnap;
    const me = this.pred ?? this.curSnap?.ships.find((s) => s.id === this.myShipKey);
    // Belum ada snapshot: HUD awal dari stats kapal.
    if (!me) {
      return {
        speed: 0,
        maxSpeed: def.maxSpeed,
        headingDeg: 90,
        hp: def.hp,
        maxHp: def.hp,
        dummyHp: this.foeDef.hp,
        dummyMaxHp: this.foeDef.hp,
        dummyVisible: false,
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
        abilityName: def.abilityName,
        shipName: def.name,
        dummyName: this.foeName,
        aimDist: -1,
        aimLead: -1,
        aimBlocked: false,
        aimOutOfRange: false,
      };
    }
    // Waktu game diestimasi dari snapshot terakhir + waktu berlalu.
    const gameTime =
      (this.curSnap?.t ?? 0) + (performance.now() - this.curRecvAt) / 1000;
    const reloadLeft = Math.max(0, def.reloadSeconds - (gameTime - me.lastFireAt));
    const abilityLeft = Math.max(0, me.abilityReadyAt - gameTime);
    let aimDist = -1;
    let aimLead = -1;
    let aimBlocked = false;
    let aimOutOfRange = false;
    const scene = this.scene;
    if (scene?.aimX != null && scene.aimZ != null) {
      aimDist = Math.hypot(scene.aimX - me.x, scene.aimZ - me.z);
      const v = def.shellSpeed;
      const maxRange = (v * v) / GRAVITY;
      aimOutOfRange = aimDist > maxRange;
      if (!aimOutOfRange) {
        const theta = 0.5 * Math.asin(Math.min(1, (GRAVITY * aimDist) / (v * v)));
        aimLead = aimDist / (v * Math.cos(theta));
      }
      aimBlocked =
        this.map !== null &&
        !hasLineOfSight(this.map.islands, me.x, me.z, scene.aimX, scene.aimZ);
    }
    const bx = foe?.x ?? 270;
    const bz = foe?.z ?? 0;
    return {
      speed: me.speed,
      maxSpeed: def.maxSpeed,
      headingDeg: ((me.heading * 180) / Math.PI + 360) % 360,
      hp: me.hp,
      maxHp: me.maxHp,
      dummyHp: foe?.hp ?? this.foeDef.hp,
      dummyMaxHp: foe?.maxHp ?? this.foeDef.hp,
      dummyVisible: this.foeVisible,
      px: me.x,
      pz: me.z,
      dx: bx,
      dz: bz,
      distance: Math.hypot(bx - me.x, bz - me.z),
      timeLeft: this.curSnap?.timeLeft ?? MATCH_DURATION,
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
      dummyName: this.foeName,
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
      if (!this.over) this.opts.onAbility();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    const p = this.scene?.screenToAim(e.clientX, e.clientY);
    if (p && this.scene) {
      this.scene.aimX = p.x;
      this.scene.aimZ = p.z;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      // Klik kiri: tembak ke titik aim (server yang memvalidasi reload).
      const aimX = this.scene?.aimX;
      const aimZ = this.scene?.aimZ;
      if (!this.over && aimX != null && aimZ != null) {
        this.opts.onFire(aimX, aimZ);
      }
    } else if (e.button === 2) {
      this.orbiting = true;
      this.lastOrbitX = e.clientX;
    }
  };

  private onOrbitMove = (e: MouseEvent): void => {
    if (!this.orbiting || !this.scene) return;
    this.scene.addOrbit((e.clientX - this.lastOrbitX) * 0.005);
    this.lastOrbitX = e.clientX;
  };

  private onMouseUp = (): void => {
    this.orbiting = false;
  };

  private onWheel = (e: WheelEvent): void => {
    this.scene?.addZoom(e.deltaY * 0.03);
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
    delete (window as unknown as { __navalRemote?: unknown }).__navalRemote;
    this.scene?.dispose();
    this.scene = null;
  }
}
