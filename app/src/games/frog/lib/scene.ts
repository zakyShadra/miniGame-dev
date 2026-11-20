// Scene Three.js game katak: bengkel penyihir hangat (lantai kayu,
// rak buku, lilin, ramuan, jamur, kaca patri). Tanpa shadow map dan
// post-processing (target laptop kentang); dekor berulang pakai
// InstancedMesh. Render di-interpolasi dari state sim (alpha 0..1).

import * as THREE from "three";
import { mulberry32 } from "../../../../../shared/game/prng";
import { TONGUE_FLY_TIME } from "../../../../../shared/frog/sim";
import { buildFrogModel, type FrogModel } from "./frogModel";
import type { FrogGameState, LevelDef } from "../../../../../shared/frog/types";

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function std(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** Tekstur papan kayu digambar di canvas (tanpa file eksternal). */
function woodTexture(base: string, dark: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(7);
  for (let row = 0; row < 4; row++) {
    const y = row * 64;
    g.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.08})`;
    g.fillRect(0, y, 256, 64);
    g.strokeStyle = dark;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
    // Serat kayu: garis bergelombang samar.
    g.strokeStyle = "rgba(0,0,0,0.08)";
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const gy = y + 8 + rng() * 48;
      g.beginPath();
      g.moveTo(0, gy);
      g.bezierCurveTo(80, gy + 4, 170, gy - 4, 256, gy);
      g.stroke();
    }
    // Sambungan papan (staggered).
    const jx = ((row * 97) % 256) + 30;
    g.strokeStyle = dark;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(jx, y);
    g.lineTo(jx, y + 64);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Kaca patri: petak warna-warni dengan bingkai timah gelap. */
function stainedGlassTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 192;
  const g = c.getContext("2d")!;
  const colors = ["#e84a5f", "#f2a541", "#4da6ff", "#57b25e", "#b8a4ed", "#ff8c42"];
  const rng = mulberry32(21);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = colors[Math.floor(rng() * colors.length)]!;
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  g.strokeStyle = "#2a2018";
  g.lineWidth = 4;
  for (let y = 0; y <= 6; y++) {
    g.beginPath();
    g.moveTo(0, y * 32);
    g.lineTo(128, y * 32);
    g.stroke();
  }
  for (let x = 0; x <= 4; x++) {
    g.beginPath();
    g.moveTo(x * 32, 0);
    g.lineTo(x * 32, 192);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface FlyMesh {
  group: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  baseY: number;
  phase: number;
  id: string;
}

const BOOK_COLORS = [0xc0392b, 0x2e7d6f, 0xe8b94a, 0x5b7db1, 0x8b5cf6, 0xd97b4f, 0x3f9e4d];
const BOTTLE_COLORS = [0xff5c85, 0x4da6ff, 0x57d98a, 0xf2a541, 0xb8a4ed];

export class FrogScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private frog: FrogModel;
  private frogYaw = Math.PI;
  private flies: FlyMesh[] = [];
  private portalRing!: THREE.Mesh;
  private anchorRings: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private camPos = new THREE.Vector3();
  private camInit = false;
  private landSquash = 0;
  private hopPhase = 0;

  /** Orbit kamera (radian, 0 = kamera di +z katak). */
  orbitYaw = 0;
  distance = 8.5;

  constructor(container: HTMLElement, level: LevelDef) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x2a1f16);
    this.scene.fog = new THREE.Fog(0x2a1f16, 30, 85);
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      200,
    );
    this.camera.position.set(0, 6, 14);

    // Cahaya hangat bengkel: 1 hemisphere + 1 directional + 2 point.
    this.scene.add(new THREE.HemisphereLight(0xffe8c8, 0x4a3421, 1.25));
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.9);
    sun.position.set(10, 18, 8);
    this.scene.add(sun);
    const candleGlow = new THREE.PointLight(0xff9a3d, 14, 20, 2);
    candleGlow.position.set(0, 3, 0);
    this.scene.add(candleGlow);
    const goalGlow = new THREE.PointLight(0x7dffc8, 10, 14, 2);
    goalGlow.position.set(level.goal.pos.x, level.goal.pos.y + 2, level.goal.pos.z);
    this.scene.add(goalGlow);

    // Lantai bawah (dekoratif, di bawah jurang): kayu gelap.
    const woodTex = woodTexture("#7a5230", "#5a3a20");
    woodTex.repeat.set(10, 12);
    const lowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 56),
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.95 }),
    );
    lowFloor.rotation.x = -Math.PI / 2;
    lowFloor.position.set(0, -5, -14);
    this.scene.add(lowFloor);

    // Dinding: belakang + kiri + kanan (plester hangat + panel kayu bawah).
    const wallMat = std(0x8a6a45, 0.95);
    const panelMat = std(0x5a3a20, 0.9);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(44, 10, 0.6), wallMat);
    backWall.position.set(0, 5, -39.5);
    this.scene.add(backWall);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, 54), wallMat);
      wall.position.set(side * 18.3, 5, -14);
      this.scene.add(wall);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 54), panelMat);
      panel.position.set(side * 17.9, 1.2, -14);
      this.scene.add(panel);
    }
    // Kaca patri di dinding belakang (emissive, bercahaya).
    const glassTex = stainedGlassTexture();
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 7.5),
      new THREE.MeshStandardMaterial({
        map: glassTex,
        emissive: 0xffffff,
        emissiveMap: glassTex,
        emissiveIntensity: 0.55,
        roughness: 0.4,
      }),
    );
    glass.position.set(0, 5.5, -39.1);
    this.scene.add(glass);

    // Platform level: balok kayu + papan atas lebih terang.
    const platTex = woodTexture("#8a5f36", "#6a4526");
    const platMat = new THREE.MeshStandardMaterial({ map: platTex, roughness: 0.9 });
    const topMat = std(0xa67c4a, 0.85);
    for (const p of level.platforms) {
      const w = p.max.x - p.min.x;
      const h = p.max.y - p.min.y;
      const d = p.max.z - p.min.z;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), platMat);
      box.position.set((p.min.x + p.max.x) / 2, (p.min.y + p.max.y) / 2, (p.min.z + p.max.z) / 2);
      this.scene.add(box);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.14, d + 0.3), topMat);
      top.position.set((p.min.x + p.max.x) / 2, p.max.y + 0.02, (p.min.z + p.max.z) / 2);
      this.scene.add(top);
    }

    // Balok langit-langit di atas jurang + kait anchor.
    const beamMat = std(0x4a3220, 0.9);
    for (const a of level.anchors) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 0.6), beamMat);
      beam.position.set(a.pos.x, 8.6, a.pos.z);
      this.scene.add(beam);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 8.6 - a.pos.y, 6), std(0x9a7a4a));
      rope.position.set(a.pos.x, (8.6 + a.pos.y) / 2, a.pos.z);
      this.scene.add(rope);
      // Lentera gantung: sangkar + bola cahaya.
      const cage = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.34), std(0x2a2a2e, 0.6));
      cage.position.copy(a.pos);
      this.scene.add(cage);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 8, 8),
        new THREE.MeshStandardMaterial({ color: "#ffd97a", emissive: "#ffb347", emissiveIntensity: 1.6 }),
      );
      bulb.position.copy(a.pos);
      this.scene.add(bulb);
      // Cincin target (berdenyut, penanda tempel lidah).
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.05, 8, 24),
        new THREE.MeshStandardMaterial({ color: "#ffd97a", emissive: "#ff9a2e", emissiveIntensity: 1.2 }),
      );
      ring.position.copy(a.pos);
      this.scene.add(ring);
      this.anchorRings.push(ring);
    }

    this.buildShelves();
    this.buildCandles(level);
    this.buildBottles();
    this.buildMushrooms();
    this.buildGoal(level);
    this.buildFlies(level);

    // Katak pemain (oranye di F1). Lidah dipindah ke scene supaya
    // koordinat dunia-nya tidak ikut rotasi badan katak.
    this.frog = buildFrogModel("orange");
    this.scene.add(this.frog.group);
    this.scene.add(this.frog.tongue);
  }

  /** Rak buku di dinding kiri/kanan + buku instanced (1 draw call). */
  private buildShelves(): void {
    const rng = mulberry32(99);
    const shelfMat = std(0x4a3220, 0.9);
    const shelfSpots: { x: number; z: number; ry: number }[] = [
      { x: -17.4, z: -30, ry: Math.PI / 2 },
      { x: -17.4, z: -16, ry: Math.PI / 2 },
      { x: -17.4, z: -2, ry: Math.PI / 2 },
      { x: 17.4, z: -24, ry: -Math.PI / 2 },
      { x: 17.4, z: -10, ry: -Math.PI / 2 },
      { x: 17.4, z: 4, ry: -Math.PI / 2 },
    ];
    const bookMats: THREE.Matrix4[] = [];
    const bookCols: THREE.Color[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const s of shelfSpots) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5.4, 7), shelfMat);
      frame.position.set(s.x, 2.7, s.z);
      this.scene.add(frame);
      for (let row = 0; row < 4; row++) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 6.6), shelfMat);
        board.position.set(s.x, 0.7 + row * 1.25, s.z);
        this.scene.add(board);
        // 8 buku per baris, tinggi + warna acak, menghadap ke tengah.
        const faceX = s.x + (s.x < 0 ? 0.45 : -0.45);
        for (let i = 0; i < 8; i++) {
          const h = 0.7 + rng() * 0.35;
          const lean = (rng() - 0.5) * 0.12;
          e.set(0, 0, lean);
          q.setFromEuler(e);
          m.compose(
            new THREE.Vector3(faceX, 0.76 + row * 1.25 + h / 2, s.z - 2.8 + i * 0.8),
            q,
            new THREE.Vector3(0.45, h, 0.55),
          );
          bookMats.push(m.clone());
          bookCols.push(new THREE.Color(BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)]!));
        }
      }
    }
    const books = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      bookMats.length,
    );
    bookMats.forEach((mat, i) => {
      books.setMatrixAt(i, mat);
      books.setColorAt(i, bookCols[i]!);
    });
    books.instanceMatrix.needsUpdate = true;
    if (books.instanceColor) books.instanceColor.needsUpdate = true;
    this.scene.add(books);
  }

  /** Lilin di tepi platform (badan + api instanced, 2 draw call). */
  private buildCandles(level: LevelDef): void {
    const rng = mulberry32(31);
    const spots: { x: number; y: number; z: number }[] = [];
    for (const p of level.platforms) {
      spots.push({ x: p.min.x + 0.6, y: p.max.y, z: p.min.z + 0.6 });
      spots.push({ x: p.max.x - 0.6, y: p.max.y, z: p.max.z - 0.6 });
    }
    const wax = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.5, 8),
      std(0xf5ead0, 0.7),
      spots.length,
    );
    const flames = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshStandardMaterial({ color: "#ffd97a", emissive: "#ff9a2e", emissiveIntensity: 2 }),
      spots.length,
    );
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      const h = 0.4 + rng() * 0.3;
      m.makeScale(1, h / 0.5, 1);
      m.setPosition(s.x, s.y + h / 2, s.z);
      wax.setMatrixAt(i, m);
      m.makeScale(1, 1.4, 1);
      m.setPosition(s.x, s.y + h + 0.12, s.z);
      flames.setMatrixAt(i, m);
    });
    wax.instanceMatrix.needsUpdate = true;
    flames.instanceMatrix.needsUpdate = true;
    this.scene.add(wax);
    this.scene.add(flames);
  }

  /** Botol ramuan di meja samping spawn (1 draw call instanced). */
  private buildBottles(): void {
    const rng = mulberry32(55);
    const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 1.4), std(0x4a3220, 0.9));
    table.position.set(-5.5, 1.05, 6.5);
    this.scene.add(table);
    for (const [dx, dz] of [[-1.3, -0.5], [1.3, -0.5], [-1.3, 0.5], [1.3, 0.5]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), std(0x4a3220, 0.9));
      leg.position.set(-5.5 + dx, 0.52, 6.5 + dz);
      this.scene.add(leg);
    }
    const bottles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ roughness: 0.25, emissiveIntensity: 0.35 }),
      8,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Color(BOTTLE_COLORS[i % BOTTLE_COLORS.length]!);
      m.makeScale(1, 1.25, 1);
      m.setPosition(-6.6 + (i % 4) * 0.75, 1.4, 6.5 + (i < 4 ? -0.3 : 0.3));
      bottles.setMatrixAt(i, m);
      bottles.setColorAt(i, c);
    }
    bottles.instanceMatrix.needsUpdate = true;
    if (bottles.instanceColor) bottles.instanceColor.needsUpdate = true;
    this.scene.add(bottles);
  }

  /** Jamur di sudut lantai (batang + tudung instanced, 2 draw call). */
  private buildMushrooms(): void {
    const rng = mulberry32(77);
    const spots: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const left = rng() > 0.5;
      spots.push({
        x: (left ? -1 : 1) * (13 + rng() * 4),
        z: -36 + rng() * 42,
        s: 0.5 + rng() * 0.8,
      });
    }
    const stems = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.16, 0.5, 8),
      std(0xf5ead0, 0.8),
      spots.length,
    );
    const caps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.32, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      std(0xc0392b, 0.7),
      spots.length,
    );
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      // Jamur tumbuh di lantai bawah (y=-5) dekat dinding.
      m.makeScale(s.s, s.s, s.s);
      m.setPosition(s.x, -5 + 0.25 * s.s, s.z);
      stems.setMatrixAt(i, m);
      m.makeScale(s.s, s.s * 0.8, s.s);
      m.setPosition(s.x, -5 + 0.5 * s.s, s.z);
      caps.setMatrixAt(i, m);
    });
    stems.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    this.scene.add(stems);
    this.scene.add(caps);
  }

  /** Goal: lily pad + portal bercahaya + berkas cahaya. */
  private buildGoal(level: LevelDef): void {
    const g = level.goal.pos;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.1, 0.16, 24),
      std(0x3f9e4d, 0.8),
    );
    pad.position.set(g.x, g.y + 0.12, g.z);
    this.scene.add(pad);
    this.portalRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.12, 10, 32),
      new THREE.MeshStandardMaterial({ color: "#7dffc8", emissive: "#2ee6a8", emissiveIntensity: 1.4 }),
    );
    this.portalRing.position.set(g.x, g.y + 1.6, g.z);
    this.scene.add(this.portalRing);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 7, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x7dffc8,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    beam.position.set(g.x, g.y + 3.5, g.z);
    this.scene.add(beam);
  }

  private buildFlies(level: LevelDef): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: "#2a2a2e", roughness: 0.5, emissive: "#f2a541", emissiveIntensity: 0.4 });
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(0.22, 0.12);
    for (const f of level.flies) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), bodyMat);
      group.add(body);
      const wingL = new THREE.Mesh(wingGeo, wingMat);
      wingL.position.set(-0.1, 0.08, 0);
      wingL.rotation.z = 0.5;
      group.add(wingL);
      const wingR = new THREE.Mesh(wingGeo, wingMat);
      wingR.position.set(0.1, 0.08, 0);
      wingR.rotation.z = -0.5;
      group.add(wingR);
      group.position.copy(f.pos);
      this.scene.add(group);
      this.flies.push({ group, wingL, wingR, baseY: f.pos.y, phase: Math.random() * 6, id: f.id });
    }
  }

  /** Arah bidik lidah dari posisi kursor (sinar kamera). */
  screenToAimDir(clientX: number, clientY: number): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    return this.raycaster.ray.direction.clone();
  }

  /** Proyeksikan titik 3D ke pixel layar (buat bubble kroak). */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
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
    this.distance = Math.max(5, Math.min(13, this.distance + d));
  }

  /** Yaw kamera saat ini (dipakai input WASD relatif kamera). */
  get cameraYaw(): number {
    return this.orbitYaw;
  }

  /** Stat render buat QA (draw call + segitiga frame terakhir). */
  getStats(): { calls: number; triangles: number } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  /** Event sim ke efek visual (saat ini: squash saat mendarat). */
  playEvent(type: string): void {
    if (type === "land") this.landSquash = 0.16;
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private syncFrog(state: FrogGameState, alpha: number, dt: number): void {
    const f = state.frog;
    const x = f.prevPos.x + (f.pos.x - f.prevPos.x) * alpha;
    const y = f.prevPos.y + (f.pos.y - f.prevPos.y) * alpha;
    const z = f.prevPos.z + (f.pos.z - f.prevPos.z) * alpha;
    const g = this.frog.group;
    // Hop bob: badan naik-turun kecil saat bergerak di tanah.
    const hSpeed = Math.hypot(f.vel.x, f.vel.z);
    let bob = 0;
    if (f.onGround && hSpeed > 0.5) {
      this.hopPhase += dt * hSpeed * 1.6;
      bob = Math.abs(Math.sin(this.hopPhase)) * 0.06;
    }
    g.position.set(x, y + bob, z);
    this.frogYaw = lerpAngle(this.frogYaw, f.facing, 1 - Math.exp(-12 * dt));
    g.rotation.y = this.frogYaw;

    // Squash and stretch: memanjang saat melayang, gepeng saat mendarat.
    this.landSquash = Math.max(0, this.landSquash - dt);
    let sy = 1;
    if (this.landSquash > 0) sy = 0.78;
    else if (!f.onGround && Math.abs(f.vel.y) > 2) sy = 1.12;
    else if (f.onGround && hSpeed > 0.5) sy = 1 + Math.sin(this.hopPhase) * 0.03;
    const sxz = 1 / Math.sqrt(sy);
    this.frog.body.scale.set(sxz, sy, sxz);

    // Lidah: terbang (ujung merayap ke anchor) atau nempel.
    const t = state.tongue;
    if ((t.mode === "flying" || t.mode === "attached") && t.anchor) {
      const mouth = new THREE.Vector3(x, y + 0.62, z);
      const target = new THREE.Vector3(t.anchor.x, t.anchor.y, t.anchor.z);
      if (t.mode === "flying") {
        const p = 1 - t.flyTime / TONGUE_FLY_TIME;
        target.lerpVectors(mouth, target, Math.max(0, Math.min(1, p)));
      }
      this.frog.setTongue(mouth, target);
    } else {
      this.frog.hideTongue();
    }
  }

  private syncCamera(dt: number, target: THREE.Vector3): void {
    // Kamera di belakang katak relatif orbitYaw (0 = dari +z).
    const yaw = this.orbitYaw;
    const pitch = 0.42;
    const dx = Math.sin(yaw) * Math.cos(pitch);
    const dz = Math.cos(yaw) * Math.cos(pitch);
    const dy = Math.sin(pitch);
    const desired = new THREE.Vector3(
      target.x + dx * this.distance,
      target.y + 1 + dy * this.distance,
      target.z + dz * this.distance,
    );
    desired.y = Math.max(0.8, desired.y);
    if (!this.camInit) {
      this.camPos.copy(desired);
      this.camInit = true;
    } else {
      this.camPos.lerp(desired, 1 - Math.exp(-6 * dt));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(target.x, target.y + 1.1, target.z);
  }

  /** Render satu frame: sinkron state sim + gambar. */
  render(state: FrogGameState, alpha: number, time: number, dt: number): void {
    this.syncFrog(state, alpha, dt);

    // Lalat: melayang naik-turun + sayap mengepak; hilang saat dimakan.
    for (const fly of this.flies) {
      const eaten = state.fliesGot.includes(fly.id);
      fly.group.visible = !eaten;
      if (eaten) continue;
      fly.group.position.y = fly.baseY + Math.sin(time * 3 + fly.phase) * 0.15;
      fly.group.rotation.y = time * 0.8 + fly.phase;
      const flap = Math.sin(time * 40 + fly.phase) * 0.5;
      fly.wingL.rotation.z = 0.5 + flap;
      fly.wingR.rotation.z = -0.5 - flap;
    }

    // Cincin anchor berdenyut + portal berputar pelan.
    const pulse = 1 + Math.sin(time * 3) * 0.08;
    for (const ring of this.anchorRings) {
      ring.scale.setScalar(pulse);
      ring.lookAt(this.camera.position);
    }
    this.portalRing.rotation.z = time * 0.4;

    const f = state.frog;
    this.syncCamera(dt, new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z));
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
