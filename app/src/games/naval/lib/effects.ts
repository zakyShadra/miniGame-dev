// Efek visual combat: partikel (satu THREE.Points + shader, 1 draw call),
// cincin splash, dan kilat moncong meriam. Semua visual; suara menyusul N6.

import * as THREE from "three";

const MAX_PARTICLES = 600;

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  gravity: number;
  drag: number;
  grow: number;
}

const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = alpha;
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (280.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float mask = smoothstep(0.5, 0.1, d);
  gl_FragColor = vec4(vColor, vAlpha * mask);
}
`;

/** Tekstur kilat radial (buat sprite muzzle flash). */
function flashTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,240,180,1)");
  grad.addColorStop(0.35, "rgba(255,170,60,0.9)");
  grad.addColorStop(1, "rgba(255,100,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Effects {
  private points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private pool: Particle[] = [];
  private rings: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];
  private flashes: { sprite: THREE.Sprite; life: number }[] = [];
  private flashTex = flashTexture();

  constructor(private scene: THREE.Scene) {
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const col = new Float32Array(MAX_PARTICLES * 3);
    const size = new Float32Array(MAX_PARTICLES);
    const alpha = new Float32Array(MAX_PARTICLES);
    // Partikel mati disembunyikan jauh di bawah air.
    for (let i = 0; i < MAX_PARTICLES; i++) pos[i * 3 + 1] = -999;
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.colAttr = new THREE.BufferAttribute(col, 3);
    this.sizeAttr = new THREE.BufferAttribute(size, 1);
    this.alphaAttr = new THREE.BufferAttribute(alpha, 1);
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setAttribute("pcolor", this.colAttr);
    this.geo.setAttribute("size", this.sizeAttr);
    this.geo.setAttribute("alpha", this.alphaAttr);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        alive: false, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1,
        gravity: 0, drag: 0, grow: 0,
      });
    }
  }

  private spawn(p: Partial<Particle> & { x: number; y: number; z: number }): void {
    const slot = this.pool.find((q) => !q.alive);
    if (!slot) return;
    Object.assign(slot, {
      alive: true, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.8,
      size: 2, r: 1, g: 1, b: 1, gravity: 0, drag: 0, grow: 0,
    }, p);
  }

  /** Ledakan kena hit: api oranye + asap abu-abu. */
  explosion(x: number, y: number, z: number): void {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 10;
      this.spawn({
        x, y: y + 1, z,
        vx: Math.cos(a) * sp, vy: 3 + Math.random() * 9, vz: Math.sin(a) * sp,
        maxLife: 0.5 + Math.random() * 0.5, size: 2.5 + Math.random() * 2.5,
        r: 1, g: 0.45 + Math.random() * 0.35, b: 0.1,
        gravity: -6, drag: 2,
      });
    }
    for (let i = 0; i < 8; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 3, y: y + 2 + Math.random() * 2, z: z + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 2,
        maxLife: 1.2 + Math.random() * 0.8, size: 3.5 + Math.random() * 2,
        r: 0.35, g: 0.35, b: 0.35, drag: 0.5, grow: 2,
      });
    }
  }

  /** Cipratan air saat peluru jatuh ke laut + cincin. */
  splash(x: number, z: number): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 4;
      this.spawn({
        x, y: 0.5, z,
        vx: Math.cos(a) * sp, vy: 5 + Math.random() * 7, vz: Math.sin(a) * sp,
        maxLife: 0.5 + Math.random() * 0.4, size: 1.5 + Math.random() * 1.5,
        r: 0.85, g: 0.95, b: 1, gravity: -14, drag: 0.5,
      });
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.1, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.3, z);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, life: 0, maxLife: 0.9 });
  }

  /** Debu saat peluru menghantam pulau. */
  islandHit(x: number, y: number, z: number): void {
    for (let i = 0; i < 10; i++) {
      this.spawn({
        x, y, z,
        vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * 6,
        maxLife: 0.6 + Math.random() * 0.5, size: 2 + Math.random() * 2,
        r: 0.55, g: 0.5, b: 0.45, gravity: -8, drag: 1.5,
      });
    }
  }

  /** Kilat moncong + asap saat menembak. */
  muzzleFlash(x: number, y: number, z: number): void {
    const mat = new THREE.SpriteMaterial({
      map: this.flashTex, transparent: true, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(6);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0 });
    for (let i = 0; i < 5; i++) {
      this.spawn({
        x, y, z,
        vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3,
        maxLife: 0.7 + Math.random() * 0.5, size: 2 + Math.random() * 1.5,
        r: 0.6, g: 0.6, b: 0.6, drag: 1, grow: 1.5,
      });
    }
  }

  /** Buih jejak buritan kapal yang bergerak (putih, cepat hilang). */
  wake(x: number, z: number): void {
    for (let i = 0; i < 2; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 3,
        y: 0.3,
        z: z + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 1,
        vy: 0.2,
        vz: (Math.random() - 0.5) * 1,
        maxLife: 0.9 + Math.random() * 0.5,
        size: 2 + Math.random() * 2,
        r: 0.95,
        g: 0.98,
        b: 1,
        drag: 0.5,
        grow: 2.5,
      });
    }
  }

  /** Gelembung + asap kapal yang tenggelam. */
  sinkingSmoke(x: number, z: number): void {
    for (let i = 0; i < 3; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 8, y: 0.5, z: z + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5), vy: 1.5 + Math.random(), vz: (Math.random() - 0.5),
        maxLife: 1 + Math.random(), size: 2 + Math.random() * 2,
        r: 0.5, g: 0.55, b: 0.6, drag: 0.3, grow: 2,
      });
    }
  }

  update(dt: number): void {
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    const alpha = this.alphaAttr.array as Float32Array;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i]!;
      if (!p.alive) {
        alpha[i] = 0;
        continue;
      }
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        pos[i * 3 + 1] = -999;
        alpha[i] = 0;
        continue;
      }
      const dragF = Math.max(0, 1 - p.drag * dt);
      p.vx *= dragF;
      p.vz *= dragF;
      p.vy = p.vy * dragF + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const f = 1 - p.life / p.maxLife;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r;
      col[i * 3 + 1] = p.g;
      col[i * 3 + 2] = p.b;
      size[i] = p.size + p.grow * p.life;
      alpha[i] = Math.min(1, f * 2);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life += dt;
      const f = r.life / r.maxLife;
      if (f >= 1) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        r.mesh.geometry.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(1 + f * 9);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - f);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i]!;
      fl.life += dt;
      const f = fl.life / 0.12;
      if (f >= 1) {
        this.scene.remove(fl.sprite);
        (fl.sprite.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      (fl.sprite.material as THREE.SpriteMaterial).opacity = 1 - f;
      fl.sprite.scale.setScalar(6 + f * 4);
    }
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      (r.mesh.material as THREE.Material).dispose();
      r.mesh.geometry.dispose();
    }
    for (const fl of this.flashes) {
      this.scene.remove(fl.sprite);
      (fl.sprite.material as THREE.Material).dispose();
    }
  }
}
