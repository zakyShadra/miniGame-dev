// Scene Three.js game katak: bengkel penyihir hangat (lantai kayu,
// rak buku, lilin, ramuan, jamur, kaca patri). Tanpa shadow map dan
// post-processing (target laptop kentang); dekor berulang pakai
// InstancedMesh. Render di-interpolasi dari state sim (alpha 0..1).
// Dinding + lantai bawah dihitung dari bounds level (level co-op lebih
// panjang dari level solo). Co-op (F2): katak ke-2, pintu geser, dan
// tombol lantai dirender lewat renderRemote. F3: tema per level
// (sewer/library/garden), platform bergerak, dan jamur lompat.

import * as THREE from "three";
import { mulberry32 } from "../../../../../shared/game/prng";
import { TONGUE_FLY_TIME, moverOffset } from "../../../../../shared/frog/sim";
import { buildFrogModel, type FrogModel } from "./frogModel";
import type {
  FrogColor,
  FrogGameState,
  FrogState,
  FrogTheme,
  LevelDef,
  TongueState,
} from "../../../../../shared/frog/types";

/** Satu katak yang dirender (posisi + lidah dari sim / snapshot). */
export interface FrogRenderState {
  frog: FrogState;
  tongue: TongueState;
}

/** View co-op buat renderRemote (dari game remote, bukan sim lokal). */
export interface FrogRemoteView {
  me: FrogRenderState;
  partner: FrogRenderState | null;
  fliesGot: string[];
  usedAnchors: string[];
  doorOpen: boolean;
  /** Id tombol yang sedang tertekan (dihitung client dari posisi katak). */
  pressedButtons: string[];
}

/** Slot render satu katak (model + state animasi squash/hop). */
interface FrogSlot {
  model: FrogModel;
  yaw: number;
  squash: number;
  hop: number;
}

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

/** Palet + dekor per tema level (F3). */
interface FrogThemeCfg {
  bg: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunInt: number;
  wall: number;
  panel: number;
  /** Lantai bawah: kayu, air (selokan), rumput (taman). */
  floor: "wood" | "water" | "grass";
  /** Warna sisi platform (null = tekstur kayu). */
  platSide: number | null;
  platTop: number;
  /** Platform = buku raksasa (warna sampul bersiklus). */
  books: boolean;
  shelves: boolean;
  candles: boolean;
  bottles: boolean;
  mushrooms: boolean;
  orbs: boolean;
}

const THEMES: Record<FrogTheme, FrogThemeCfg> = {
  workshop: { bg: 0x2a1f16, hemiSky: 0xffe8c8, hemiGround: 0x4a3421, sun: 0xffd9a0, sunInt: 1.9, wall: 0x8a6a45, panel: 0x5a3a20, floor: "wood", platSide: null, platTop: 0xa67c4a, books: false, shelves: true, candles: true, bottles: true, mushrooms: true, orbs: false },
  sewer: { bg: 0x0a1f1c, hemiSky: 0x9ad8c8, hemiGround: 0x0a2a22, sun: 0x7fd8b8, sunInt: 1.1, wall: 0x2a3a34, panel: 0x1a2a24, floor: "water", platSide: 0x3a4a42, platTop: 0x5a7a5a, books: false, shelves: false, candles: false, bottles: false, mushrooms: false, orbs: true },
  library: { bg: 0x1f1a2e, hemiSky: 0xd8ccff, hemiGround: 0x2a2438, sun: 0xffe8c8, sunInt: 1.6, wall: 0x3a3350, panel: 0x2a2438, floor: "wood", platSide: null, platTop: 0xf5ead0, books: true, shelves: true, candles: true, bottles: false, mushrooms: false, orbs: false },
  garden: { bg: 0x14240f, hemiSky: 0xc8f0a8, hemiGround: 0x1a3016, sun: 0xfff0b8, sunInt: 1.7, wall: 0x2a3a22, panel: 0x1a2a16, floor: "grass", platSide: 0x4a3520, platTop: 0x5a8a3a, books: false, shelves: false, candles: false, bottles: false, mushrooms: true, orbs: false },
};

