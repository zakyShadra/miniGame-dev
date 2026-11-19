// Model kapal bajak laut kartun dari primitif Three.js (lambung papan
// kayu, layar melengkung, meriam, menara turet, bendera tengkorak).
// Kapal menghadap +z, titik asal di permukaan air tengah kapal.
// Skala referensi: Galleon (panjang 27 m); kapal lain diskala seragam.
// Tiap jenis kapal dibedakan jumlah tiang, warna lambung/layar, dan
// jumlah meriam (sesuai preview yang di-approve Zaky).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { getDeckTexture, getFabricTexture, getMetalTexture, getWoodTexture } from "./textures";
import type { ShipDef } from "../../../../../shared/naval/types";

export interface ShipModel {
  group: THREE.Group;
  /** Menara meriam (putar rotation.y untuk aim). */
  turret: THREE.Group;
  /** Bendera di tiang utama (animasikan goyangannya). */
  flag: THREE.Mesh;
}

function std(color: string, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

/** Lambung + bagian kayu merged: warna cat (vertex) + relief serat kayu. */
const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, bumpMap: getWoodTexture(), bumpScale: 0.03 });

/** Dek: warna kayu dari texture + variasi terang per papan (vertex). */
const deckMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, map: getDeckTexture() });

/** Material vertex-color logam (meriam, sangkar lentera, as kemudi). */
const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true, bumpMap: getMetalTexture(), bumpScale: 0.02 });

// Anyaman kain diulang 4x di setiap layar (serat halus).
getFabricTexture().repeat.set(4, 4);

/** Tambah warna vertex solid ke geometri (syarat mergeGeometries). */
function paint(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = (geo.attributes.position as THREE.BufferAttribute).count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Pindah + putar geometri di tempat (Euler XYZ, radian). */
function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  geo.applyMatrix4(m);
  return geo;
}

/** Penyempitan lambung di haluan/buritan: 1 di tengah, 0 di ujung. */
function taperAt(t: number): number {
  return Math.pow(1 - Math.pow(2 * t - 1, 2), 0.65);
}

/** Satu titik di permukaan lambung: t = 0 buritan, 1 haluan;
 *  s = 0 tepi dek kanan, 0.5 lunas, 1 tepi dek kiri. */
function hullPoint(t: number, s: number, length: number, beam: number): [number, number, number] {
  const z = (t - 0.5) * length;
  const halfBeam = Math.max(0.05, (beam / 2) * taperAt(t));
  const deckY = 2.4 + 1.1 * Math.pow(Math.abs(2 * t - 1), 2.2);
  const ky = -1.6 + 1.2 * Math.pow(Math.abs(2 * t - 1), 6);
  const ang = s * Math.PI;
  return [halfBeam * Math.cos(ang), deckY - (deckY - ky) * Math.pow(Math.sin(ang), 0.8), z];
}

