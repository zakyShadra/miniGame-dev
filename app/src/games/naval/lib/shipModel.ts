// Model kapal bajak laut kartun dari primitif Three.js (loft lambung,
// layar melengkung, meriam, menara turet, bendera tengkorak).
// Kapal menghadap +z, titik asal di permukaan air tengah kapal.
// Skala referensi: Galleon (panjang 27 m); kapal lain diskala seragam.

import * as THREE from "three";
import type { ShipDef } from "./types";

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

/** Lambung dari loft penampang U (10 stasiun, 9 titik per penampang). */
function buildHull(length: number, beam: number, color: string): THREE.Mesh {
  const stations = 12;
  const sectionPts = 9;
  const deckY0 = 2.4;
  const keelY = -1.6;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations; // 0 = buritan, 1 = haluan
    const z = (t - 0.5) * length;
    const taper = Math.pow(1 - Math.pow(2 * t - 1, 2), 0.65);
    const halfBeam = Math.max(0.05, (beam / 2) * taper);
    const sheer = 1.1 * Math.pow(Math.abs(2 * t - 1), 2.2);
    const deckY = deckY0 + sheer;
    const keelRise = 1.2 * Math.pow(Math.abs(2 * t - 1), 6);
    const ky = keelY + keelRise;
    for (let j = 0; j <= sectionPts; j++) {
      const s = j / sectionPts;
      const ang = s * Math.PI;
      const x = halfBeam * Math.cos(ang);
      const y = deckY - (deckY - ky) * Math.pow(Math.sin(ang), 0.8);
      positions.push(x, y, z);
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
  return new THREE.Mesh(geo, std(color));
}

/** Geladak datar mengikuti taper lambung. */
function buildDeck(length: number, beam: number, color: string): THREE.Mesh {
  const stations = 12;
  const y = 2.42;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const z = (t - 0.5) * length;
    const taper = Math.pow(1 - Math.pow(2 * t - 1, 2), 0.65);
    const hw = Math.max(0.05, (beam / 2) * taper * 0.96);
    positions.push(-hw, y, z, hw, y, z);
  }
  for (let i = 0; i < stations; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, std(color, 0.9));
}

/** Layar persegi yang mengembung (vertex dibengkokkan). */
function buildSail(width: number, height: number, color: string): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, height, 6, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / width + 0.5;
    const v = pos.getY(i) / height + 0.5;
    pos.setZ(i, Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * width * 0.12);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    flatShading: true,
    side: THREE.DoubleSide,
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

export function buildShipModel(
  def: ShipDef,
  opts: { sailColor?: string; hullColor?: string } = {},
): ShipModel {
  const s = def.length / 27; // skala seragam dari referensi Galleon
  const group = new THREE.Group();
  const length = def.length;
  const beam = def.beam;
  const wood = std(opts.hullColor ?? def.hullColor);
  const woodLight = std("#a67c52");
  const woodDark = std("#4a3220");
  const metal = std("#2a2a2e", 0.6);
  const sailColor = opts.sailColor ?? def.sailColor;

  group.add(buildHull(length, beam, opts.hullColor ?? def.hullColor));
  group.add(buildDeck(length, beam, "#a67c52"));

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
  const figure = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 6), std(def.trimColor, 0.7));
  figure.position.set(0, 2.6, length * 0.52);
  figure.rotation.x = Math.PI / 2;
  group.add(figure);

  // Tiang + layar (depan + utama).
  const masts: { z: number; h: number; sailW: number; sailH: number }[] = [
    { z: length * 0.22, h: 13.5 * s, sailW: beam * 1.05, sailH: 6.5 * s },
    { z: -length * 0.1, h: 16 * s, sailW: beam * 1.25, sailH: 7.5 * s },
  ];
  const rigPts: number[] = [];
  for (const m of masts) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, m.h, 6), woodDark);
    mast.position.set(0, 2.4 + m.h / 2, m.z);
    group.add(mast);
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, m.sailW + 1, 6), woodDark);
    yard.rotation.z = Math.PI / 2;
    yard.position.set(0, 2.4 + m.h * 0.82, m.z);
    group.add(yard);
    const sail = buildSail(m.sailW, m.sailH, sailColor);
    sail.position.set(0, 2.4 + m.h * 0.82 - m.sailH / 2 - 0.2, m.z);
    group.add(sail);
    // Tali-temali: puncak tiang ke haluan/buritan.
    const topY = 2.4 + m.h;
    rigPts.push(0, topY, m.z, 0, 3.4, length * 0.52);
    rigPts.push(0, topY, m.z, 0, 4.9, -length * 0.42);
    rigPts.push(0, topY, m.z, beam * 0.5, 2.6, m.z + 3);
    rigPts.push(0, topY, m.z, -beam * 0.5, 2.6, m.z + 3);
  }
  const rigGeo = new THREE.BufferGeometry();
  rigGeo.setAttribute("position", new THREE.Float32BufferAttribute(rigPts, 3));
  group.add(
    new THREE.LineSegments(
      rigGeo,
      new THREE.LineBasicMaterial({ color: "#2a2018", transparent: true, opacity: 0.55 }),
    ),
  );

  // Layar segitiga (jib) di haluan.
  const jibShape = new THREE.Shape();
  jibShape.moveTo(6, 2.5);
  jibShape.lineTo(14.5, 2.5);
  jibShape.lineTo(8, 11.5);
  jibShape.closePath();
  const jib = new THREE.Mesh(
    new THREE.ShapeGeometry(jibShape),
    new THREE.MeshStandardMaterial({ color: sailColor, roughness: 0.9, side: THREE.DoubleSide }),
  );
  jib.rotation.y = -Math.PI / 2;
  jib.scale.setScalar(s);
  group.add(jib);

  // Meriam samping (hiasan, 3 per sisi).
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const cz = -length * 0.18 + i * length * 0.16;
      const taper = Math.pow(1 - Math.pow((2 * cz) / length, 2), 0.65);
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.8, 8), metal);
      cannon.rotation.z = (Math.PI / 2) * side;
      cannon.rotation.y = side * 0.12;
      cannon.position.set(side * ((beam / 2) * taper * 0.98), 1.3, cz);
      group.add(cannon);
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

  // Bendera tengkorak di puncak tiang utama.
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.05),
    new THREE.MeshStandardMaterial({ map: skullTexture(), side: THREE.DoubleSide, roughness: 0.9 }),
  );
  flag.position.set(0.85, 2.4 + 16 * s - 0.6, -length * 0.1);
  group.add(flag);

  // Lentera buritan (emissive, tanpa cahaya beneran).
  const lampMat = new THREE.MeshStandardMaterial({ color: "#ffb347", emissive: "#ff9a2e", emissiveIntensity: 1.4 });
  for (const lx of [-1.6, 1.6]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), lampMat);
    lamp.position.set(lx * s, 4.4, -length * 0.43);
    group.add(lamp);
  }

  // Pagar geladak (rail tipis di kedua sisi).
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, length * 0.62), woodDark);
    rail.position.set(side * beam * 0.47, 2.9, length * 0.02);
    group.add(rail);
  }

  return { group, turret, flag };
}
