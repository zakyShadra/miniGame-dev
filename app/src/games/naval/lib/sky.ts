// Langit naval: kubah gradasi (vertex colors), matahari + glow canvas,
// awan low-poly. Elemen langit kebal fog. Tanpa texture eksternal.

import * as THREE from "three";
import { mulberry32 } from "../../../../../shared/game/prng";

/** Biru terang di horizon; dipakai juga sebagai warna fog + background. */
export const HORIZON_COLOR = 0xcfe9f7;
const ZENITH_COLOR = 0x2b7cd3;
const BELOW_COLOR = 0x9cc8e6;

// Kubah langit: sphere dilihat dari dalam, gradasi horizon ke zenith.
// Digambar paling dulu tanpa menulis depth.
export function buildSkyDome(): THREE.Mesh {
  const radius = 1400;
  const geo = new THREE.SphereGeometry(radius, 24, 16);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const horizon = new THREE.Color(HORIZON_COLOR);
  const zenith = new THREE.Color(ZENITH_COLOR);
  const below = new THREE.Color(BELOW_COLOR);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;
    if (y >= 0) c.lerpColors(horizon, zenith, Math.pow(y, 0.5));
    else c.lerpColors(horizon, below, Math.min(1, -y * 4));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function sunGlowTexture(): THREE.CanvasTexture {
  const s = 256;
  const cv = document.createElement("canvas");
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,244,200,0.9)");
  g.addColorStop(0.25, "rgba(255,236,170,0.45)");
  g.addColorStop(1, "rgba(255,236,170,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Matahari: cakram terang + sprite glow aditif. Arahnya harus sama dengan
 * posisi directional light supaya bayangan cahaya konsisten.
 */
export function buildSun(direction: THREE.Vector3): THREE.Group {
  const distance = 1250;
  const g = new THREE.Group();
  const dir = direction.clone().normalize();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(55, 32),
    new THREE.MeshBasicMaterial({
      color: 0xfff6d8,
      fog: false,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
    }),
  );
  disc.position.copy(dir).multiplyScalar(distance);
  disc.lookAt(0, 0, 0);
  g.add(disc);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunGlowTexture(),
      transparent: true,
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(420);
  glow.position.copy(dir).multiplyScalar(distance - 10);
  g.add(glow);
  return g;
}

// Awan low-poly: 4-7 puff per awan, ukuran bervariasi, sesekali besar;
// puff bawah sedikit lebih gelap supaya ada volume.
export function buildClouds(): THREE.Group[] {
  const count = 10;
  const rng = mulberry32(99);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    flatShading: true,
    emissive: 0x777777,
    emissiveIntensity: 0.55,
    fog: false,
  });
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xdfe9f2,
    roughness: 1,
    flatShading: true,
    emissive: 0x666666,
    emissiveIntensity: 0.5,
    fog: false,
  });
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group();
    const n = 4 + Math.floor(rng() * 4);
    const big = rng() > 0.7;
    for (let j = 0; j < n; j++) {
      const r = (5 + rng() * 9) * (big ? 1.5 : 1);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), j % 3 === 2 ? shadeMat : mat);
      puff.position.set((j - (n - 1) / 2) * r * 1.05, rng() * 2.5 - 1, rng() * 8 - 4);
      puff.scale.y = 0.5;
      cloud.add(puff);
    }
    cloud.position.set(rng() * 1400 - 700, 75 + rng() * 45, rng() * 1400 - 700);
    clouds.push(cloud);
  }
  return clouds;
}
