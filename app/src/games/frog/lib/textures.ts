// Texture HD (CC0) untuk game katak (F4). Pola sama seperti loader
// naval (getter sinkron + cache + fallback prosedural), ditambah
// normal map linear (tanpa SRGB) dan texture air prosedural yang
// dianimasikan lewat offset. File di public/textures/ (SOURCES.md).
// Getter naval (kayu, batu, rumput, logam) dipakai ulang lewat import.

import * as THREE from "three";
import {
  getFabricTexture,
  getGrassTexture,
  getMetalTexture,
  getRockTexture,
  getWoodTexture,
  proceduralRockTexture,
  proceduralWoodTexture,
} from "../../naval/lib/textures";

export {
  getFabricTexture,
  getGrassTexture,
  getMetalTexture,
  getRockTexture,
  getWoodTexture,
};

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
const loads: Promise<void>[] = [];

function setup<T extends THREE.Texture>(tex: T, srgb: boolean): T {
  // Normal map adalah data linear, bukan warna: tanpa SRGB.
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function paint(
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
  srgb = true,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  draw(c.getContext("2d")!, size);
  return setup(new THREE.CanvasTexture(c), srgb);
}

/** Bercak acak gelap-terang di atas warna dasar (fallback). */
function blotch(base: string, dark: string, light: string): THREE.CanvasTexture {
  return paint(256, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 220; i++) {
      g.fillStyle = Math.random() < 0.5 ? dark : light;
      g.globalAlpha = 0.08 + Math.random() * 0.15;
      g.beginPath();
      g.arc(Math.random() * s, Math.random() * s, 4 + Math.random() * 22, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

/** Normal map datar (tidak mengubah permukaan, fallback normal). */
function flatNormal(): THREE.CanvasTexture {
  return paint(64, (g, s) => {
    g.fillStyle = "#8080ff";
    g.fillRect(0, 0, s, s);
  }, false);
}

function get(
  key: string,
  file: string,
  srgb: boolean,
  fallback: () => THREE.Texture,
): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  let done!: () => void;
  loads.push(new Promise<void>((r) => { done = r; }));
  const tex: THREE.Texture = setup(
    loader.load(
      `/textures/${file}`,
      () => done(),
      undefined,
      () => {
        tex.image = fallback().image;
        tex.needsUpdate = true;
        done();
      },
    ),
    srgb,
  );
  cache.set(key, tex);
  return tex;
}

/** Bata merah (dinding bengkel + selokan). */
export function getBrickTexture(): THREE.Texture {
  return get("brick", "brick-wall.jpg", true, proceduralRockTexture);
}

export function getBrickNormalTexture(): THREE.Texture {
  return get("brick-n", "brick-wall-normal.jpg", false, flatNormal);
}

/** Kulit gelap bertekstur (sampul buku + bump kulit katak). */
export function getLeatherTexture(): THREE.Texture {
  return get("leather", "leather.jpg", true, () =>
    blotch("#4a3421", "#2a1a10", "#6a4a30"),
  );
}

export function getLeatherNormalTexture(): THREE.Texture {
  return get("leather-n", "leather-normal.jpg", false, flatNormal);
}

/** Kertas kraft (halaman buku raksasa di atap). */
export function getPaperTexture(): THREE.Texture {
  return get("paper", "paper.jpg", true, () =>
    blotch("#c8a878", "#a8885f", "#e0c193"),
  );
}

/** Lumut hijau (puncak platform taman + selokan). */
export function getMossTexture(): THREE.Texture {
  return get("moss", "moss.jpg", true, () =>
    blotch("#4a7a2a", "#35591d", "#649c3a"),
  );
}

/** Batu paving berlumut (platform selokan). */
export function getPavingTexture(): THREE.Texture {
  return get("paving", "paving.jpg", true, proceduralRockTexture);
}

export function getPavingNormalTexture(): THREE.Texture {
  return get("paving-n", "paving-normal.jpg", false, flatNormal);
}

/** Kayu gelap (rak, panel dinding, balok). File naval, belum ada getter. */
export function getWoodDarkTexture(): THREE.Texture {
  return get("wood-dark", "wood-dark.jpg", true, proceduralWoodTexture);
}

/** Air selokan prosedural: cincin riak + bintik cahaya di atas teal
 * gelap. Digambar berulang 3x3 supaya seamless saat di-repeat;
 * offset-nya digeser tiap frame di scene (air mengalir). */
let waterTex: THREE.CanvasTexture | null = null;
export function getWaterTexture(): THREE.CanvasTexture {
  if (waterTex) return waterTex;
  waterTex = paint(256, (g, s) => {
    g.fillStyle = "#14524a";
    g.fillRect(0, 0, s, s);
    // Riak: cincin tipis terang, digambar 9x (offset +-s) agar seamless.
    for (let i = 0; i < 26; i++) {
      const cx = Math.random() * s;
      const cy = Math.random() * s;
      const r = 8 + Math.random() * 30;
      g.strokeStyle = `rgba(180,255,230,${0.05 + Math.random() * 0.1})`;
      g.lineWidth = 1 + Math.random() * 1.5;
      for (const ox of [-s, 0, s]) {
        for (const oy of [-s, 0, s]) {
          g.beginPath();
          g.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }
    // Bintik cahaya + bayangan dalam.
    for (let i = 0; i < 300; i++) {
      g.fillStyle =
        Math.random() < 0.5 ? "rgba(220,255,240,0.06)" : "rgba(0,20,15,0.12)";
      g.beginPath();
      g.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  return waterTex;
}

/** RNG deterministik (mulberry32) supaya bintik katak sama tiap load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FROG_SKIN: Record<string, { base: string; spot: string; seed: number }> = {
  orange: { base: "#ff8c42", spot: "#3b82f6", seed: 42 },
  purple: { base: "#8b5cf6", spot: "#7dd3fc", seed: 77 },
};

/** Kulit katak ala Froggin: gradasi vertikal + bintik biru lembut.
 * UV bola: v=1 di atas (punggung), jadi bintik di separuh atas kanvas. */
const frogSkinCache = new Map<string, THREE.CanvasTexture>();
export function getFrogSkinTexture(color: string): THREE.CanvasTexture {
  const hit = frogSkinCache.get(color);
  if (hit) return hit;
  const skin = FROG_SKIN[color] ?? FROG_SKIN.orange!;
  const tex = paint(512, (g, s) => {
    g.fillStyle = skin.base;
    g.fillRect(0, 0, s, s);
    // Gradasi: lebih gelap di punggung, lebih terang di perut.
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, "rgba(0,0,0,0.20)");
    grad.addColorStop(0.5, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(255,255,255,0.14)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // Bintik biru (8, tepi lembut, di separuh atas = punggung).
    const r = rng(skin.seed);
    for (let i = 0; i < 8; i++) {
      const cx = r() * s;
      const cy = r() * s * 0.55;
      const rad = 10 + r() * 18;
      const spot = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      spot.addColorStop(0, skin.spot);
      spot.addColorStop(0.7, skin.spot);
      spot.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 0.85;
      g.fillStyle = spot;
      g.beginPath();
      g.arc(cx, cy, rad, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
  frogSkinCache.set(color, tex);
  return tex;
}

/** Bump halus kulit katak: bintik abu-abu kecil (bumpMap, bukan map). */
let skinBumpTex: THREE.CanvasTexture | null = null;
export function getSkinBumpTexture(): THREE.CanvasTexture {
  if (skinBumpTex) return skinBumpTex;
  skinBumpTex = paint(128, (g, s) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) {
      const v = 100 + Math.floor(Math.random() * 70);
      g.fillStyle = `rgba(${v},${v},${v},0.6)`;
      g.beginPath();
      g.arc(Math.random() * s, Math.random() * s, 0.8 + Math.random() * 2, 0, Math.PI * 2);
      g.fill();
    }
  }, false);
  return skinBumpTex;
}

export function preloadFrogTextures(): Promise<void> {
  getBrickTexture();
  getBrickNormalTexture();
  getLeatherTexture();
  getLeatherNormalTexture();
  getPaperTexture();
  getMossTexture();
  getPavingTexture();
  getPavingNormalTexture();
  getWoodDarkTexture();
  getWoodTexture();
  getRockTexture();
  getGrassTexture();
  getMetalTexture();
  return Promise.all(loads).then(() => undefined);
}
