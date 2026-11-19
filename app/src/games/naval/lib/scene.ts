// Scene Three.js game naval: laut bergelombang, pulau low-poly, langit,
// awan, kamera third-person yang mengikuti kapal. Tanpa shadow map dan
// tanpa post-processing (target laptop kentang). Render di-interpolasi
// dari state sim (prev -> current, alpha 0..1) supaya gerak mulus 60fps.

import * as THREE from "three";
import { mulberry32 } from "../../../../../shared/game/prng";
import { Effects } from "./effects";
import { SINK_DURATION, waveHeight } from "./sim";
import { buildShipModel, type ShipModel } from "./shipModel";
import type { GameState, IslandDef, MapDef, ShipDef, ShipState, SimEvent } from "./types";

const SKY_COLOR = 0x9fd4f0;
const WATER_COLOR = 0x12b5a8;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function std(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

/** Satu pulau: pasir + batu + palem (seeded, deterministik). */
function buildIslandMesh(isl: IslandDef): THREE.Group {
  const rng = mulberry32(isl.seed);
  const g = new THREE.Group();
  const sand = new THREE.Mesh(new THREE.CircleGeometry(isl.radius * 1.12, 28), std(0xe6d3a1));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = 0.15;
  g.add(sand);

  const rockMat = std(0x8a8a84);
  const rockMat2 = std(0x6f6f68);
  // Batu utama: kerucut lebar + pendek (bukan piramida runcing) + topi rumput.
  const main = new THREE.Mesh(new THREE.ConeGeometry(isl.radius * 0.62, isl.height * 0.62, 9), rockMat);
  main.position.y = isl.height * 0.3;
  main.rotation.y = rng() * Math.PI;
  g.add(main);
  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(isl.radius * 0.4, isl.height * 0.16, 9),
    std(0x5a9e4d),
  );
  cap.position.y = isl.height * 0.58;
  cap.rotation.y = rng() * Math.PI;
  g.add(cap);
  const second = new THREE.Mesh(
    new THREE.ConeGeometry(isl.radius * 0.4, isl.height * 0.45, 7),
    rockMat2,
  );
  second.position.set(isl.radius * 0.3 * (rng() - 0.5) * 2, isl.height * 0.2, isl.radius * 0.3 * (rng() - 0.5) * 2);
  second.rotation.z = (rng() - 0.5) * 0.25;
  g.add(second);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.DodecahedronGeometry(isl.radius * 0.09 + rng() * 2, 0), rockMat2);
    const a = rng() * Math.PI * 2;
    const d = isl.radius * (0.55 + rng() * 0.4);
    b.position.set(Math.cos(a) * d, 0.8, Math.sin(a) * d);
    b.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(b);
  }

  // Palem: batang miring + 6 daun kerucut pipih.
  const palms = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < palms; i++) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 5.5, 6), std(0x7a5a3a));
    trunk.position.y = 2.7;
    trunk.rotation.z = 0.18;
    palm.add(trunk);
    const leafMat = std(rng() > 0.5 ? 0x3f9e4d : 0x57b25e);
    for (let l = 0; l < 6; l++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.0, 4), leafMat);
      leaf.scale.set(1, 1, 0.22);
      const ang = (l / 6) * Math.PI * 2;
      leaf.position.set(Math.cos(ang) * 1.2, 5.4, Math.sin(ang) * 1.2);
      leaf.rotation.set(Math.sin(ang) * 1.1, 0, -Math.cos(ang) * 1.1);
      palm.add(leaf);
    }
    const a = rng() * Math.PI * 2;
    const d = isl.radius * (0.35 + rng() * 0.35);
    palm.position.set(Math.cos(a) * d, 0.2, Math.sin(a) * d);
    palm.rotation.y = rng() * Math.PI * 2;
    g.add(palm);
  }

  g.position.set(isl.x, 0, isl.z);
  return g;
}

interface ShipMesh {
  model: ShipModel;
  shadow: THREE.Mesh;
  def: ShipDef;
  phase: number;
}

