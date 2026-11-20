// Tipe bersama game katak (platformer 3D). Satuan: meter, detik, radian.
// Bidang lantai adalah (x, z); y = tinggi (0 = lantai awal). Posisi katak
// adalah titik kakinya (bawah badan); badan setinggi 0.7 m di atasnya.
// Model katak Three.js dibangun menghadap +z, jadi rotation.y = facing.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type FrogColor = "orange" | "green";

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
  /** Jilat saja (F6.15): lidah ke pasangan tanpa menarik (lepas
   * sendiri setelah 0.6 detik, hanya efek + bunyi). */
  lick: boolean;
  /** Jarak katak ke anchor saat ini (m). */
  length: number;
  /** Panjang tali istirahat pegas (m), 75% jarak saat attach. */
  restLength: number;
  /** Sisa waktu sebelum lidah lepas sendiri (detik). */
  timeLeft: number;
  /** Sisa waktu animasi terbang sebelum attach (detik). */
  flyTime: number;
}

/** Platform padat (AABB). Katak berdiri di atas max.y.
 * hiddenUntil: platform tersembunyi (tidak ada di tabrakan + tidak
 * dirender) sampai cincin emas itu kena lidah (F6.2). */
export interface PlatformDef {
  id: string;
  min: Vec3;
  max: Vec3;
  /** Id cincin yang memunculkan platform ini (F6.2). */
  hiddenUntil?: string;
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

/** Target cincin emas (F6.2): tembak lidah ke cincin = aktivasi
 * (platform tersembunyi yang terikat ke cincin ini muncul) + efek
 * sparkle biru. Satu kali pakai per match. */
export interface RingDef {
  id: string;
  pos: Vec3;
}

/** Orb hijau bercahaya (F6.11): kolektibel tersembunyi, diambil
 * dengan lidah (pola sama seperti lalat F6.4). */
export interface OrbDef {
  id: string;
  pos: Vec3;
}

/** Koin emas (F6.11): kolektibel di atas meja / dekat puzzle,
 * diambil dengan lidah (pola sama seperti lalat F6.4). */
export interface CoinDef {
  id: string;
  pos: Vec3;
}

/** Pintu tarik (F6.3): platform vertikal yang bergeser di rel saat
 * DUA lidah menempel ke gagangnya sekaligus (1 lidah tidak cukup:
 * pintu hanya bergerak bila >= 2 lidah menempel, dan kembali
 * menggeser saat dilepas). target = titik tempel lidah (gagang di
 * muka pintu), ikut bergeser dengan pintu. slide = jarak geser saat
 * terbuka penuh (m, searah sumbu). Terbuka penuh = latch permanen. */
export interface PullDoorDef {
  id: string;
  platformId: string;
  axis: "x" | "z";
  slide: number;
  target: Vec3;
}
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

/** Jamur lompat (F3): katak yang berpijak di atasnya dilontarkan ke
 * atas. pos.y = permukaan tempat katak berdiri (atas platform). */
export interface MushroomDef {
  id: string;
  pos: Vec3;
  radius: number;
  /** Kecepatan vertikal lontaran (m/s, default MUSHROOM_BOUNCE). */
  bounce?: number;
}

/** Platform bergerak (F3): bolak-balik sinus di satu sumbu.
 * offset(t) = amplitude * sin(2*pi*t/period + phase), deterministik
 * dari jam sim (server + client + autopilot menghitung posisi sama). */
export interface MoverDef {
  platformId: string;
  axis: "x" | "z";
  amplitude: number;
  /** Detik per siklus penuh (bolak-balik). */
  period: number;
  phase?: number;
}

/** Tema visual level (F3): palet + dekor scene. Default workshop. */
export type FrogTheme = "workshop" | "sewer" | "library" | "garden";

export interface LevelDef {
  id: string;
  name: string;
  platforms: PlatformDef[];
  anchors: AnchorDef[];
  flies: FlyDef[];
  /** Target cincin emas (F6.2). */
  rings?: RingDef[];
  /** Orb hijau bercahaya (F6.11). */
  orbs?: OrbDef[];
  /** Koin emas (F6.11). */
  coins?: CoinDef[];
  spawn: Vec3;
  /** Spawn katak ke-2 (co-op, hijau). Kosong = level solo. */
  spawn2?: Vec3;
  /** Pintu tarik (F6.3): digeser lidah, bukan tombol. */
  pullDoors?: PullDoorDef[];
  /** Tombol lantai (co-op). */
  buttons?: ButtonDef[];
  /** Pintu (co-op). */
  door?: DoorDef;
  /** Jamur lompat (F3). */
  mushrooms?: MushroomDef[];
  /** Platform bergerak (F3). */
  movers?: MoverDef[];
  /** Tema visual (default workshop). */
  theme?: FrogTheme;
  goal: { pos: Vec3; radius: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; killY: number };
}

export interface FrogGameState {
  level: LevelDef;
  frog: FrogState;
  tongue: TongueState;
  /** Id lalat yang sudah dimakan. */
  fliesGot: string[];
  /** Id cincin emas yang sudah diaktifkan (F6.2). */
  ringsHit: string[];
  /** Id orb hijau yang sudah diambil (F6.11). */
  orbsGot: string[];
  /** Id koin emas yang sudah diambil (F6.11). */
  coinsGot: string[];
  /** Progres pintu tarik 0..1 per id (F6.3, latch di 1). */
  pullProgress: Record<string, number>;
  /** Pintu sedang terbuka. Solo (F3): sekali ditekan tombolnya,
   * pintu terbuka permanen (latch) supaya 1 katak bisa lewat. */
  doorOpen: boolean;
  /** Ada tombol yang sedang tertekan saat ini. */
  buttonDown: boolean;
  /** Id tombol yang sedang tertekan (buat render kubah tombol). */
  pressedButtons: string[];
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
  | { type: "ring"; ringId: string }
  /** Orb hijau diambil lidah (F6.11). */
  | { type: "orb"; orbId: string }
  /** Koin emas diambil lidah (F6.11). */
  | { type: "coin"; coinId: string }
  /** Ciuman lidah (F6.8, co-op): dua ujung lidah bertemu. pos =
   * titik tengah kedua ujung lidah (tempat hati melayang). */
  | { type: "kiss"; pos: Vec3 }
  /** Pintu tarik terbuka penuh (F6.3): bunyi + sparkle di scene. */
  | { type: "pulldoor"; doorId: string }
  /** Jilat iseng (F6.15, co-op): lidah mengenai pasangan tanpa
   * menarik. pos = titik jilatan (pusat badan pasangan). */
  | { type: "lick"; pos: Vec3 }
  | { type: "respawn" }
  | { type: "bounce"; mushroomId: string }
  | { type: "win" };

/** State match co-op 2 katak (server-authoritative di F2). */
export interface FrogCoopState {
  level: LevelDef;
  frogs: [FrogState, FrogState];
  tongues: [TongueState, TongueState];
  /** Id lalat yang sudah dimakan (bersama). */
  fliesGot: string[];
  /** Id cincin emas yang sudah diaktifkan (bersama, F6.2). */
  ringsHit: string[];
  /** Id orb hijau yang sudah diambil (bersama, F6.11). */
  orbsGot: string[];
  /** Id koin emas yang sudah diambil (bersama, F6.11). */
  coinsGot: string[];
  /** Progres pintu tarik 0..1 per id (F6.3, latch di 1). */
  pullProgress: Record<string, number>;
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
  /** Jam game saat ciuman lidah terakhir (F6.8, -99 = belum pernah).
   * Ciuman punya cooldown supaya tidak berulang tiap tick. */
  lastKissAt: number;
}

/** Event sim co-op: event solo + indeks katak penyebabnya. */
export type CoopSimEvent = FrogSimEvent & { frog: 0 | 1 };