/** Loft lambung utuh (dipakai backing gelap di balik papan). */
function loftGeometry(length: number, beam: number): THREE.BufferGeometry {
  const stations = 12;
  const sectionPts = 9;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= stations; i++) {
    for (let j = 0; j <= sectionPts; j++) {
      positions.push(...hullPoint(i / stations, j / sectionPts, length, beam));
    }
  }
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < sectionPts; j++) {
      const a = i * (sectionPts + 1) + j;
      const b = a + sectionPts + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Acak deterministik 0..1 dari dua indeks (variasi warna papan stabil). */
function hash2(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface PlankDef {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Offset lightness (variasi antar papan). */
  shade: number;
}

/** Satu merged geometry dari strip papan: tiap papan punya vertex sendiri
 *  (celah antar papan) dan warna sendiri (variasi vertex color). */
function buildPlanks(
  point: (u: number, v: number) => [number, number, number],
  planks: PlankDef[],
  base: string,
  steps = 4,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color(base);
  for (let pi = 0; pi < planks.length; pi++) {
    const p = planks[pi]!;
    const pc = c.clone().offsetHSL(0, 0, p.shade);
    const start = positions.length / 3;
    // UV: tiap papan mengambil irisan vertikal berbeda dari texture kayu
    // (serat berbeda per papan), diulang 2x sepanjang papan.
    const vBase = hash2(pi, 7) * 0.85;
    for (let i = 0; i <= steps; i++) {
      const u = p.u0 + ((p.u1 - p.u0) * i) / steps;
      const uu = (i / steps) * 2;
      for (const v of [p.v0, p.v1]) {
        positions.push(...point(u, v));
        colors.push(pc.r, pc.g, pc.b);
        uvs.push(uu, vBase + ((v - p.v0) / (p.v1 - p.v0)) * 0.13);
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = start + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Sambungan papan sepanjang kapal, staggered per baris (joint tidak sejajar).
 *  Mengembalikan daftar [t0, t1] yang sudah dipotong ke [0, 1]. */
function plankJoints(row: number, segs: number, gap: number): [number, number][] {
  const segLen = 1 / segs;
  const shift = (row % 3) * (segLen / 3);
  const out: [number, number][] = [];
  for (let i = 0; i <= segs; i++) {
    const t0 = Math.max(0, i * segLen - shift) + gap;
    const t1 = Math.min(1, (i + 1) * segLen - shift) - gap;
    if (t1 - t0 >= 0.01) out.push([t0, t1]);
  }
  return out;
}

/** Lambung papan-per-papan: 6 strake per sisi, sambungan staggered;
 *  backing gelap di dalam supaya celah terbaca gelap, bukan tembus. */
function buildHull(length: number, beam: number, color: string): THREE.Group {
  const strakes = 12;
  const gapS = 0.0022;
  const planks: PlankDef[] = [];
  for (let k = 0; k < strakes; k++) {
    const sMid = (k + 0.5) / strakes;
    for (const [t0, t1] of plankJoints(k, 5, 0.0009)) {
      planks.push({
        u0: t0,
        u1: t1,
        v0: k / strakes + gapS,
        v1: (k + 1) / strakes - gapS,
        // Variasi kuat supaya papan terbaca juga di lambung gelap.
        shade: (hash2(k, Math.round(t0 * 100)) - 0.5) * 0.2 - Math.sin(sMid * Math.PI) * 0.03,
      });
    }
  }
  const group = new THREE.Group();
  group.add(new THREE.Mesh(buildPlanks((u, v) => hullPoint(u, v, length, beam), planks, color), hullMat));
  // DoubleSide: celah dek melihat sisi dalam backing (gelap), bukan tembus.
  const backing = new THREE.Mesh(
    loftGeometry(length, beam * 0.97),
    new THREE.MeshStandardMaterial({ color: "#17100b", roughness: 1, side: THREE.DoubleSide }),
  );
  group.add(backing);
  return group;
}

/** Geladak papan fore-aft: strip memanjang dengan sambungan staggered. */
function buildDeck(length: number, beam: number, color: string): THREE.Mesh {
  const strips = Math.max(6, Math.round(beam / 0.55));
  const segs = Math.max(2, Math.round(length / 4.5));
  const gapV = 0.004;
  const planks: PlankDef[] = [];
  for (let k = 0; k < strips; k++) {
    for (const [t0, t1] of plankJoints(k, segs, 0.0006)) {
      planks.push({
        u0: t0,
        u1: t1,
        v0: -1 + (2 * k) / strips + gapV,
        v1: -1 + (2 * (k + 1)) / strips - gapV,
        shade: (hash2(k + 40, Math.round(t0 * 100)) - 0.5) * 0.1,
      });
    }
  }
  return new THREE.Mesh(
    buildPlanks((u, v) => {
      const hw = Math.max(0.05, (beam / 2) * taperAt(u) * 0.96);
      return [v * hw, 2.42, (u - 0.5) * length];
    }, planks, color),
    deckMat,
  );
}

/** Tekstur layar digambar di canvas: warna dasar + jahitan kain panel,
 *  opsional tengkorak putih besar di tengah (layar musuh). */
function sailTexture(base: string, skull: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 192;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 192);
  // Jahitan panel kain (garis horizontal + vertikal samar).
  g.strokeStyle = "rgba(0,0,0,0.12)";
  g.lineWidth = 2;
  for (const y of [48, 96, 144]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  for (const x of [64, 128, 192]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 192);
    g.stroke();
  }
  if (skull) {
    g.fillStyle = "#f5f0e6";
    g.beginPath();
    g.arc(128, 84, 42, 0, Math.PI * 2);
    g.fill();
    g.fillRect(104, 112, 48, 30);
    g.fillStyle = base;
    g.beginPath();
    g.arc(112, 80, 12, 0, Math.PI * 2);
    g.arc(144, 80, 12, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(128, 96);
    g.lineTo(120, 112);
    g.lineTo(136, 112);
    g.closePath();
    g.fill();
    g.strokeStyle = base;
    g.lineWidth = 4;
    for (const x of [116, 128, 140]) {
      g.beginPath();
      g.moveTo(x, 120);
      g.lineTo(x, 138);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Layar persegi yang mengembung (vertex dibengkokkan). Emissive ringan
 *  supaya layar krem tetap terbaca krem dari sisi bayangan. */
function buildSail(width: number, height: number, tex: THREE.Texture, base: string): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, height, 6, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / width + 0.5;
    const v = pos.getY(i) / height + 0.5;
    pos.setZ(i, Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * width * 0.12);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.9,
    flatShading: true,
    side: THREE.DoubleSide,
    emissive: base,
    emissiveIntensity: 0.2,
    bumpMap: getFabricTexture(),
    bumpScale: 0.015,
  });
  return new THREE.Mesh(geo, mat);
}

/** Tekstur bendera tengkorak digambar di canvas (tanpa file eksternal). */
function skullTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 80;
  const g = c.getContext("2d")!;
  g.fillStyle = "#141414";
  g.fillRect(0, 0, 128, 80);
  g.fillStyle = "#f5f0e6";
  g.beginPath();
  g.arc(64, 32, 21, 0, Math.PI * 2);
  g.fill();
  g.fillRect(52, 46, 24, 16);
  g.fillStyle = "#141414";
  g.beginPath();
  g.arc(56, 30, 6, 0, Math.PI * 2);
  g.arc(72, 30, 6, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(64, 38);
  g.lineTo(60, 46);
  g.lineTo(68, 46);
  g.closePath();
  g.fill();
  g.strokeStyle = "#141414";
  g.lineWidth = 2;
  for (const x of [58, 64, 70]) {
    g.beginPath();
    g.moveTo(x, 50);
    g.lineTo(x, 60);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Konfigurasi tiang per jumlah tiang (z relatif panjang, tinggi). */
function mastConfigs(count: number, length: number, beam: number, s: number): {
  z: number;
  h: number;
  sailW: number;
  sailH: number;
}[] {
  if (count <= 0) return [];
  if (count === 1) return [{ z: -length * 0.05, h: 15 * s, sailW: beam * 1.3, sailH: 7.5 * s }];
  if (count === 3) {
    return [
      { z: length * 0.26, h: 12 * s, sailW: beam * 0.95, sailH: 6 * s },
      { z: 0, h: 16.5 * s, sailW: beam * 1.25, sailH: 7.5 * s },
      { z: -length * 0.24, h: 11 * s, sailW: beam * 0.85, sailH: 5.5 * s },
    ];
  }
  // Default 2 tiang (frigate / kapal perang).
  return [
    { z: length * 0.22, h: 13.5 * s, sailW: beam * 1.05, sailH: 6.5 * s },
    { z: -length * 0.1, h: 16 * s, sailW: beam * 1.25, sailH: 7.5 * s },
  ];
}

export function buildShipModel(
  def: ShipDef,
  opts: { enemy?: boolean } = {},
): ShipModel {
  const s = def.length / 27; // skala seragam dari referensi Galleon
  const group = new THREE.Group();
  const length = def.length;
  const beam = def.beam;
  const wood = std(def.hullColor);
  wood.bumpMap = getWoodTexture();
  wood.bumpScale = 0.02;
  const woodDark = std("#4a3220");
  woodDark.bumpMap = getWoodTexture();
  woodDark.bumpScale = 0.02;
  const metal = new THREE.MeshStandardMaterial({ color: "#2a2a2e", roughness: 0.6, flatShading: true, bumpMap: getMetalTexture(), bumpScale: 0.02 });
  // Bagian kecil dikumpul lalu di-merge jadi 2 mesh di akhir (kayu + logam).
  const woodParts: THREE.BufferGeometry[] = [];
  const metalParts: THREE.BufferGeometry[] = [];
  // Musuh (dummy): layar merah + tengkorak besar, ala Galleon musuh di preview.
  const sailColor = opts.enemy ? "#c0392b" : def.sailColor;
  const sailTex = sailTexture(sailColor, opts.enemy ?? false);

  group.add(buildHull(length, beam, def.hullColor));
  // Dek putih + variasi: warna kayu datang dari texture, bukan vertex color.
  group.add(buildDeck(length, beam, "#ffffff"));

  // Kastil buritan + atap + jendela.
  const castle = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.72, 2.4, length * 0.2), wood);
  castle.position.set(0, 3.5, -length * 0.32);
  group.add(castle);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.78, 0.3, length * 0.22), woodDark);
  roof.position.set(0, 4.8, -length * 0.32);
  group.add(roof);
  const winMat = new THREE.MeshStandardMaterial({ color: "#ffd97a", emissive: "#ffb347", emissiveIntensity: 0.7 });
  for (const wx of [-1.4, 0, 1.4]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.15), winMat);
    win.position.set(wx * s, 3.6, -length * 0.32 - length * 0.1 - 0.05);
    group.add(win);
  }

  // Sprit haluan + figurehead.
  const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 7, 6), woodDark);
  sprit.position.set(0, 3.6, length * 0.58);
  sprit.rotation.x = Math.PI / 2 - 0.5;
  group.add(sprit);
  // Figurehead burung stilasi: badan + kepala + paruh emas + sayap.
  const fy = 2.6;
  const fz = length * 0.52;
  woodParts.push(paint(place(new THREE.ConeGeometry(0.34, 1.5, 6), 0, fy, fz, Math.PI / 2), def.trimColor));
  woodParts.push(paint(place(new THREE.SphereGeometry(0.26, 8, 8), 0, fy + 0.25, fz + 0.55), def.trimColor));
  woodParts.push(paint(place(new THREE.ConeGeometry(0.1, 0.45, 6), 0, fy + 0.22, fz + 0.95, Math.PI / 2), "#e8b94a"));
  for (const side of [-1, 1]) {
    woodParts.push(paint(place(new THREE.BoxGeometry(0.1, 0.55, 0.9), side * 0.32, fy + 0.12, fz - 0.05, 0, -side * 0.4, side * 0.3), def.trimColor));
  }

  // Ornamen emas di lambung Galleon (stud emas di kedua sisi).
  if (def.id === "galleon") {
    const gold = std("#e8b94a", 0.5);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const gz = -length * 0.28 + i * length * 0.14;
        const taper = Math.pow(1 - Math.pow((2 * gz) / length, 2), 0.65);
        const stud = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), gold);
        stud.position.set(side * ((beam / 2) * taper * 1.0), 1.9, gz);
        group.add(stud);
      }
    }
  }

  // Tiang + layar (jumlah sesuai jenis kapal; 0 = kapal selam).
  const masts = mastConfigs(def.masts, length, beam, s);
  let mainMast = masts[0] ?? { z: 0, h: 10, sailW: 0, sailH: 0 };
  const rigPts: number[] = [];
  for (const m of masts) {
    if (m.h > mainMast.h) mainMast = m;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, m.h, 6), woodDark);
    mast.position.set(0, 2.4 + m.h / 2, m.z);
    group.add(mast);
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, m.sailW + 1, 6), woodDark);
    yard.rotation.z = Math.PI / 2;
    yard.position.set(0, 2.4 + m.h * 0.82, m.z);
    group.add(yard);
    const sail = buildSail(m.sailW, m.sailH, sailTex, sailColor);
    sail.position.set(0, 2.4 + m.h * 0.82 - m.sailH / 2 - 0.2, m.z);
    group.add(sail);
    // Tali-temali: puncak tiang ke haluan/buritan.
    const topY = 2.4 + m.h;
    rigPts.push(0, topY, m.z, 0, 3.4, length * 0.52);
    rigPts.push(0, topY, m.z, 0, 4.9, -length * 0.42);
    // Shroud: puncak tiang ke pagar (3 titik per sisi).
    for (const side of [-1, 1]) {
      for (const dz of [-2, 0, 2]) {
        rigPts.push(0, topY, m.z, side * beam * 0.47, 3.2, m.z + dz);
      }
    }
  }
  if (rigPts.length > 0) {
    const rigGeo = new THREE.BufferGeometry();
    rigGeo.setAttribute("position", new THREE.Float32BufferAttribute(rigPts, 3));
    group.add(
      new THREE.LineSegments(
        rigGeo,
        new THREE.LineBasicMaterial({ color: "#2a2018", transparent: true, opacity: 0.55 }),
      ),
    );
  }

  // Kapal selam (tanpa tiang): menara conning membulat + periskop +
  // sirip selam haluan/buritan.
  if (def.masts === 0) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 2.2, 10), std(def.hullColor, 0.6));
    tower.position.set(0, 3.4, -length * 0.05);
    group.add(tower);
    const towerCap = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(def.hullColor, 0.6));
    towerCap.position.set(0, 4.5, -length * 0.05);
    group.add(towerCap);
    const peri = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.6, 6), metal);
    peri.position.set(0, 5.6, length * 0.02);
    group.add(peri);
    const periTop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.1), metal);
    periTop.position.set(0, 6.8, length * 0.02 + 0.4);
    group.add(periTop);
    // Sirip selam: sepasang di haluan + buritan.
    for (const fz of [length * 0.3, -length * 0.32]) {
      for (const side of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 1.1), std(def.trimColor, 0.7));
        fin.position.set(side * (beam * 0.42), 0.6, fz);
        group.add(fin);
      }
    }
    // Palka dek (lingkaran trim di geladak).
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.25, 12), std(def.trimColor, 0.7));
    hatch.position.set(0, 2.55, length * 0.22);
    group.add(hatch);
  }

  // Layar segitiga (jib) di haluan (hanya kapal berlayar).
  if (def.masts > 0) {
    const jibShape = new THREE.Shape();
    jibShape.moveTo(6, 2.5);
    jibShape.lineTo(14.5, 2.5);
    jibShape.lineTo(8, 11.5);
    jibShape.closePath();
    const jib = new THREE.Mesh(
      new THREE.ShapeGeometry(jibShape),
      new THREE.MeshStandardMaterial({
        map: sailTex,
        roughness: 0.9,
        side: THREE.DoubleSide,
        emissive: sailColor,
        emissiveIntensity: 0.2,
        bumpMap: getFabricTexture(),
        bumpScale: 0.015,
      }),
    );
    jib.rotation.y = -Math.PI / 2;
    jib.scale.setScalar(s);
    group.add(jib);
  }

  // Meriam broadside: laras (ujung tipis di luar) + ring moncong + kereta
  // + roda; baris bawah tanpa kereta (di bawah air, tak terlihat).
  const rows = def.cannonsPerSide >= 6 ? 2 : 1;
  for (let r = 0; r < rows; r++) {
    const count = r === 0 ? def.cannonsPerSide : def.cannonsPerSide - 2;
    const y = r === 0 ? 1.3 : 0.1;
    const cr = r === 0 ? 0.26 : 0.2;
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const cz = count === 1 ? 0 : -length * 0.18 + (i / (count - 1)) * length * 0.36;
        const hx = side * ((beam / 2) * taperAt(cz / length + 0.5) * 0.98);
        metalParts.push(paint(place(new THREE.CylinderGeometry(cr + 0.04, cr, 1.8, 8), hx, y, cz, 0, side * 0.12, (Math.PI / 2) * side), "#2a2a2e"));
        metalParts.push(paint(place(new THREE.TorusGeometry(cr + 0.02, 0.05, 5, 12), hx + side * 0.85, y, cz - side * 0.11, 0, Math.PI / 2, 0), "#2a2a2e"));
        if (r === 0) {
          woodParts.push(paint(place(new THREE.BoxGeometry(0.6, 0.45, 0.8), hx - side * 0.25, y - 0.35, cz), "#4a3220"));
          for (const wz of [-0.35, 0.35]) {
            woodParts.push(paint(place(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 10), hx - side * 0.15, y - 0.55, cz + wz, Math.PI / 2, 0, 0), "#4a3220"));
          }
        }
      }
    }
  }

  // Menara meriam (bisa diputar untuk aim).
  const turret = new THREE.Group();
  const tBase = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.8, 10), metal);
  tBase.position.y = 0.4;
  turret.add(tBase);
  const tDome = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.9, 10), std("#3d3d44", 0.6));
  tDome.position.y = 1.2;
  turret.add(tDome);
  for (const bx of [-0.6, 0.6]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 3.4, 8), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(bx, 1.35, 1.6);
    turret.add(barrel);
  }
  turret.position.set(0, 2.42, length * 0.02);
  turret.scale.setScalar(s);
  group.add(turret);

  // Bendera tengkorak di puncak tiang utama (kapal berlayar saja).
  // Bendera bergelombang statis (ujung bebas melambai, pangkal diam di tiang).
  const flagGeo = new THREE.PlaneGeometry(1.7, 1.05, 8, 3);
  const fp = flagGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < fp.count; i++) {
    const fly = fp.getX(i) / 1.7 + 0.5;
    fp.setZ(i, Math.sin(fly * Math.PI * 1.5) * 0.14 * fly);
  }
  flagGeo.computeVertexNormals();
  const flag = new THREE.Mesh(
    flagGeo,
    new THREE.MeshStandardMaterial({ map: skullTexture(), side: THREE.DoubleSide, roughness: 0.9 }),
  );
  if (masts.length > 0) {
    flag.position.set(0.85, 2.4 + mainMast.h - 0.6, mainMast.z);
  } else {
    flag.position.set(0.85, 5.4, -length * 0.05);
  }
  group.add(flag);

  // Lentera buritan (emissive, tanpa cahaya beneran).
  const lampMat = new THREE.MeshStandardMaterial({ color: "#ffb347", emissive: "#ff9a2e", emissiveIntensity: 1.4 });
  for (const lx of [-1.6, 1.6]) {
    const cx = lx * s;
    const cz = -length * 0.43;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), lampMat);
    lamp.position.set(cx, 4.4, cz);
    group.add(lamp);
    // Sangkar lentera: 2 ring + 4 jeruji + tutup kerucut.
    for (const ry of [4.12, 4.68]) {
      metalParts.push(paint(place(new THREE.TorusGeometry(0.32, 0.035, 5, 16), cx, ry, cz, Math.PI / 2, 0, 0), "#2a2a2e"));
    }
    for (const [ox, oz] of [[-0.3, 0], [0.3, 0], [0, -0.3], [0, 0.3]] as const) {
      metalParts.push(paint(place(new THREE.BoxGeometry(0.05, 0.56, 0.05), cx + ox, 4.4, cz + oz), "#2a2a2e"));
    }
    metalParts.push(paint(place(new THREE.ConeGeometry(0.36, 0.25, 8), cx, 4.8, cz), "#2a2a2e"));
  }

  // Pagar geladak: tiang + rel atas mengikuti taper lambung.
  for (const side of [-1, 1]) {
    let prev: [number, number] | undefined;
    for (let i = 0; i <= 8; i++) {
      const t = 0.28 + (i / 8) * 0.58;
      const x = side * ((beam / 2) * taperAt(t) * 0.96 * 0.98);
      const z = (t - 0.5) * length;
      woodParts.push(paint(place(new THREE.BoxGeometry(0.09, 0.75, 0.09), x, 2.8, z), "#4a3220"));
      if (prev) {
        const [px, pz] = prev;
        const dx = x - px;
        const dz = z - pz;
        woodParts.push(paint(place(new THREE.BoxGeometry(0.1, 0.12, Math.hypot(dx, dz) + 0.12), (px + x) / 2, 3.2, (pz + z) / 2, 0, Math.atan2(dx, dz), 0), "#4a3220"));
      }
      prev = [x, z];
    }
  }

  // Kemudi: roda + 4 jari-jari + dudukan di depan kastil buritan.
  const wz = -length * 0.18;
  woodParts.push(paint(place(new THREE.TorusGeometry(0.85, 0.08, 6, 24), 0, 3.5, wz), "#4a3220"));
  for (let i = 0; i < 4; i++) {
    woodParts.push(paint(place(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 5), 0, 3.5, wz, 0, 0, (i * Math.PI) / 4), "#4a3220"));
  }
  woodParts.push(paint(place(new THREE.SphereGeometry(0.16, 8, 8), 0, 3.5, wz), def.trimColor));
  for (const side of [-1, 1]) {
    woodParts.push(paint(place(new THREE.BoxGeometry(0.12, 1.15, 0.12), side * 0.4, 2.98, wz - 0.12), "#4a3220"));
  }
  metalParts.push(paint(place(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6), 0, 3.5, wz - 0.15, Math.PI / 2, 0, 0), "#2a2a2e"));

  // Gabung semua bagian kecil jadi 2 draw call (kayu + logam).
  const woodGeo = mergeGeometries(woodParts, false);
  if (woodGeo) group.add(new THREE.Mesh(woodGeo, hullMat));
  const metalGeo = mergeGeometries(metalParts, false);
  if (metalGeo) group.add(new THREE.Mesh(metalGeo, metalMat));

  return { group, turret, flag };
}
