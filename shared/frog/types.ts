// Tipe bersama game katak (platformer 3D). Satuan: meter, detik, radian.
// Bidang lantai adalah (x, z); y = tinggi (0 = lantai awal). Posisi katak
// adalah titik kakinya (bawah badan); badan setinggi 0.7 m di atasnya.
// Model katak Three.js dibangun menghadap +z, jadi rotation.y = facing.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type FrogColor = "orange" | "purple";

export interface FrogState {
  /** Posisi kaki katak. */
  pos: Vec3;
  vel: Vec3;
  /** Posisi sebelum step terakhir (buat interpolasi render). */
  prevPos: Vec3;
  onGround: boolean;
  /** Arah hadap (radian, 0 = +z). */
  facing: number;
  /** Posisi aman terakhir (di tanah), dipakai respawn saat jatuh. */
  checkpoint: Vec3;
}

export type TongueMode = "idle" | "flying" | "attached";

export interface TongueState {
  mode: TongueMode;
  /** Anchor yang dituju (flying) atau ditempel (attached). */
  anchorId: string | null;
  anchor: Vec3 | null;
  /** Jarak katak ke anchor saat ini (m). */
  length: number;
  /** Panjang tali istirahat pegas (m), 75% jarak saat attach. */
  restLength: number;
  /** Sisa waktu sebelum lidah lepas sendiri (detik). */
  timeLeft: number;
  /** Sisa waktu animasi terbang sebelum attach (detik). */
  flyTime: number;
}

/** Platform padat (AABB). Katak berdiri di atas max.y. */
export interface PlatformDef {
  id: string;
  min: Vec3;
  max: Vec3;
}

/** Titik tempel lidah (lentera gantung / kait balok). */
export interface AnchorDef {
  id: string;
  pos: Vec3;
}

export interface FlyDef {
  id: string;
  pos: Vec3;
}

export interface LevelDef {
  id: string;
  name: string;
  platforms: PlatformDef[];
  anchors: AnchorDef[];
  flies: FlyDef[];
  spawn: Vec3;
  goal: { pos: Vec3; radius: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; killY: number };
}

export interface FrogGameState {
  level: LevelDef;
  frog: FrogState;
  tongue: TongueState;
  /** Id lalat yang sudah dimakan. */
  fliesGot: string[];
  won: boolean;
  /** Waktu game (detik) sejak level mulai. */
  time: number;
}

/** Input kendali satu katak per tick. moveX/moveZ adalah arah gerak
 * di ruang dunia (sudah relatif kamera, dihitung game.ts). */
export interface FrogInput {
  moveX: number;
  moveZ: number;
  jump: boolean;
}

/** Event yang dihasilkan satu step simulasi (buat efek + HUD). */
export type FrogSimEvent =
  | { type: "land" }
  | { type: "jump" }
  | { type: "tongue-fire"; anchorId: string }
  | { type: "tongue-attach"; anchorId: string }
  | { type: "tongue-release" }
  | { type: "fly"; flyId: string }
  | { type: "respawn" }
  | { type: "win" };
