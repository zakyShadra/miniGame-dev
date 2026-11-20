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
  /** Indeks katak yang ditempeli lidah (co-op): null = anchor statis,
   * 0/1 = lidah nempel ke katak lain, posisi anchor ikut katak itu. */
  anchorFrog: 0 | 1 | null;
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
  /** Sekali pakai (co-op): habis dipakai satu katak, lentera rapuh ini
   * padam sampai semua katak kembali ke sisi spawn (anti deadlock). */
  oneUse?: boolean;
}

export interface FlyDef {
  id: string;
  pos: Vec3;
}

/** Tombol lantai co-op: tertekan bila ada katak berdiri di atasnya. */
export interface ButtonDef {
  id: string;
  pos: Vec3;
  radius: number;
}

/** Pintu co-op: platform yang hilang dari tabrakan selama ada tombol
 * yang tertekan (tombol di salah satu sisi menahan pintu terbuka). */
export interface DoorDef {
  platformId: string;
  buttonIds: string[];
}

export interface LevelDef {
  id: string;
  name: string;
  platforms: PlatformDef[];
  anchors: AnchorDef[];
  flies: FlyDef[];
  spawn: Vec3;
  /** Spawn katak ke-2 (co-op, ungu). Kosong = level solo. */
  spawn2?: Vec3;
  /** Tombol lantai (co-op). */
  buttons?: ButtonDef[];
  /** Pintu (co-op). */
  door?: DoorDef;
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

/** State match co-op 2 katak (server-authoritative di F2). */
export interface FrogCoopState {
  level: LevelDef;
  frogs: [FrogState, FrogState];
  tongues: [TongueState, TongueState];
  /** Id lalat yang sudah dimakan (bersama). */
  fliesGot: string[];
  /** Id anchor sekali pakai yang sedang habis. */
  usedAnchors: string[];
  /** Ada katak berdiri di salah satu tombol. */
  buttonDown: boolean;
  /** Pintu sedang terbuka (ada tombol tertekan). */
  doorOpen: boolean;
  /** Per katak: sudah sampai portal (menempel, tidak hilang). */
  atGoal: [boolean, boolean];
  /** Menang = kedua katak sudah sampai portal. */
  won: boolean;
  /** Waktu game (detik) sejak match mulai. */
  time: number;
}

/** Event sim co-op: event solo + indeks katak penyebabnya. */
export type CoopSimEvent = FrogSimEvent & { frog: 0 | 1 };