export class FrogScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private level: LevelDef;
  private slot0: FrogSlot;
  private slot1: FrogSlot | null = null;
  private flies: FlyMesh[] = [];
  private portalRing!: THREE.Mesh;
  private anchorVisuals: { id: string; ring: THREE.Mesh; bulb: THREE.Mesh }[] = [];
  private doorGroup: THREE.Group | null = null;
  private doorY = 0;
  private buttonDomes: { id: string; mat: THREE.MeshStandardMaterial }[] = [];
  /** Mesh platform bergerak + posisi dasarnya (F3). */
  private moverMeshes: { id: string; box: THREE.Mesh; top: THREE.Mesh; baseX: number; baseZ: number }[] = [];
  /** Jamur lompat (F3): grup + sisa waktu animasi gepeng. */
  private bounceShrooms: { id: string; group: THREE.Group; squash: number; phase: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private camPos = new THREE.Vector3();
  private camInit = false;

  /** Orbit kamera (radian, 0 = kamera di +z katak). */
  orbitYaw = 0;
  distance = 8.5;

  constructor(container: HTMLElement, level: LevelDef, myColor: FrogColor = "orange") {
    this.container = container;
    this.level = level;
    const theme = THEMES[level.theme ?? "workshop"];
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(theme.bg);
    this.scene.fog = new THREE.Fog(theme.bg, 30, 85);
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      200,
    );
    this.camera.position.set(0, 6, 14);

    // Cahaya tema: 1 hemisphere + 1 directional + 2 point.
    this.scene.add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, 1.25));
    const sun = new THREE.DirectionalLight(theme.sun, theme.sunInt);
    sun.position.set(10, 18, 8);
    this.scene.add(sun);
    const candleGlow = new THREE.PointLight(0xff9a3d, 14, 20, 2);
    candleGlow.position.set(0, 3, 0);
    this.scene.add(candleGlow);
    const goalGlow = new THREE.PointLight(0x7dffc8, 10, 14, 2);
    goalGlow.position.set(level.goal.pos.x, level.goal.pos.y + 2, level.goal.pos.z);
    this.scene.add(goalGlow);

    // Lantai bawah (dekoratif, di bawah jurang). Ukuran dari bounds
    // level. Air selokan di y=-3 (katak tenggelam sedikit sebelum
    // respawn di killY -4); kayu/rumput di y=-5.
    const b = level.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const roomW = b.maxX - b.minX + 8;
    const roomD = b.maxZ - b.minZ + 8;
    let lowMat: THREE.Material;
    let lowY = -5;
    if (theme.floor === "water") {
      lowMat = new THREE.MeshStandardMaterial({
        color: 0x1a5a4a,
        emissive: 0x0a3a2a,
        emissiveIntensity: 0.6,
        roughness: 0.25,
        metalness: 0.1,
        transparent: true,
        opacity: 0.92,
      });
      lowY = -3;
    } else if (theme.floor === "grass") {
      lowMat = std(0x2a4a22, 1);
    } else {
      const woodTex = woodTexture("#7a5230", "#5a3a20");
      woodTex.repeat.set(10, 12);
      lowMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.95 });
    }
    const lowFloor = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), lowMat);
    lowFloor.rotation.x = -Math.PI / 2;
    lowFloor.position.set(cx, lowY, cz);
    this.scene.add(lowFloor);

    // Dinding: belakang + kiri + kanan.
    const wallMat = std(theme.wall, 0.95);
    const panelMat = std(theme.panel, 0.9);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(roomW, 10, 0.6), wallMat);
    backWall.position.set(cx, 5, b.minZ - 0.5);
    this.scene.add(backWall);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, roomD - 4), wallMat);
      wall.position.set(side < 0 ? b.minX - 0.3 : b.maxX + 0.3, 5, cz);
      this.scene.add(wall);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, roomD - 4), panelMat);
      panel.position.set(side < 0 ? b.minX + 0.1 : b.maxX - 0.1, 1.2, cz);
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
    glass.position.set(cx, 5.5, b.minZ - 0.1);
    this.scene.add(glass);

    // Platform level: balok + papan atas lebih terang. Pintu co-op
    // dirender sebagai gerbang besi dalam grup sendiri (bisa meluncur
    // ke bawah saat terbuka). Library: platform = buku raksasa
    // (sampul berwarna bersiklus + halaman krem).
    const platTex = woodTexture("#8a5f36", "#6a4526");
    const platMat = new THREE.MeshStandardMaterial({ map: platTex, roughness: 0.9 });
    const topMat = std(theme.platTop, 0.85);
    const sideMat = theme.platSide !== null ? std(theme.platSide, 0.9) : platMat;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x6a7a8a, roughness: 0.45, metalness: 0.6 });
    const moverIds = new Set((level.movers ?? []).map((m) => m.platformId));
    let bookIdx = 0;
    for (const p of level.platforms) {
      const w = p.max.x - p.min.x;
      const h = p.max.y - p.min.y;
      const d = p.max.z - p.min.z;
      const isDoor = level.door?.platformId === p.id;
      const side = isDoor
        ? doorMat
        : theme.books
          ? std(BOOK_COLORS[bookIdx++ % BOOK_COLORS.length]!, 0.85)
          : sideMat;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), side);
      box.position.set((p.min.x + p.max.x) / 2, (p.min.y + p.max.y) / 2, (p.min.z + p.max.z) / 2);
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.3, 0.14, d + 0.3),
        isDoor ? doorMat : topMat,
      );
      top.position.set((p.min.x + p.max.x) / 2, p.max.y + 0.02, (p.min.z + p.max.z) / 2);
      if (moverIds.has(p.id)) {
        this.moverMeshes.push({
          id: p.id,
          box,
          top,
          baseX: (p.min.x + p.max.x) / 2,
          baseZ: (p.min.z + p.max.z) / 2,
        });
      }
      if (isDoor) {
        this.doorGroup = new THREE.Group();
        this.doorGroup.add(box);
        this.doorGroup.add(top);
        // Jeruji vertikal (tanda gerbang, 1 draw call instanced tidak
        // sepadan untuk 5 batang: pakai mesh biasa digabung grup).
        for (let i = 0; i < 5; i++) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), doorMat);
          bar.position.set(
            p.min.x + ((i + 0.5) * w) / 5,
            (p.min.y + p.max.y) / 2,
            (p.min.z + p.max.z) / 2 + d / 2 + 0.08,
          );
          this.doorGroup.add(bar);
        }
        this.scene.add(this.doorGroup);
      } else {
        this.scene.add(box);
        this.scene.add(top);
      }
    }

    // Tombol lantai co-op: alas + kubah yang menyala hijau saat ditekan.
    for (const btn of level.buttons ?? []) {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(btn.radius, btn.radius + 0.15, 0.12, 20),
        std(0x3a3a3a, 0.6),
      );
      base.position.set(btn.pos.x, btn.pos.y + 0.06, btn.pos.z);
      this.scene.add(base);
      const domeMat = new THREE.MeshStandardMaterial({
        color: "#ef4444",
        emissive: "#ef4444",
        emissiveIntensity: 0.7,
        roughness: 0.4,
      });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), domeMat);
      dome.scale.set(1, 0.5, 1);
      dome.position.set(btn.pos.x, btn.pos.y + 0.14, btn.pos.z);
      this.scene.add(dome);
      this.buttonDomes.push({ id: btn.id, mat: domeMat });
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
      this.anchorVisuals.push({ id: a.id, ring, bulb });
    }

    if (theme.shelves) this.buildShelves(level);
    if (theme.candles) this.buildCandles(level);
    if (theme.bottles) this.buildBottles();
    if (theme.mushrooms) this.buildMushrooms(level, level.theme === "garden");
    if (theme.orbs) this.buildGlowOrbs(level);
    this.buildBounceShrooms(level);
    this.buildGoal(level);
    this.buildFlies(level);

    // Katak pemain (oranye solo / sesuai kursi di co-op). Lidah
    // dipindah ke scene supaya koordinat dunia-nya tidak ikut rotasi
    // badan katak.
    this.slot0 = {
      model: buildFrogModel(myColor),
      yaw: Math.PI,
      squash: 0,
      hop: 0,
    };
    this.scene.add(this.slot0.model.group);
    this.scene.add(this.slot0.model.tongue);
  }

  /** Tambah katak pasangan (co-op): model ke-2 + lidahnya. */
  addPartner(color: FrogColor): void {
    if (this.slot1) return;
    this.slot1 = { model: buildFrogModel(color), yaw: Math.PI, squash: 0, hop: 0 };
    this.scene.add(this.slot1.model.group);
    this.scene.add(this.slot1.model.tongue);
  }

  /** Rak buku di dinding kiri/kanan + buku instanced (1 draw call).
   * Posisi rak dari bounds level (F3: level baru lebih panjang). */
  private buildShelves(level: LevelDef): void {
    const rng = mulberry32(99);
    const shelfMat = std(0x4a3220, 0.9);
    const b = level.bounds;
    const shelfSpots: { x: number; z: number; ry: number }[] = [];
    for (let z = b.minZ + 9; z < b.maxZ - 2; z += 14) {
      shelfSpots.push({ x: b.minX + 0.6, z, ry: Math.PI / 2 });
    }
    for (let z = b.minZ + 16; z < b.maxZ - 2; z += 14) {
      shelfSpots.push({ x: b.maxX - 0.6, z, ry: -Math.PI / 2 });
    }
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

  /** Lilin di tepi platform (badan + api instanced, 2 draw call).
   * Pintu + platform bergerak dilewati: lilin statis akan melayang
   * saat pintu meluncur / platform berpindah. */
  private buildCandles(level: LevelDef): void {
    const rng = mulberry32(31);
    const spots: { x: number; y: number; z: number }[] = [];
    const skip = new Set([
      level.door?.platformId,
      ...(level.movers ?? []).map((m) => m.platformId),
    ]);
    for (const p of level.platforms) {
      if (skip.has(p.id)) continue;
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

  /** Jamur di sudut lantai (batang + tudung instanced, 2 draw call).
   * Posisi dari bounds level; taman memakai jamur lebih besar. */
  private buildMushrooms(level: LevelDef, big = false): void {
    const rng = mulberry32(77);
    const b = level.bounds;
    const halfW = (b.maxX - b.minX) / 2;
    const spots: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const left = rng() > 0.5;
      spots.push({
        x: (left ? -1 : 1) * (halfW - 5 + rng() * 4),
        z: b.minZ + 3 + rng() * (b.maxZ - b.minZ - 6),
        s: big ? 0.9 + rng() * 1.3 : 0.5 + rng() * 0.8,
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

  /** Bola cahaya melayang di atas air selokan (1 draw call instanced). */
  private buildGlowOrbs(level: LevelDef): void {
    const rng = mulberry32(41);
    const b = level.bounds;
    const n = 24;
    const orbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshStandardMaterial({
        color: "#7dffc8",
        emissive: "#2ee6a8",
        emissiveIntensity: 1.8,
      }),
      n,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const s = 0.6 + rng() * 1.2;
      m.makeScale(s, s, s);
      m.setPosition(
        b.minX + 2 + rng() * (b.maxX - b.minX - 4),
        -2.5 + rng() * 3.5,
        b.minZ + 2 + rng() * (b.maxZ - b.minZ - 4),
      );
      orbs.setMatrixAt(i, m);
    }
    orbs.instanceMatrix.needsUpdate = true;
    this.scene.add(orbs);
  }

  /** Jamur lompat (F3): batang + tudung per definisi level, grup
   * sendiri supaya bisa berdenyut saat ditekan katak. */
  private buildBounceShrooms(level: LevelDef): void {
    const stemMat = std(0xf5ead0, 0.8);
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xc0392b,
      emissive: 0xc0392b,
      emissiveIntensity: 0.25,
      roughness: 0.7,
    });
    for (const m of level.mushrooms ?? []) {
      const group = new THREE.Group();
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.42, 0.4, 10),
        stemMat,
      );
      stem.position.y = 0.2;
      group.add(stem);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(m.radius * 0.95, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        capMat,
      );
      cap.position.y = 0.4;
      group.add(cap);
      group.position.set(m.pos.x, m.pos.y, m.pos.z);
      this.scene.add(group);
      this.bounceShrooms.push({ id: m.id, group, squash: 0, phase: Math.random() * 6 });
    }
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

  /** Posisi kamera dunia (titik asal sinar bidik lidah). */
  get cameraPosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }

  /** Stat render buat QA (draw call + segitiga frame terakhir). */
  getStats(): { calls: number; triangles: number } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  /** Event sim ke efek visual: squash katak saat mendarat, jamur
   * berdenyut saat melontarkan katak. slot 0 = katak sendiri,
   * 1 = pasangan (co-op). */
  playEvent(type: string, slot = 0, mushroomId?: string): void {
    if (type === "land") {
      if (slot === 0) this.slot0.squash = 0.16;
      else if (this.slot1) this.slot1.squash = 0.16;
      return;
    }
    if (type === "bounce" && mushroomId) {
      const m = this.bounceShrooms.find((x) => x.id === mushroomId);
      if (m) m.squash = 0.35;
    }
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private syncSlot(
    slot: FrogSlot,
    f: FrogState,
    t: TongueState,
    alpha: number,
    dt: number,
  ): void {
    const x = f.prevPos.x + (f.pos.x - f.prevPos.x) * alpha;
    const y = f.prevPos.y + (f.pos.y - f.prevPos.y) * alpha;
    const z = f.prevPos.z + (f.pos.z - f.prevPos.z) * alpha;
    const g = slot.model.group;
    // Hop bob: badan naik-turun kecil saat bergerak di tanah.
    const hSpeed = Math.hypot(f.vel.x, f.vel.z);
    let bob = 0;
    if (f.onGround && hSpeed > 0.5) {
      slot.hop += dt * hSpeed * 1.6;
      bob = Math.abs(Math.sin(slot.hop)) * 0.06;
    }
    g.position.set(x, y + bob, z);
    slot.yaw = lerpAngle(slot.yaw, f.facing, 1 - Math.exp(-12 * dt));
    g.rotation.y = slot.yaw;

    // Squash and stretch: memanjang saat melayang, gepeng saat mendarat.
    slot.squash = Math.max(0, slot.squash - dt);
    let sy = 1;
    if (slot.squash > 0) sy = 0.78;
    else if (!f.onGround && Math.abs(f.vel.y) > 2) sy = 1.12;
    else if (f.onGround && hSpeed > 0.5) sy = 1 + Math.sin(slot.hop) * 0.03;
    const sxz = 1 / Math.sqrt(sy);
    slot.model.body.scale.set(sxz, sy, sxz);

    // Lidah: terbang (ujung merayap ke anchor) atau nempel.
    if ((t.mode === "flying" || t.mode === "attached") && t.anchor) {
      const mouth = new THREE.Vector3(x, y + 0.62, z);
      const target = new THREE.Vector3(t.anchor.x, t.anchor.y, t.anchor.z);
      if (t.mode === "flying") {
        const p = 1 - t.flyTime / TONGUE_FLY_TIME;
        target.lerpVectors(mouth, target, Math.max(0, Math.min(1, p)));
      }
      slot.model.setTongue(mouth, target);
    } else {
      slot.model.hideTongue();
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

  /** Lalat + cincin anchor + portal (dipakai solo dan co-op). */
  private syncShared(fliesGot: string[], usedAnchors: string[], time: number): void {
    // Lalat: melayang naik-turun + sayap mengepak; hilang saat dimakan.
    for (const fly of this.flies) {
      const eaten = fliesGot.includes(fly.id);
      fly.group.visible = !eaten;
      if (eaten) continue;
      fly.group.position.y = fly.baseY + Math.sin(time * 3 + fly.phase) * 0.15;
      fly.group.rotation.y = time * 0.8 + fly.phase;
      const flap = Math.sin(time * 40 + fly.phase) * 0.5;
      fly.wingL.rotation.z = 0.5 + flap;
      fly.wingR.rotation.z = -0.5 - flap;
    }

    // Cincin anchor berdenyut + portal berputar pelan. Anchor sekali
    // pakai yang habis: cincin hilang, lentera meredup.
    const pulse = 1 + Math.sin(time * 3) * 0.08;
    for (const v of this.anchorVisuals) {
      const used = usedAnchors.includes(v.id);
      v.ring.visible = !used;
      if (!used) {
        v.ring.scale.setScalar(pulse);
        v.ring.lookAt(this.camera.position);
      }
      const bulbMat = v.bulb.material as THREE.MeshStandardMaterial;
      bulbMat.emissiveIntensity = used ? 0.1 : 1.6;
    }
    this.portalRing.rotation.z = time * 0.4;
  }

  /** Pintu meluncur ke bawah saat terbuka (3.2 m = tinggi pintu);
   * kubah tombol hijau saat ditekan, merah saat tidak. Dipakai solo
   * (state lokal) dan co-op (snapshot server). */
  private syncDoor(doorOpen: boolean, pressedButtons: string[], dt: number): void {
    if (this.doorGroup) {
      const target = doorOpen ? -3.2 : 0;
      this.doorY += (target - this.doorY) * (1 - Math.exp(-8 * dt));
      this.doorGroup.position.y = this.doorY;
    }
    for (const dome of this.buttonDomes) {
      const pressed = pressedButtons.includes(dome.id);
      const c = pressed ? "#22c55e" : "#ef4444";
      dome.mat.color.set(c);
      dome.mat.emissive.set(c);
    }
  }

  /** Platform bergerak mengikuti posisi sim di waktu t (F3). */
  private syncMovers(time: number): void {
    for (const m of this.level.movers ?? []) {
      const mesh = this.moverMeshes.find((x) => x.id === m.platformId);
      if (!mesh) continue;
      const o = moverOffset(m, time);
      const dx = m.axis === "x" ? o : 0;
      const dz = m.axis === "z" ? o : 0;
      mesh.box.position.x = mesh.baseX + dx;
      mesh.box.position.z = mesh.baseZ + dz;
      mesh.top.position.x = mesh.baseX + dx;
      mesh.top.position.z = mesh.baseZ + dz;
    }
  }

  /** Jamur lompat: denyut pelan + gepeng sesaat setelah melontarkan. */
  private syncMushrooms(time: number, dt: number): void {
    for (const m of this.bounceShrooms) {
      m.squash = Math.max(0, m.squash - dt);
      const idle = 1 + Math.sin(time * 2 + m.phase) * 0.03;
      const sq = m.squash > 0 ? 1 - 0.35 * (m.squash / 0.35) : 1;
      m.group.scale.set(idle / Math.sqrt(sq), idle * sq, idle / Math.sqrt(sq));
    }
  }

  /** Render satu frame solo: sinkron state sim + gambar. */
  render(state: FrogGameState, alpha: number, time: number, dt: number): void {
    this.syncSlot(this.slot0, state.frog, state.tongue, alpha, dt);
    this.syncShared(state.fliesGot, [], time);
    this.syncDoor(state.doorOpen, state.pressedButtons, dt);
    this.syncMovers(time);
    this.syncMushrooms(time, dt);
    const f = state.frog;
    this.syncCamera(dt, new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z));
    this.renderer.render(this.scene, this.camera);
  }

  /** Render satu frame co-op: katak sendiri (prediksi) + pasangan
   * (interpolasi snapshot) + pintu + tombol. */
  renderRemote(view: FrogRemoteView, alpha: number, time: number, dt: number): void {
    this.syncSlot(this.slot0, view.me.frog, view.me.tongue, alpha, dt);
    if (this.slot1 && view.partner) {
      this.syncSlot(this.slot1, view.partner.frog, view.partner.tongue, 1, dt);
    }
    this.syncShared(view.fliesGot, view.usedAnchors, time);
    this.syncDoor(view.doorOpen, view.pressedButtons, dt);
    this.syncMovers(time);
    this.syncMushrooms(time, dt);
    const f = view.me.frog;
    this.syncCamera(dt, new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z));
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
