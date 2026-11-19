// Tipe bersama game naval (kapal perang 3D). Satuan: meter, detik, radian.
// Bidang laut adalah (x, z); y = tinggi (0 = permukaan air). Arah haluan
// (heading) 0 = +z; vektor maju = (sin(heading), cos(heading)) di (x, z).
// Model kapal Three.js dibangun menghadap +z, jadi rotation.y = heading.

export interface Vec2 {
  x: number;
  z: number;
}

export type ShipId = "galleon" | "battleship" | "frigate" | "submarine" | "sloop";
export type AbilityId = "double-shot" | "armor" | "splash" | "dive" | "radar";

// Definisi statis satu jenis kapal (roster). Angka placeholder yang masuk
// akal; di-tuning di N3/N6.
export interface ShipDef {
  id: ShipId;
  name: string;
  hp: number;
  /** Kecepatan maju maksimum (m/s). */
  maxSpeed: number;
  /** Kecepatan mundur maksimum (m/s). */
  reverseSpeed: number;
  /** Percepatan (m/s^2). */
  accel: number;
  /** Perlambatan saat throttle dilepas (m/s^2). */
  decel: number;
  /** Laju belok maksimum (rad/s) pada kecepatan penuh. */
  turnRate: number;
  /** Panjang lambung (m), dipakai hitbox + model. */
  length: number;
  /** Lebar lambung (m). */
  beam: number;
  /** Jari-jari tabrakan dengan pulau/kapal lain (m). */
  radius: number;
  /** Damage per peluru. */
  damage: number;
  /** Peluru per volley (tembakan). */
  volleyCount: number;
  /** Sebaran sudut antar peluru satu volley (radian). */
  volleySpread: number;
  /** Jeda antar volley (detik). */
  reloadSeconds: number;
  /** Kecepatan awal peluru (m/s). */
  shellSpeed: number;
  ability: AbilityId;
  abilityName: string;
  abilityDesc: string;
  /** Cooldown kemampuan (detik). */
  abilityCooldown: number;
  /** Warna layar + aksen model kapal. */
  sailColor: string;
  hullColor: string;
  trimColor: string;
  /** Jumlah tiang layar (0 = kapal selam, tanpa layar). */
  masts: number;
  /** Meriam broadside dekoratif per sisi. */
  cannonsPerSide: number;
}

export interface IslandDef {
  x: number;
  z: number;
  /** Jari-jari pulau di permukaan air (m). */
  radius: number;
  /** Tinggi puncak pulau (m), dipakai blokir peluru. */
  height: number;
  /** Seed bentuk acak (batu, pohon). */
  seed: number;
}

export interface MapDef {
  id: string;
  name: string;
  /** Jari-jari arena (m). */
  arenaRadius: number;
  islands: IslandDef[];
  /** Titik spawn pemain (x, z, heading). */
  spawnA: { x: number; z: number; heading: number };
  spawnB: { x: number; z: number; heading: number };
  /** Spawn pemain ke-2 mode co-op (dekat spawnA). Opsional. */
  spawnC?: { x: number; z: number; heading: number };
}

export interface ShipState {
  id: string;
  defId: ShipId;
  /** Posisi saat ini. */
  x: number;
  z: number;
  /** Posisi sebelum step terakhir (buat interpolasi render). */
  prevX: number;
  prevZ: number;
  heading: number;
  prevHeading: number;
  /** Kecepatan maju (m/s), bisa negatif (mundur). */
  speed: number;
  /** Laju belok saat ini (rad/s), dipakai animasi miring. */
  turn: number;
  /** Kemiringan lambung (radian), positif = miring kanan. */
  heel: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Kapal sedang tenggelam (hp 0, animasi jalan). */
  sinking: boolean;
  /** Waktu sejak mulai tenggelam (detik). */
  sinkTime: number;
  /** Waktu game saat volley terakhir ditembakkan. */
  lastFireAt: number;
  /** Waktu game saat kemampuan bisa dipakai lagi. */
  abilityReadyAt: number;
  /** Kemampuan sedang aktif (menyelam / radar). */
  abilityUntil: number;
  /** Input terakhir (buat prediksi client di N5). */
  throttle: number;
  rudder: number;
}

export interface ShellState {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fromShipId: string;
  damage: number;
  /** Jari-jari ledakan area (0 = tanpa splash). */
  splashRadius: number;
  alive: boolean;
}

export interface GameState {
  map: MapDef;
  ships: ShipState[];
  shells: ShellState[];
  /** Waktu game (detik) sejak match mulai. */
  time: number;
  nextShellId: number;
  /** Id kapal pemenang, null bila match masih jalan. */
  winnerId: string | null;
  /** Id kapal yang menembak terakhir (buat kill feed nanti). */
  lastHitterId: string | null;
}

/** Input kendali satu kapal per tick. */
export interface ShipInput {
  /** -1 (mundur penuh) .. 1 (maju penuh). */
  throttle: number;
  /** -1 (kiri) .. 1 (kanan). */
  rudder: number;
}

/** Event yang dihasilkan satu step simulasi (buat efek + HUD). */
export type SimEvent =
  | { type: "fire"; shipId: string; x: number; y: number; z: number }
  | { type: "hit"; shipId: string; byShipId: string; damage: number; x: number; y: number; z: number }
  | { type: "splash"; x: number; z: number }
  | { type: "island-hit"; x: number; y: number; z: number }
  | { type: "sink-start"; shipId: string }
  | { type: "sunk"; shipId: string }
  | { type: "bump"; shipId: string };