export class NavalScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private water!: THREE.Mesh;
  private waterPos!: THREE.BufferAttribute;
  private waterBase: { x: number; z: number }[] = [];
  private clouds: THREE.Group[] = [];
  private ships = new Map<string, ShipMesh>();
  private raycaster = new THREE.Raycaster();
  private waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private camPos = new THREE.Vector3();
  private camInit = false;
  private effects!: Effects;
  private shellMeshes: THREE.Mesh[] = [];
  private sinkSmokeT = 0;

  followId: string | null = null;
  // Default: seperempat kanan (starboard quarter) ala preview, bukan
  // tepat di belakang buritan.
  orbitYaw = 0.35;
  distance = 32;
  aimX: number | null = null;
  aimZ: number | null = null;

  constructor(container: HTMLElement, map: MapDef) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 280, 950);

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.5,
      2000,
    );
    this.camera.position.set(0, 30, -60);

    const sun = new THREE.DirectionalLight(0xfff2d9, 1.7);
    sun.position.set(180, 240, 120);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x2a6b8a, 1.25));

    // Laut: plane 72x72 segmen, vertex digoyang tiap frame (JS).
    const size = map.arenaRadius * 3.6;
    const geo = new THREE.PlaneGeometry(size, size, 72, 72);
    geo.rotateX(-Math.PI / 2);
    this.waterPos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.waterPos.count; i++) {
      this.waterBase.push({ x: this.waterPos.getX(i), z: this.waterPos.getZ(i) });
    }
    this.water = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: WATER_COLOR,
        roughness: 0.45,
        metalness: 0,
        flatShading: true,
      }),
    );
    this.scene.add(this.water);

    for (const isl of map.islands) this.scene.add(buildIslandMesh(isl));

    // Awan low-poly (gumpalan bola pipih), melayang pelan.
    const rng = mulberry32(99);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      flatShading: true,
      emissive: 0x555555,
    });
    for (let i = 0; i < 8; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(rng() * 3);
      for (let j = 0; j < n; j++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rng() * 8, 7, 6), cloudMat);
        puff.position.set(j * 9 - n * 4.5, rng() * 3, rng() * 6 - 3);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      cloud.position.set(rng() * 1200 - 600, 70 + rng() * 35, rng() * 1200 - 600);
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }

    this.effects = new Effects(this.scene);
    // Pool mesh peluru (bola hitam kecil, 12 cukup buat 2 volley bersamaan).
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
    const shellGeo = new THREE.SphereGeometry(0.55, 8, 8);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat);
      m.visible = false;
      this.scene.add(m);
      this.shellMeshes.push(m);
    }
  }

  addShip(id: string, def: ShipDef, opts: { enemy?: boolean } = {}): void {
    const model = buildShipModel(def, opts);
    model.group.rotation.order = "YXZ";
    this.scene.add(model.group);
    // Bayangan palsu: elips kecil di dalam footprint kapal (bukan noda besar).
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(def.beam * 0.62, def.length * 0.52, 1);
    shadow.position.y = 0.06;
    this.scene.add(shadow);
    this.ships.set(id, { model, shadow, def, phase: Math.random() * 10 });
  }

  removeShip(id: string): void {
    const m = this.ships.get(id);
    if (!m) return;
    this.scene.remove(m.model.group);
    this.scene.remove(m.shadow);
    this.ships.delete(id);
  }

  /** Titik di permukaan air dari posisi kursor (buat aim). */
  screenToWater(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.waterPlane, p)) return null;
    return { x: p.x, z: p.z };
  }

  /**
   * Titik bidik dari posisi kursor. Kalau sinar mouse menembus silinder
   * sebuah kapal (lambung + tiang), bidikan menempel ke tengah kapal itu.
   * Tanpa ini, membidik lambung kapal (di atas air) membuat peluru jatuh
   * puluhan meter di balik kapal (paralaks ketinggian).
   */
  screenToAim(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const ray = this.raycaster.ray;
    // Uji tiap kapal musuh: sinar vs silinder vertikal (radius kapal,
    // tinggi 22 m). Kapal sendiri (yang diikuti kamera) dikecualikan,
    // karena sinar bidik selalu melewati tiangnya.
    let bestT = Infinity;
    let best: { x: number; z: number } | null = null;
    for (const [id, m] of this.ships) {
      if (id === this.followId) continue;
      const cx = m.model.group.position.x;
      const cz = m.model.group.position.z;
      const r = m.def.radius;
      const ox = ray.origin.x - cx;
      const oz = ray.origin.z - cz;
      const dx = ray.direction.x;
      const dz = ray.direction.z;
      const a = dx * dx + dz * dz;
      if (a < 1e-9) continue;
      const b = 2 * (ox * dx + oz * dz);
      const c = ox * ox + oz * oz - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / (2 * a);
      if (t < 0) t = (-b + sq) / (2 * a);
      if (t < 0 || t >= bestT) continue;
      const y = ray.origin.y + t * ray.direction.y;
      if (y < 0 || y > 22) continue;
      bestT = t;
      best = { x: cx, z: cz };
    }
    if (best) return best;
    const p = new THREE.Vector3();
    if (!ray.intersectPlane(this.waterPlane, p)) return null;
    return { x: p.x, z: p.z };
  }

  /** Mainkan efek visual untuk satu event simulasi. */
  playEvent(ev: SimEvent): void {
    switch (ev.type) {
      case "fire":
        this.effects.muzzleFlash(ev.x, ev.y, ev.z);
        break;
      case "hit":
        this.effects.explosion(ev.x, ev.y, ev.z);
        break;
      case "splash":
        this.effects.splash(ev.x, ev.z);
        break;
      case "island-hit":
        this.effects.islandHit(ev.x, ev.y, ev.z);
        break;
      case "sink-start": {
        const m = this.ships.get(ev.shipId);
        if (m) {
          this.effects.explosion(m.model.group.position.x, 2, m.model.group.position.z);
        }
        break;
      }
      case "sunk": {
        const m = this.ships.get(ev.shipId);
        if (m) {
          this.effects.splash(m.model.group.position.x, m.model.group.position.z);
        }
        break;
      }
      case "bump": {
        const m = this.ships.get(ev.shipId);
        if (m) {
          const g = m.model.group.position;
          this.effects.splash(g.x, g.z);
        }
        break;
      }
    }
  }

  /** Proyeksikan titik 3D ke koordinat pixel layar (buat angka damage). */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null; // di belakang kamera
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((v.x + 1) / 2) * rect.width + rect.left,
      y: ((-v.y + 1) / 2) * rect.height + rect.top,
    };
  }

  addOrbit(dYaw: number): void {
    this.orbitYaw += dYaw;
  }

  addZoom(d: number): void {
    this.distance = Math.max(20, Math.min(70, this.distance + d));
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private syncShip(ship: ShipState, alpha: number, time: number): void {
    const m = this.ships.get(ship.id);
    if (!m) return;
    const x = ship.prevX + (ship.x - ship.prevX) * alpha;
    const z = ship.prevZ + (ship.z - ship.prevZ) * alpha;
    const heading = lerpAngle(ship.prevHeading, ship.heading, alpha);
    const sinkP = ship.sinking ? Math.min(1, ship.sinkTime / SINK_DURATION) : 0;

    // Goyangan ombak: naik-turun + angguk dari kemiringan gelombang.
    const w = waveHeight(x, z, time);
    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const slopeF =
      (waveHeight(x + fwdX * 3, z + fwdZ * 3, time) - waveHeight(x - fwdX * 3, z - fwdZ * 3, time)) / 6;
    const slopeR =
      (waveHeight(x + rightX * 3, z + rightZ * 3, time) - waveHeight(x - rightX * 3, z - rightZ * 3, time)) / 6;

    const g = m.model.group;
    g.position.set(x, w * 0.55 - sinkP * sinkP * 7, z);
    g.rotation.y = heading;
    g.rotation.x = -slopeF * 0.5 + sinkP * 0.22;
    g.rotation.z = ship.heel - slopeR * 0.5 + sinkP * 1.05;
    g.visible = sinkP < 1;

    // Bayangan palsu di air (tetap datar, memudar saat tenggelam).
    m.shadow.position.set(x, 0.06, z);
    m.shadow.rotation.z = heading;
    (m.shadow.material as THREE.MeshBasicMaterial).opacity = 0.18 * (1 - sinkP);
    m.shadow.visible = sinkP < 1;

    // Turet mengikuti titik aim (relatif terhadap haluan kapal).
    if (this.aimX !== null && this.aimZ !== null && !ship.sinking) {
      const want = Math.atan2(this.aimX - x, this.aimZ - z) - heading;
      m.model.turret.rotation.y = lerpAngle(m.model.turret.rotation.y, want, 0.12);
    }

    // Bendera berkibar.
    m.model.flag.rotation.y = Math.sin(time * 2.5 + m.phase) * 0.28;
  }

  private syncCamera(dt: number): void {
    if (!this.followId) return;
    const m = this.ships.get(this.followId);
    if (!m) return;
    const g = m.model.group;
    const heading = g.rotation.y + this.orbitYaw;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const target = new THREE.Vector3(g.position.x, 3, g.position.z);
    const desired = new THREE.Vector3(
      target.x - fx * this.distance,
      target.y + this.distance * 0.35,
      target.z - fz * this.distance,
    );
    desired.y = Math.max(5, desired.y);
    if (!this.camInit) {
      this.camPos.copy(desired);
      this.camInit = true;
    } else {
      const k = 1 - Math.exp(-4 * dt);
      this.camPos.lerp(desired, k);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(target.x + fx * 6, 2, target.z + fz * 6);
  }

  /** Render satu frame: sinkron state sim + gambar. */
  render(state: GameState, alpha: number, time: number, dt: number): void {
    // Laut bergelombang.
    for (let i = 0; i < this.waterPos.count; i++) {
      const b = this.waterBase[i]!;
      this.waterPos.setY(i, waveHeight(b.x, b.z, time));
    }
    this.waterPos.needsUpdate = true;

    for (const ship of state.ships) this.syncShip(ship, alpha, time);

    // Peluru: sinkron mesh pool dengan state sim (interpolasi kasar: posisi
    // saat ini, karena peluru cepat dan step 20 Hz cukup rapat).
    const aliveShells = state.shells.filter((s) => s.alive);
    for (let i = 0; i < this.shellMeshes.length; i++) {
      const mesh = this.shellMeshes[i]!;
      const sh = aliveShells[i];
      if (sh) {
        mesh.visible = true;
        mesh.position.set(sh.x, sh.y, sh.z);
      } else {
        mesh.visible = false;
      }
    }

    // Asap kapal yang sedang tenggelam (tiap ~0,25 d).
    this.sinkSmokeT += dt;
    if (this.sinkSmokeT > 0.25) {
      this.sinkSmokeT = 0;
      for (const ship of state.ships) {
        if (ship.sinking) this.effects.sinkingSmoke(ship.x, ship.z);
      }
    }
    this.effects.update(dt);

    // Awan melayang pelan, bungkus di tepi.
    for (const c of this.clouds) {
      c.position.x += dt * 1.5;
      if (c.position.x > 700) c.position.x = -700;
    }

    this.syncCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.effects.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
