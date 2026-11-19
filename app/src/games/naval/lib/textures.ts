// Texture HD (CC0) untuk game naval. File di public/textures/ (lihat SOURCES.md).
// Getter mengembalikan texture langsung (gambar mengalir async); bila file gagal
// dimuat, texture diisi fallback prosedural supaya game tetap jalan.

import * as THREE from "three";

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
const loads: Promise<void>[] = [];

function setup<T extends THREE.Texture>(tex: T): T {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function paint(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  draw(c.getContext("2d")!, size);
  return setup(new THREE.CanvasTexture(c));
}

/** Papan horizontal + garis serat gelap. */
export function proceduralWoodTexture(): THREE.CanvasTexture {
  return paint(256, (g, s) => {
    g.fillStyle = "#8a5a2e";
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) {
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(0, y, s, 2);
      for (let i = 0; i < 8; i++) {
        g.strokeStyle = `rgba(60,30,10,${0.1 + Math.random() * 0.2})`;
        g.beginPath();
        const yy = y + 4 + Math.random() * 24;
        g.moveTo(0, yy);
        g.bezierCurveTo(s / 3, yy + 4, (2 * s) / 3, yy - 4, s, yy);
        g.stroke();
      }
    }
  });
}

/** Anyaman kain: garis halus silang. */
export function proceduralFabricTexture(): THREE.CanvasTexture {
  return paint(128, (g, s) => {
    g.fillStyle = "#d8d2c4";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 4) {
      g.fillStyle = "rgba(0,0,0,0.08)";
      g.fillRect(i, 0, 1, s);
      g.fillRect(0, i, s, 1);
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.fillRect(i + 2, 0, 1, s);
      g.fillRect(0, i + 2, s, 1);
    }
  });
}

/** Bercak acak gelap-terang di atas warna dasar. */
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

export function proceduralRockTexture(): THREE.CanvasTexture {
  return blotch("#8a8078", "#5a524a", "#a89e94");
}

function get(key: string, file: string, fallback: () => THREE.Texture): THREE.Texture {
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
  );
  cache.set(key, tex);
  return tex;
}

export function getWoodTexture(): THREE.Texture {
  return get("wood", "wood-planks.jpg", proceduralWoodTexture);
}

export function getDeckTexture(): THREE.Texture {
  // File sama dengan lambung, instance beda supaya repeat bisa diatur sendiri.
  return get("deck", "wood-planks.jpg", proceduralWoodTexture);
}

export function getFabricTexture(): THREE.Texture {
  return get("fabric", "fabric.jpg", proceduralFabricTexture);
}

export function getMetalTexture(): THREE.Texture {
  return get("metal", "metal.jpg", () => blotch("#3a4048", "#22262c", "#565e68"));
}

export function getRockTexture(): THREE.Texture {
  return get("rock", "rock.jpg", proceduralRockTexture);
}

export function getGrassTexture(): THREE.Texture {
  return get("grass", "grass.jpg", () => blotch("#5a7d3a", "#45632c", "#74995a"));
}

export function getSandTexture(): THREE.Texture {
  return get("sand", "sand.jpg", () => blotch("#c2a878", "#a68d5f", "#d6c193"));
}

export function preloadNavalTextures(): Promise<void> {
  getWoodTexture();
  getDeckTexture();
  getFabricTexture();
  getMetalTexture();
  getRockTexture();
  getGrassTexture();
  getSandTexture();
  return Promise.all(loads).then(() => undefined);
}
