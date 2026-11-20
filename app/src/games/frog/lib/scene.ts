// Scene Three.js game katak: bengkel penyihir hangat (lantai kayu,
// rak buku, lilin, ramuan, jamur, kaca patri). Tanpa shadow map dan
// post-processing (target laptop kentang); dekor berulang pakai
// InstancedMesh. Render di-interpolasi dari state sim (alpha 0..1).
// Dinding + lantai bawah dihitung dari bounds level (level co-op lebih
// panjang dari level solo). Co-op (F2): katak ke-2, pintu geser, dan
// tombol lantai dirender lewat renderRemote. F3: tema per level
// (sewer/library/garden), platform bergerak, dan jamur lompat.
// F4 HD: texture CC0 nyata (bata, kayu, paving, lumut, kertas, kulit)
// + normal map, UV skala dunia, fog + fill light per tema, air animasi.

import * as THREE from "three";
import { mulberry32 } from "../../../../../shared/game/prng";
import { TONGUE_FLY_TIME, moverOffset } from "../../../../../shared/frog/sim";
import { buildFrogModel, type FrogModel } from "./frogModel";
import {
  getBrickNormalTexture,
  getBrickTexture,
  getGrassTexture,
  getLeatherNormalTexture,
  getMetalTexture,
  getMossTexture,
  getPaperTexture,
  getPavingNormalTexture,
  getPavingTexture,
  getWaterTexture,
  getWoodDarkTexture,
  getWoodTexture,
} from "./textures";
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
  /** Id cincin emas yang sudah diaktifkan (F6.2). */
  ringsHit: string[];
  usedAnchors: string[];
  doorOpen: boolean;
  /** Id tombol yang sedang tertekan (dihitung client dari posisi katak). */
  pressedButtons: string[];
}

/** Slot render satu katak (model + state animasi squash/hop/kedip). */
interface FrogSlot {
  model: FrogModel;
  yaw: number;
  squash: number;
  hop: number;
  /** Waktu sampai kedip berikutnya (detik). */
  blinkIn: number;
  /** Progres kedip 0..1 (0 = tidak kedip). */
  blinkPhase: number;
  /** onGround frame sebelumnya (buat squash saat lepas landas). */
  wasGround: boolean;
  /** Waktu hidup slot (buat napas idle). */
  time: number;
  /** Sisa waktu goyang terpeleset (detik, F6.7). */
  slideT: number;
  /** Kecepatan horizontal frame sebelumnya (buat deteksi berhenti mendadak). */
  prevHSpeed: number;
}

function newSlot(model: FrogModel): FrogSlot {
  return {
    model,
    yaw: Math.PI,
    squash: 0,
    hop: 0,
    blinkIn: 2 + Math.random() * 2,
    blinkPhase: 0,
    wasGround: true,
    time: 0,
    slideT: 0,
    prevHSpeed: 0,
  };
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

/** Skala UV kotak ke ukuran dunia: texture mengulang tiap 1/scale
 * meter, jadi kepadatan texel konsisten di semua ukuran platform
 * tanpa perlu instance texture per mesh. Urutan face BoxGeometry:
 * +x, -x, +y, -y, +z, -z, masing-masing 4 vertex. */
function worldUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, scale: number): void {
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = dims[f]!;
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * fw * scale, uv.getY(i) * fh * scale);
    }
  }
  uv.needsUpdate = true;
}

/** Skala UV bidang datar (lantai) ke ukuran dunia. */
function worldUVsPlane(geo: THREE.PlaneGeometry, w: number, d: number, scale: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w * scale, uv.getY(i) * d * scale);
  }
  uv.needsUpdate = true;
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

/** Muka koin perunggu raksasa (F6.9): gradasi perunggu + bintang +
 * cincin timbul. Dipakai sisi atas/bawah silinder koin dekor. */
function coinTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, "#e8b06a");
  grad.addColorStop(0.7, "#b87333");
  grad.addColorStop(1, "#7a4a1e");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#e8c88a";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.stroke();
  // Bintang 5 sudut di tengah.
  g.fillStyle = "#f2d49a";
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 30 : 13;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Kertas sketsa anatomi katak (F6.9): kertas krem + gambar garis
 * katak (badan, mata, kaki) + coretan tulisan tangan. */
function sketchTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 192;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f5ead0";
  g.fillRect(0, 0, 256, 192);
  g.strokeStyle = "#7a5a3a";
  g.lineWidth = 3;
  // Badan katak (elips) + kepala + mata menonjol.
  g.beginPath();
  g.ellipse(100, 110, 55, 38, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.ellipse(78, 78, 16, 14, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.ellipse(122, 78, 16, 14, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(78, 78, 5, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(122, 78, 5, 0, Math.PI * 2);
  g.stroke();
  // Kaki belakang merentang + kaki depan.
  g.beginPath();
  g.moveTo(55, 130);
  g.quadraticCurveTo(20, 150, 30, 168);
  g.moveTo(145, 130);
  g.quadraticCurveTo(180, 150, 170, 168);
  g.moveTo(80, 145);
  g.lineTo(72, 170);
  g.moveTo(120, 145);
  g.lineTo(128, 170);
  g.stroke();
  // Garis ukur + coretan tulisan tangan di kanan.
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(45, 40);
  g.lineTo(155, 40);
  g.moveTo(45, 34);
  g.lineTo(45, 46);
  g.moveTo(155, 34);
  g.lineTo(155, 46);
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const y = 70 + i * 16;
    g.moveTo(185, y);
    g.bezierCurveTo(205, y - 4, 215, y + 4, 235, y - 2);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let heartTex: THREE.CanvasTexture | null = null;

/** Texture hati pink (F6.8, ciuman lidah): digambar sekali di canvas,
 * dipakai semua sprite hati. */
function heartTexture(): THREE.CanvasTexture {
  if (heartTex) return heartTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ff6b9d";
  g.beginPath();
  g.moveTo(32, 56);
  g.bezierCurveTo(8, 38, 6, 20, 18, 12);
  g.bezierCurveTo(26, 7, 32, 14, 32, 20);
  g.bezierCurveTo(32, 14, 38, 7, 46, 12);
  g.bezierCurveTo(58, 20, 56, 38, 32, 56);
  g.fill();
  // Kilau kecil di kiri atas.
  g.fillStyle = "rgba(255,255,255,0.65)";
  g.beginPath();
  g.ellipse(22, 20, 5, 7, -0.4, 0, Math.PI * 2);
  g.fill();
  heartTex = new THREE.CanvasTexture(c);
  heartTex.colorSpace = THREE.SRGBColorSpace;
  return heartTex;
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
/** Variasi warna tudung jamur dekor (F4, instanceColor). */
const CAP_COLORS = [0xc0392b, 0xd35400, 0xe74c3c, 0x8e44ad, 0xb03a2e];

/** Palet + dekor per tema level (F3, F4: fog + exposure + fill light
 * + texture per tema). */
interface FrogThemeCfg {
  bg: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunInt: number;
  /** Kabut + exposure ACES per tema (selokan gelap + pekat). */
  fogNear: number;
  fogFar: number;
  exposure: number;
  /** Fill light tengah ruangan (warna + intensitas). */
  fillColor: number;
  fillInt: number;
  /** Tint di atas texture bata dinding (putih = bata asli). */
  wallTint: number;
  /** Lantai bawah: kayu, air (selokan), rumput (taman). */
  floor: "wood" | "water" | "grass";
  /** Texture sisi + puncak platform (buku pakai leather + warna). */
  sideTex: "wood" | "paving";
  topTex: "wood" | "moss" | "paper";
  /** Platform = buku raksasa (warna sampul bersiklus). */
  books: boolean;
  /** Lantai awal tetap meja kayu (bukan buku) meski books aktif. */
  tableFloor: boolean;
  /** Props ruangan penyihir padat (F6.9): koin, kertas, bola kristal. */
  workshopProps: boolean;
  /** Spotlight warna dari arah jendela kaca patri (F6.10). */
  stainedLight: boolean;
  shelves: boolean;
  candles: boolean;
  bottles: boolean;
  mushrooms: boolean;
  orbs: boolean;
}

const THEMES: Record<FrogTheme, FrogThemeCfg> = {
  workshop: { bg: 0x2a1f16, hemiSky: 0xffe8c8, hemiGround: 0x4a3421, sun: 0xffd9a0, sunInt: 2.0, fogNear: 30, fogFar: 85, exposure: 1.15, fillColor: 0xff9a3d, fillInt: 8, wallTint: 0xffffff, floor: "wood", sideTex: "wood", topTex: "wood", books: true, tableFloor: true, workshopProps: true, stainedLight: true, shelves: true, candles: true, bottles: true, mushrooms: true, orbs: false },
  sewer: { bg: 0x0a1f1c, hemiSky: 0x9ad8c8, hemiGround: 0x0a2a22, sun: 0x7fd8b8, sunInt: 1.1, fogNear: 16, fogFar: 55, exposure: 1.05, fillColor: 0x2ee6a8, fillInt: 10, wallTint: 0x7a9a8a, floor: "water", sideTex: "paving", topTex: "moss", books: false, tableFloor: false, workshopProps: false, stainedLight: false, shelves: false, candles: false, bottles: false, mushrooms: false, orbs: true },
  library: { bg: 0x1f1a2e, hemiSky: 0xd8ccff, hemiGround: 0x2a2438, sun: 0xffe8c8, sunInt: 1.6, fogNear: 30, fogFar: 80, exposure: 1.15, fillColor: 0xffe8c8, fillInt: 9, wallTint: 0xa89ac8, floor: "wood", sideTex: "wood", topTex: "paper", books: true, tableFloor: false, workshopProps: false, stainedLight: false, shelves: true, candles: true, bottles: false, mushrooms: false, orbs: false },
  garden: { bg: 0x14240f, hemiSky: 0xc8f0a8, hemiGround: 0x1a3016, sun: 0xfff0b8, sunInt: 1.7, fogNear: 35, fogFar: 90, exposure: 1.15, fillColor: 0xd8ffb8, fillInt: 9, wallTint: 0x93b184, floor: "grass", sideTex: "wood", topTex: "moss", books: false, tableFloor: false, workshopProps: false, stainedLight: false, shelves: false, candles: false, bottles: false, mushrooms: true, orbs: false },
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
  /** Lalat yang sedang tersedot ke mulut pemakan (F6.4): id -> waktu
   * sejak mulai, slot pemakan, posisi awal lalat. */
  private flySuck = new Map<string, { t: number; slot: number; from: THREE.Vector3 }>();
  private portalRing!: THREE.Mesh;
  private anchorVisuals: { id: string; ring: THREE.Mesh; bulb: THREE.Mesh }[] = [];
  /** Target cincin emas (F6.2): mesh + material (meredup saat aktif). */
  private ringVisuals: { id: string; ring: THREE.Mesh; mat: THREE.MeshStandardMaterial }[] = [];
  /** Mesh platform tersembunyi (F6.2): tak terlihat sampai cincinnya aktif. */
  private hiddenMeshes: { ringId: string; meshes: THREE.Mesh[] }[] = [];
  /** Ledakan sparkle biru aktif (F6.2): titik + kecepatan + umur. */
  private sparks: { points: THREE.Points; vel: Float32Array; age: number }[] = [];
  /** Hati melayang aktif (F6.8, ciuman lidah): sprite + kecepatan + umur. */
  private hearts: { sprite: THREE.Sprite; vel: THREE.Vector3; age: number; life: number; phase: number }[] = [];
  /** Partikel sparkle melayang (F6.10): titik + posisi dasar + fase. */
  private sparkles: { points: THREE.Points; base: Float32Array; phase: Float32Array } | null = null;
  private doorGroup: THREE.Group | null = null;
  private doorY = 0;
  private buttonDomes: { id: string; mat: THREE.MeshStandardMaterial }[] = [];
  /** Mesh platform bergerak + posisi dasarnya (F3). */
  private moverMeshes: { id: string; box: THREE.Mesh; top: THREE.Mesh; baseX: number; baseZ: number }[] = [];
  /** Jamur lompat (F3): grup + sisa waktu animasi gepeng. */
  private bounceShrooms: { id: string; group: THREE.Group; squash: number; phase: number }[] = [];
  /** Texture air selokan (offset digeser tiap frame, F4). */
  private waterTex: THREE.Texture | null = null;
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
    this.renderer.toneMappingExposure = theme.exposure;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(theme.bg);
    this.scene.fog = new THREE.Fog(theme.bg, theme.fogNear, theme.fogFar);
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      200,
    );
    this.camera.position.set(0, 6, 14);

    // Cahaya tema: 1 hemisphere + 1 directional + 3 point (lilin,
    // goal, fill tengah ruangan). Tanpa shadow map (laptop kentang).
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
    const fill = new THREE.PointLight(theme.fillColor, theme.fillInt, 34, 1.6);
    fill.position.set(
      (level.bounds.minX + level.bounds.maxX) / 2,
      6,
      (level.bounds.minZ + level.bounds.maxZ) / 2,
    );
    this.scene.add(fill);

    // Cahaya kaca patri (F6.10, bengkel): 3 spotlight warna dari arah
    // jendela (belakang pink, kiri ungu, kanan hijau), tanpa bayangan
    // (laptop kentang). Kolam cahaya warna jatuh ke meja + buku.
    if (theme.stainedLight) {
      // Target di atas buku (bukan y=0): kolam warna jatuh tepat di
      // atas platform yang dilewati katak (p4 pink, p3 ungu, p2 hijau).
      const spots: { color: number; from: [number, number, number]; to: [number, number, number] }[] = [
        { color: 0xff6b9d, from: [0, 6, level.bounds.minZ + 2], to: [0, 3.6, -27] },
        { color: 0xb8a4ed, from: [level.bounds.minX + 1, 5.5, -15], to: [-2, 2.4, -22] },
        { color: 0x57d98a, from: [level.bounds.maxX - 1, 5.5, -15], to: [2, 2.4, -10] },
      ];
      for (const s of spots) {
        // Intensitas 200: jarak jendela ke kolam cahaya ~17 m, decay
        // 1.6 melemahkan ~95x, jadi efektif ~2.1 (sebanding matahari
        // 2.0) dan tint warna terlihat jelas di atas buku + meja.
        const spot = new THREE.SpotLight(s.color, 200, 45, 0.8, 0.9, 1.6);
        spot.position.set(s.from[0], s.from[1], s.from[2]);
        spot.target.position.set(s.to[0], s.to[1], s.to[2]);
        this.scene.add(spot);
        this.scene.add(spot.target);
      }
    }

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
      // Air selokan: texture riak prosedural (map + bump), mengkilap.
      const water = getWaterTexture();
      this.waterTex = water;
      lowMat = new THREE.MeshStandardMaterial({
        map: water,
        bumpMap: water,
        bumpScale: 0.06,
        emissive: 0x0a3a2a,
        emissiveIntensity: 0.6,
        roughness: 0.18,
        metalness: 0.05,
        transparent: true,
        opacity: 0.94,
      });
      lowY = -3;
    } else if (theme.floor === "grass") {
      const grass = getGrassTexture();
      lowMat = new THREE.MeshStandardMaterial({
        map: grass,
        bumpMap: grass,
        bumpScale: 0.03,
        roughness: 1,
      });
    } else {
      const wood = getWoodTexture();
      lowMat = new THREE.MeshStandardMaterial({
        map: wood,
        bumpMap: wood,
        bumpScale: 0.02,
        roughness: 0.85,
      });
    }
    const lowGeo = new THREE.PlaneGeometry(roomW, roomD);
    worldUVsPlane(lowGeo, roomW, roomD, 1 / 4);
    const lowFloor = new THREE.Mesh(lowGeo, lowMat);
    lowFloor.rotation.x = -Math.PI / 2;
    lowFloor.position.set(cx, lowY, cz);
    this.scene.add(lowFloor);

    // Dinding bata HD (map + normal) + panel kayu gelap.
    const brick = getBrickTexture();
    const brickN = getBrickNormalTexture();
    const wallMat = new THREE.MeshStandardMaterial({
      map: brick,
      normalMap: brickN,
      normalScale: new THREE.Vector2(0.9, 0.9),
      color: theme.wallTint,
      roughness: 0.95,
    });
    const woodDark = getWoodDarkTexture();
    const panelMat = new THREE.MeshStandardMaterial({
      map: woodDark,
      bumpMap: woodDark,
      bumpScale: 0.02,
      roughness: 0.9,
    });
    const backGeo = new THREE.BoxGeometry(roomW, 10, 0.6);
    worldUVs(backGeo, roomW, 10, 0.6, 1 / 6);
    const backWall = new THREE.Mesh(backGeo, wallMat);
    backWall.position.set(cx, 5, b.minZ - 0.5);
    this.scene.add(backWall);
    for (const side of [-1, 1]) {
      const wallGeo = new THREE.BoxGeometry(0.6, 10, roomD - 4);
      worldUVs(wallGeo, 0.6, 10, roomD - 4, 1 / 6);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(side < 0 ? b.minX - 0.3 : b.maxX + 0.3, 5, cz);
      this.scene.add(wall);
      const panelGeo = new THREE.BoxGeometry(0.2, 2.4, roomD - 4);
      worldUVs(panelGeo, 0.2, 2.4, roomD - 4, 1 / 4);
      const panel = new THREE.Mesh(panelGeo, panelMat);
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
    // Platform: sisi + puncak pakai texture tema (kayu / paving /
    // lumut / kertas). Buku raksasa: sampul warna + normal kulit.
    const wood = getWoodTexture();
    const woodMat = new THREE.MeshStandardMaterial({
      map: wood,
      bumpMap: wood,
      bumpScale: 0.02,
      roughness: 0.85,
    });
    const paving = getPavingTexture();
    const pavingMat = new THREE.MeshStandardMaterial({
      map: paving,
      normalMap: getPavingNormalTexture(),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.95,
    });
    const moss = getMossTexture();
    const mossMat = new THREE.MeshStandardMaterial({
      map: moss,
      bumpMap: moss,
      bumpScale: 0.03,
      roughness: 1,
    });
    const paper = getPaperTexture();
    const paperMat = new THREE.MeshStandardMaterial({
      map: paper,
      bumpMap: paper,
      bumpScale: 0.01,
      color: 0xfff2d8,
      roughness: 0.9,
    });
    const leatherN = getLeatherNormalTexture();
    const bookMats = BOOK_COLORS.map(
      (c) =>
        new THREE.MeshStandardMaterial({
          color: c,
          normalMap: leatherN,
          normalScale: new THREE.Vector2(0.4, 0.4),
          roughness: 0.8,
        }),
    );
    const sideMat = theme.sideTex === "paving" ? pavingMat : woodMat;
    const topMat =
      theme.topTex === "moss" ? mossMat : theme.topTex === "paper" ? paperMat : woodMat;
    const metal = getMetalTexture();
    const doorMat = new THREE.MeshStandardMaterial({
      map: metal,
      bumpMap: metal,
      bumpScale: 0.02,
      color: 0xb8c8d8,
      roughness: 0.4,
      metalness: 0.7,
    });
    const moverIds = new Set((level.movers ?? []).map((m) => m.platformId));
    let bookIdx = 0;
    for (const p of level.platforms) {
      const w = p.max.x - p.min.x;
      const h = p.max.y - p.min.y;
      const d = p.max.z - p.min.z;
      const isDoor = level.door?.platformId === p.id;
      // Bengkel (F6.9): lantai awal = meja kayu raksasa, platform lain
      // = buku raksasa (sampul warna + halaman kertas di atas).
      const useBook = theme.books && !(theme.tableFloor && p.id === "floor0");
      const side = isDoor
        ? doorMat
        : useBook
          ? bookMats[bookIdx++ % bookMats.length]!
          : sideMat;
      const boxGeo = new THREE.BoxGeometry(w, h, d);
      worldUVs(boxGeo, w, h, d, 1 / 3);
      const box = new THREE.Mesh(boxGeo, side);
      box.position.set((p.min.x + p.max.x) / 2, (p.min.y + p.max.y) / 2, (p.min.z + p.max.z) / 2);
      const topGeo = new THREE.BoxGeometry(w + 0.3, 0.14, d + 0.3);
      worldUVs(topGeo, w + 0.3, 0.14, d + 0.3, 1 / 3);
      const top = new THREE.Mesh(topGeo, isDoor ? doorMat : useBook ? paperMat : topMat);
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
      // Platform tersembunyi (F6.2): tak terlihat sampai cincinnya aktif.
      if (p.hiddenUntil) {
        box.visible = false;
        top.visible = false;
        this.hiddenMeshes.push({ ringId: p.hiddenUntil, meshes: [box, top] });
      }
    }

    // Tombol lantai co-op: alas logam + kubah yang menyala hijau saat ditekan.
    const buttonBaseMat = new THREE.MeshStandardMaterial({
      map: metal,
      color: 0x8a9aa8,
      roughness: 0.45,
      metalness: 0.7,
    });
    for (const btn of level.buttons ?? []) {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(btn.radius, btn.radius + 0.15, 0.12, 20),
        buttonBaseMat,
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
    const beamMat = new THREE.MeshStandardMaterial({
      map: woodDark,
      bumpMap: woodDark,
      bumpScale: 0.02,
      roughness: 0.9,
    });
    const cageMat = new THREE.MeshStandardMaterial({
      map: metal,
      color: 0x6a7a8a,
      roughness: 0.5,
      metalness: 0.7,
    });
    for (const a of level.anchors) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 0.6), beamMat);
      beam.position.set(a.pos.x, 8.6, a.pos.z);
      this.scene.add(beam);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 8.6 - a.pos.y, 6), std(0x9a7a4a));
      rope.position.set(a.pos.x, (8.6 + a.pos.y) / 2, a.pos.z);
      this.scene.add(rope);
      // Lentera gantung: sangkar logam + bola cahaya.
      const cage = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.34), cageMat);
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

    // Target cincin emas (F6.2): torus emas besar menghadap +z (arah
    // datang katak), lebih besar + lebih terang dari cincin anchor.
    // Kena lidah = aktivasi + sparkle biru, lalu meredup.
    for (const r of level.rings ?? []) {
      const mat = new THREE.MeshStandardMaterial({
        color: "#ffd700",
        emissive: "#ff9a2e",
        emissiveIntensity: 1.6,
        roughness: 0.3,
        metalness: 0.8,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 10, 28), mat);
      ring.position.copy(r.pos);
      this.scene.add(ring);
      this.ringVisuals.push({ id: r.id, ring, mat });
    }

    if (theme.shelves) this.buildShelves(level);
    if (theme.candles) this.buildCandles(level);
    if (theme.bottles) this.buildBottles();
    if (theme.workshopProps) this.buildWorkshopProps(level);
    if (theme.mushrooms) this.buildMushrooms(level, level.theme === "garden");
    if (theme.orbs) this.buildGlowOrbs(level);
    this.buildBounceShrooms(level);
    this.buildGoal(level);
    this.buildFlies(level);
    // Sparkle melayang di udara (F6.10, semua tema, 1 draw call).
    this.buildSparkles(level);

    // Katak pemain (oranye solo / sesuai kursi di co-op). Lidah
    // dipindah ke scene supaya koordinat dunia-nya tidak ikut rotasi
    // badan katak.
    this.slot0 = newSlot(buildFrogModel(myColor));
    this.scene.add(this.slot0.model.group);
    this.scene.add(this.slot0.model.tongue);
  }

  /** Tambah katak pasangan (co-op): model ke-2 + lidahnya. */
  addPartner(color: FrogColor): void {
    if (this.slot1) return;
    this.slot1 = newSlot(buildFrogModel(color));
    this.scene.add(this.slot1.model.group);
    this.scene.add(this.slot1.model.tongue);
  }

  /** Rak buku di dinding kiri/kanan + buku instanced (1 draw call).
   * Posisi rak dari bounds level (F3: level baru lebih panjang). */
  private buildShelves(level: LevelDef): void {
    const rng = mulberry32(99);
    const woodDark = getWoodDarkTexture();
    const shelfMat = new THREE.MeshStandardMaterial({
      map: woodDark,
      bumpMap: woodDark,
      bumpScale: 0.02,
      roughness: 0.9,
    });
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
      new THREE.MeshStandardMaterial({
        roughness: 0.85,
        normalMap: getLeatherNormalTexture(),
        normalScale: new THREE.Vector2(0.4, 0.4),
      }),
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
      // Platform tersembunyi (F6.2): lilin statis akan melayang di
      // udara sebelum platformnya muncul.
      ...level.platforms.filter((p) => p.hiddenUntil).map((p) => p.id),
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
    const woodDark = getWoodDarkTexture();
    const tableMat = new THREE.MeshStandardMaterial({
      map: woodDark,
      bumpMap: woodDark,
      bumpScale: 0.02,
      roughness: 0.9,
    });
    const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 1.4), tableMat);
    table.position.set(-5.5, 1.05, 6.5);
    this.scene.add(table);
    for (const [dx, dz] of [[-1.3, -0.5], [1.3, -0.5], [-1.3, 0.5], [1.3, 0.5]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), tableMat);
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

  /** Ruangan penyihir padat (F6.9, tema bengkel saja): meja kayu
   * raksasa (kaki + laci di bawah lantai awal), koin perunggu besar,
   * kertas sketsa anatomi katak, bola kristal biru, buku mantra
   * terbuka, dan kaca patri di dinding samping. Semua props VISUAL
   * (tanpa tabrakan) dan ditaruh di luar jalur utama, jadi gameplay
   * + puzzle tidak berubah. Posisi koin goal diturunkan dari
   * level.goal.pos supaya benar di solo maupun co-op. */
  private buildWorkshopProps(level: LevelDef): void {
    const woodDark = getWoodDarkTexture();
    const darkMat = new THREE.MeshStandardMaterial({
      map: woodDark,
      bumpMap: woodDark,
      bumpScale: 0.02,
      roughness: 0.9,
    });
    const floor0 = level.platforms.find((p) => p.id === "floor0");
    if (floor0) {
      // Kaki meja raksasa (4, dari lantai bawah y=-5 ke lantai awal).
      const legGeo = new THREE.BoxGeometry(0.9, 5, 0.9);
      for (const [lx, lz] of [
        [floor0.min.x + 0.7, floor0.max.z - 0.7],
        [floor0.max.x - 0.7, floor0.max.z - 0.7],
        [floor0.min.x + 0.7, floor0.min.z + 0.7],
        [floor0.max.x - 0.7, floor0.min.z + 0.7],
      ] as const) {
        const leg = new THREE.Mesh(legGeo, darkMat);
        leg.position.set(lx, -2.5, lz);
        this.scene.add(leg);
      }
      // Laci depan meja (panel + gagang kuningan) di muka z=8.
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(7, 0.85, 0.12), darkMat);
      drawer.position.set(0, -0.5, floor0.max.z + 0.06);
      this.scene.add(drawer);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.06, 8, 20, Math.PI),
        new THREE.MeshStandardMaterial({
          color: 0xc9a227,
          metalness: 0.85,
          roughness: 0.3,
        }),
      );
      handle.position.set(0, -0.42, floor0.max.z + 0.14);
      handle.rotation.x = Math.PI;
      this.scene.add(handle);
    }

    // Koin perunggu raksasa (dekor, 2-3x katak): 2 tergeletak di meja,
    // 1 berdiri di lantai bawah dekat jurang. Beda dari koin emas
    // kolektibel F6.11 (kecil, berputar, bisa diambil lidah).
    const coinFace = coinTexture();
    const coinSideMat = std(0x8a5a24, 0.4);
    coinSideMat.metalness = 0.8;
    const coinFaceMat = new THREE.MeshStandardMaterial({
      map: coinFace,
      metalness: 0.75,
      roughness: 0.35,
    });
    const coinMats = [coinSideMat, coinFaceMat, coinFaceMat];
    const coinFlat = (x: number, y: number, z: number, r: number): void => {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 24), coinMats);
      coin.position.set(x, y, z);
      this.scene.add(coin);
    };
    coinFlat(-6.5, 0.06, 0.5, 1.1);
    coinFlat(level.goal.pos.x + 5.8, level.goal.pos.y + 0.06, level.goal.pos.z + 1, 1.0);
    const coinStand = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 0.12, 24),
      coinMats,
    );
    coinStand.rotation.x = Math.PI / 2;
    coinStand.position.set(10, -3.9, -16.5);
    this.scene.add(coinStand);

    // Kertas sketsa anatomi katak: di lantai awal + di atas p4.
    const sketchMat = new THREE.MeshStandardMaterial({
      map: sketchTexture(),
      roughness: 0.9,
    });
    const sketch1 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), sketchMat);
    sketch1.rotation.x = -Math.PI / 2;
    sketch1.rotation.z = 0.2;
    sketch1.position.set(5.2, 0.03, 5.2);
    this.scene.add(sketch1);
    const p4 = level.platforms.find((p) => p.id === "p4");
    if (p4) {
      const sketch2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), sketchMat);
      sketch2.rotation.x = -Math.PI / 2;
      sketch2.rotation.z = -0.3;
      sketch2.position.set(-2, p4.max.y + 0.03, -27.5);
      this.scene.add(sketch2);
    }

    // Bola kristal biru bercahaya di atas dudukan kayu (sudut kiri).
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.5, 12), darkMat);
    stand.position.set(-7.2, 0.25, 3.5);
    this.scene.add(stand);
    const crystal = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 20, 16),
      new THREE.MeshStandardMaterial({
        color: 0x4da6ff,
        emissive: 0x2e7dd8,
        emissiveIntensity: 1.1,
        roughness: 0.15,
        metalness: 0.1,
      }),
    );
    crystal.position.set(-7.2, 1.15, 3.5);
    this.scene.add(crystal);

    // Buku mantra terbuka di lantai awal (sampul + 2 halaman miring).
    const bookGroup = new THREE.Group();
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.14, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x8b2e2e, roughness: 0.8 }),
    );
    bookGroup.add(cover);
    const pageMat = new THREE.MeshStandardMaterial({
      map: getPaperTexture(),
      color: 0xfff2d8,
      roughness: 0.9,
    });
    for (const s of [-1, 1]) {
      const page = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.05, 1.66), pageMat);
      page.position.set(s * 0.63, 0.12, 0);
      page.rotation.z = s * -0.16;
      bookGroup.add(page);
    }
    bookGroup.position.set(6.3, 0.07, 1.5);
    bookGroup.rotation.y = -0.25;
    this.scene.add(bookGroup);

    // Kaca patri di dinding samping (emissive, pasangan jendela belakang).
    const glassTex = stainedGlassTexture();
    const glassMat = new THREE.MeshStandardMaterial({
      map: glassTex,
      emissive: 0xffffff,
      emissiveMap: glassTex,
      emissiveIntensity: 0.55,
      roughness: 0.4,
    });
    for (const s of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), glassMat);
      win.position.set(s * (level.bounds.maxX - 0.1), 5, -15);
      win.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(win);
    }
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
      new THREE.MeshStandardMaterial({
        roughness: 0.6,
        normalMap: getLeatherNormalTexture(),
        normalScale: new THREE.Vector2(0.3, 0.3),
      }),
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
      caps.setColorAt(i, new THREE.Color(CAP_COLORS[i % CAP_COLORS.length]!));
    });
    stems.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
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
      roughness: 0.6,
      normalMap: getLeatherNormalTexture(),
      normalScale: new THREE.Vector2(0.4, 0.4),
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

  /** Goal: lily pad lumut + portal bercahaya + berkas cahaya. */
  private buildGoal(level: LevelDef): void {
    const g = level.goal.pos;
    const moss = getMossTexture();
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.1, 0.16, 24),
      new THREE.MeshStandardMaterial({
        map: moss,
        bumpMap: moss,
        bumpScale: 0.02,
        color: 0x9ac89a,
        roughness: 0.9,
      }),
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

  /** Partikel debu ajaib melayang di udara (F6.10): 90 titik emas,
   * additive blending, bergoyang pelan (syncSparkles tiap frame). */
  private buildSparkles(level: LevelDef): void {
    const rng = mulberry32(123);
    const b = level.bounds;
    const n = 90;
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = b.minX + 2 + rng() * (b.maxX - b.minX - 4);
      pos[i * 3 + 1] = 0.5 + rng() * 7;
      pos[i * 3 + 2] = b.minZ + 2 + rng() * (b.maxZ - b.minZ - 4);
      phase[i] = rng() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffd97a,
        size: 0.12,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(points);
    this.sparkles = { points, base: pos.slice(), phase };
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
   * berdenyut saat melontarkan katak, lalat tersedot ke mulut saat
   * dimakan lidah (F6.4), sparkle biru saat cincin emas aktif (F6.2),
   * hati melayang saat ciuman lidah (F6.8, pos = titik tengah kedua
   * ujung lidah). slot 0 = katak sendiri, 1 = pasangan (co-op).
   * id = id jamur (bounce), id lalat (fly), atau id cincin (ring). */
  playEvent(type: string, slot = 0, id?: string, pos?: { x: number; y: number; z: number }): void {
    if (type === "land") {
      if (slot === 0) this.slot0.squash = 0.22;
      else if (this.slot1) this.slot1.squash = 0.22;
      return;
    }
    if (type === "bounce" && id) {
      const m = this.bounceShrooms.find((x) => x.id === id);
      if (m) m.squash = 0.35;
      return;
    }
    if (type === "fly" && id) {
      const fly = this.flies.find((x) => x.id === id);
      if (fly) {
        this.flySuck.set(id, { t: 0, slot, from: fly.group.position.clone() });
      }
      return;
    }
    if (type === "ring" && id) {
      const r = (this.level.rings ?? []).find((x) => x.id === id);
      if (!r) return;
      // Ledakan sparkle biru: 24 titik menyebar dari cincin, naik
      // lalu jatuh, memudar dalam 0.9 detik.
      const n = 24;
      const pos = new Float32Array(n * 3);
      const vel = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = r.pos.x + (Math.random() - 0.5) * 0.6;
        pos[i * 3 + 1] = r.pos.y + (Math.random() - 0.5) * 0.6;
        pos[i * 3 + 2] = r.pos.z + (Math.random() - 0.5) * 0.6;
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 2;
        vel[i * 3] = Math.cos(a) * sp;
        vel[i * 3 + 1] = 1.5 + Math.random() * 2;
        vel[i * 3 + 2] = Math.sin(a) * sp;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: 0x66ccff,
          size: 0.14,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        }),
      );
      this.scene.add(points);
      this.sparks.push({ points, vel, age: 0 });
    }
    if (type === "kiss") {
      // Ciuman lidah (F6.8): 6 hati pink melayang naik dari titik
      // tengah kedua ujung lidah + kedua katak mengembang senang.
      const at = pos ?? { x: 0, y: 1, z: 0 };
      const tex = heartTexture();
      for (let i = 0; i < 6; i++) {
        const mat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        const s = 0.28 + Math.random() * 0.2;
        sprite.scale.setScalar(s);
        sprite.position.set(
          at.x + (Math.random() - 0.5) * 0.6,
          at.y + (Math.random() - 0.5) * 0.4,
          at.z + (Math.random() - 0.5) * 0.6,
        );
        this.scene.add(sprite);
        this.hearts.push({
          sprite,
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 0.4,
            0.7 + Math.random() * 0.5,
            (Math.random() - 0.5) * 0.4,
          ),
          age: 0,
          life: 1.2 + Math.random() * 0.4,
          phase: Math.random() * 6,
        });
      }
      this.slot0.squash = 0.12;
      if (this.slot1) this.slot1.squash = 0.12;
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
    // Hop bob MERANGKAK (F6.7): badan naik-turun lebih besar saat
    // jalan (0.09 m, dari 0.06), langkah 4 kaki lebih jelas.
    const hSpeed = Math.hypot(f.vel.x, f.vel.z);
    let bob = 0;
    if (f.onGround && hSpeed > 0.5) {
      slot.hop += dt * hSpeed * 2.0;
      bob = Math.abs(Math.sin(slot.hop)) * 0.09;
    }
    g.position.set(x, y + bob, z);
    slot.yaw = lerpAngle(slot.yaw, f.facing, 1 - Math.exp(-12 * dt));
    g.rotation.y = slot.yaw;

    // Terpeleset (F6.7): berhenti mendadak dari kecepatan > 2 m/s di
    // tanah (perlambatan > 8 m/s2, friksi sim 14) = goyang 0.35 detik.
    if (f.onGround && slot.prevHSpeed > 2 && slot.prevHSpeed - hSpeed > 8 * dt) {
      slot.slideT = 0.35;
    }
    slot.prevHSpeed = hSpeed;
    slot.slideT = Math.max(0, slot.slideT - dt);

    // Squash and stretch (F6.7, lebih besar): jongkok sebelum lompat,
    // MEMANJANG saat melenting ke udara (1.18), MEMIPIH saat mendarat
    // (0.70, dari 0.78).
    // Lepas landas: squash sebentar (jongkok sebelum lompat).
    if (slot.wasGround && !f.onGround && f.vel.y > 1) slot.squash = 0.14;
    slot.wasGround = f.onGround;
    slot.time += dt;
    slot.squash = Math.max(0, slot.squash - dt);
    const moving = f.onGround && hSpeed > 0.5;
    let sy = 1;
    if (slot.squash > 0) sy = 0.7;
    else if (!f.onGround && Math.abs(f.vel.y) > 2) sy = 1.18;
    else if (moving) sy = 1 + Math.sin(slot.hop) * 0.04;
    else sy = 1 + Math.sin(slot.time * 2.2) * 0.02; // Napas idle.
    const sxz = 1 / Math.sqrt(sy);
    const m = slot.model;
    m.body.scale.set(sxz, sy, sxz);
    // Merangkak: badan menunduk sedikit saat jalan (posisi jongkok).
    m.body.position.y = moving ? -0.02 : 0;

    // Jalan wobbly ala Froggin (F6.7, lebih besar): kaki bergantian
    // lebih jelas (0.85, dari 0.6), tangan berlawanan, badan bergoyang
    // (roll 0.12, dari 0.06) + goyang kiri-kanan (yaw 0.07). Di udara:
    // kaki ke belakang, tangan ke depan. Saat terpeleset: badan
    // bergetar + condong ke depan.
    const step = Math.sin(slot.hop);
    const air = f.onGround ? 0 : 1;
    const k = 1 - Math.exp(-10 * dt);
    const legTarget = moving ? 0.85 : 0;
    m.legL.rotation.x += ((moving ? step * legTarget : -0.7 * air) - m.legL.rotation.x) * k;
    m.legR.rotation.x += ((moving ? -step * legTarget : -0.7 * air) - m.legR.rotation.x) * k;
    m.armL.rotation.x += ((moving ? -step * 0.55 : 0.5 * air) - m.armL.rotation.x) * k;
    m.armR.rotation.x += ((moving ? step * 0.55 : 0.5 * air) - m.armR.rotation.x) * k;
    const slideK = slot.slideT / 0.35;
    const wobble = slot.slideT > 0 ? Math.sin(slot.slideT * 28) * 0.1 * slideK : 0;
    const rollTarget = (moving ? step * 0.12 : 0) + wobble;
    const pitchTarget = (moving ? 0.05 : 0) + 0.1 * slideK;
    const yawTarget = moving ? step * 0.07 : 0;
    m.body.rotation.z += (rollTarget - m.body.rotation.z) * k;
    m.body.rotation.x += (pitchTarget - m.body.rotation.x) * k;
    m.body.rotation.y += (yawTarget - m.body.rotation.y) * k;

    // Kedip: tiap 2-5 detik, mata menutup 0.12 detik.
    slot.blinkIn -= dt;
    if (slot.blinkIn <= 0 && slot.blinkPhase <= 0) slot.blinkPhase = 0.001;
    if (slot.blinkPhase > 0) {
      slot.blinkPhase += dt / 0.12;
      if (slot.blinkPhase >= 1) {
        slot.blinkPhase = 0;
        slot.blinkIn = 2 + Math.random() * 3;
      }
    }
    const eyeSy = slot.blinkPhase > 0 ? 1 - Math.sin(slot.blinkPhase * Math.PI) * 0.9 : 1;
    m.eyeL.scale.y = eyeSy;
    m.eyeR.scale.y = eyeSy;

    // Lidah: terbang (ujung merayap ke anchor) atau nempel. Saat
    // terbang lidah membesar lalu mengecil (F6.5, tembakan "daging").
    if ((t.mode === "flying" || t.mode === "attached") && t.anchor) {
      const mouth = new THREE.Vector3(x, y + 0.35, z);
      const target = new THREE.Vector3(t.anchor.x, t.anchor.y, t.anchor.z);
      let bulge = 1;
      if (t.mode === "flying") {
        const p = 1 - t.flyTime / TONGUE_FLY_TIME;
        const pc = Math.max(0, Math.min(1, p));
        target.lerpVectors(mouth, target, pc);
        bulge = 1 + 0.45 * Math.sin(pc * Math.PI);
      }
      slot.model.setTongue(mouth, target, bulge);
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

  /** Lalat + cincin anchor + cincin emas + portal (dipakai solo dan co-op). */
  private syncShared(
    fliesGot: string[],
    usedAnchors: string[],
    ringsHit: string[],
    time: number,
    dt: number,
  ): void {
    // Lalat: melayang naik-turun + sayap mengepak; hilang saat dimakan.
    // Lalat yang dimakan lidah (F6.4) tersedot ke mulut pemakan
    // selama 0.18 detik sambil mengecil, baru hilang.
    for (const fly of this.flies) {
      const eaten = fliesGot.includes(fly.id);
      const suck = this.flySuck.get(fly.id);
      if (suck) {
        suck.t += dt;
        const p = Math.min(1, suck.t / 0.18);
        const slot = suck.slot === 1 && this.slot1 ? this.slot1 : this.slot0;
        const mouth = slot.model.group.position;
        const e = p * p;
        fly.group.position.set(
          suck.from.x + (mouth.x - suck.from.x) * e,
          suck.from.y + (mouth.y + 0.45 - suck.from.y) * e,
          suck.from.z + (mouth.z - suck.from.z) * e,
        );
        fly.group.scale.setScalar(1 - p * 0.7);
        if (p >= 1) {
          fly.group.visible = false;
          this.flySuck.delete(fly.id);
        }
        continue;
      }
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

    // Cincin emas (F6.2): berdenyut + bercahaya sebelum aktif, meredup
    // setelah aktif. Platform tersembunyi muncul saat cincinnya aktif.
    for (const v of this.ringVisuals) {
      const hit = ringsHit.includes(v.id);
      v.ring.scale.setScalar(hit ? 1 : pulse);
      v.mat.emissiveIntensity = hit ? 0.15 : 1.6;
    }
    for (const h of this.hiddenMeshes) {
      const show = ringsHit.includes(h.ringId);
      for (const m of h.meshes) m.visible = show;
    }
  }

  /** Sparkle biru cincin (F6.2): titik menyebar + jatuh + memudar,
   * dihapus setelah 0.9 detik. */
  private syncSparks(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.age += dt;
      const attr = s.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < s.vel.length / 3; j++) {
        const vx = s.vel[j * 3] ?? 0;
        const vz = s.vel[j * 3 + 2] ?? 0;
        const vy = (s.vel[j * 3 + 1] ?? 0) - 3 * dt;
        s.vel[j * 3 + 1] = vy;
        attr.setXYZ(
          j,
          attr.getX(j) + vx * dt,
          attr.getY(j) + vy * dt,
          attr.getZ(j) + vz * dt,
        );
      }
      attr.needsUpdate = true;
      const mat = s.points.material as THREE.PointsMaterial;
      mat.opacity = 0.95 * Math.max(0, 1 - s.age / 0.9);
      if (s.age >= 0.9) {
        this.scene.remove(s.points);
        s.points.geometry.dispose();
        mat.dispose();
        this.sparks.splice(i, 1);
      }
    }
  }

  /** Hati melayang ciuman (F6.8): naik + bergoyang + membesar lalu
   * memudar, dihapus setelah umurnya habis (~1.2-1.6 detik). */
  private syncHearts(dt: number): void {
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i]!;
      h.age += dt;
      const p = h.age / h.life;
      h.sprite.position.x +=
        (h.vel.x + Math.sin(h.age * 3 + h.phase) * 0.25) * dt;
      h.sprite.position.y += h.vel.y * dt;
      h.sprite.position.z += h.vel.z * dt;
      h.sprite.scale.setScalar(0.35 * (0.8 + 0.4 * Math.sin(Math.min(1, p) * Math.PI)));
      const mat = h.sprite.material as THREE.SpriteMaterial;
      mat.opacity = 0.95 * Math.max(0, 1 - p * p);
      if (p >= 1) {
        this.scene.remove(h.sprite);
        mat.dispose();
        this.hearts.splice(i, 1);
      }
    }
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

  /** Air selokan mengalir pelan (geser offset texture). */
  private syncWater(dt: number): void {
    if (!this.waterTex) return;
    this.waterTex.offset.x += dt * 0.008;
    this.waterTex.offset.y += dt * 0.005;
  }

  /** Sparkle melayang (F6.10): tiap titik bergoyang pelan di sekitar
   * posisi dasarnya (sinus beda fase, 90 titik = murah). */
  private syncSparkles(time: number): void {
    const s = this.sparkles;
    if (!s) return;
    const attr = s.points.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < s.phase.length; i++) {
      const ph = s.phase[i]!;
      attr.setXYZ(
        i,
        s.base[i * 3]! + Math.sin(time * 0.3 + ph) * 0.4,
        s.base[i * 3 + 1]! + Math.sin(time * 0.5 + ph * 1.7) * 0.35,
        s.base[i * 3 + 2]! + Math.cos(time * 0.25 + ph) * 0.4,
      );
    }
    attr.needsUpdate = true;
  }

  /** Render satu frame solo: sinkron state sim + gambar. */
  render(state: FrogGameState, alpha: number, time: number, dt: number): void {
    this.syncSlot(this.slot0, state.frog, state.tongue, alpha, dt);
    this.syncShared(state.fliesGot, [], state.ringsHit, time, dt);
    this.syncSparks(dt);
    this.syncHearts(dt);
    this.syncDoor(state.doorOpen, state.pressedButtons, dt);
    this.syncMovers(time);
    this.syncMushrooms(time, dt);
    this.syncWater(dt);
    this.syncSparkles(time);
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
    this.syncShared(view.fliesGot, view.usedAnchors, view.ringsHit, time, dt);
    this.syncSparks(dt);
    this.syncHearts(dt);
    this.syncDoor(view.doorOpen, view.pressedButtons, dt);
    this.syncMovers(time);
    this.syncMushrooms(time, dt);
    this.syncWater(dt);
    this.syncSparkles(time);
    const f = view.me.frog;
    this.syncCamera(dt, new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z));
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
