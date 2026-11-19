// Definisi map arena. Teluk Terbuka (N1/N2), Kepulauan + Labirin Karang
// (N3, progresi level bot). Spawn A di barat menghadap timur, spawn B di
// timur menghadap barat, spawn C di dekat A (co-op pemain ke-2); area spawn
// dijaga kosong dari pulau. Labirin padat tapi menyisakan lorong layar di
// z = -160/0/160 dan x = -180/0/180.

import type { MapDef } from "./types";

export const MAP_OPEN_BAY: MapDef = {
  id: "teluk",
  name: "Teluk Terbuka",
  arenaRadius: 400,
  islands: [
    { x: 0, z: -120, radius: 42, height: 26, seed: 11 },
    { x: -90, z: 140, radius: 36, height: 22, seed: 23 },
    { x: 110, z: 170, radius: 48, height: 30, seed: 37 },
    { x: -40, z: -210, radius: 30, height: 18, seed: 41 },
    { x: 190, z: -60, radius: 34, height: 20, seed: 53 },
    { x: -190, z: 40, radius: 30, height: 18, seed: 67 },
    { x: 40, z: 40, radius: 26, height: 16, seed: 71 },
  ],
  spawnA: { x: -270, z: 0, heading: Math.PI / 2 },
  spawnB: { x: 270, z: 0, heading: -Math.PI / 2 },
  spawnC: { x: -270, z: 60, heading: Math.PI / 2 },
};

export const MAP_ISLANDS: MapDef = {
  id: "kepulauan",
  name: "Kepulauan",
  arenaRadius: 400,
  islands: [
    { x: -120, z: -160, radius: 38, height: 24, seed: 101 },
    { x: 60, z: -200, radius: 34, height: 20, seed: 103 },
    { x: 180, z: -140, radius: 40, height: 26, seed: 107 },
    { x: -200, z: -60, radius: 30, height: 18, seed: 109 },
    { x: -60, z: -40, radius: 26, height: 16, seed: 113 },
    { x: 120, z: -20, radius: 30, height: 18, seed: 127 },
    { x: 220, z: 60, radius: 36, height: 22, seed: 131 },
    { x: 40, z: 90, radius: 28, height: 18, seed: 137 },
    { x: -140, z: 120, radius: 40, height: 26, seed: 139 },
    { x: -40, z: 200, radius: 34, height: 20, seed: 149 },
    { x: 140, z: 190, radius: 30, height: 18, seed: 151 },
    { x: 200, z: -220, radius: 28, height: 18, seed: 157 },
  ],
  spawnA: { x: -270, z: 0, heading: Math.PI / 2 },
  spawnB: { x: 270, z: 0, heading: -Math.PI / 2 },
  spawnC: { x: -270, z: 60, heading: Math.PI / 2 },
};

export const MAP_LABYRINTH: MapDef = {
  id: "labirin",
  name: "Labirin Karang",
  arenaRadius: 400,
  islands: [
    { x: -270, z: -240, radius: 30, height: 20, seed: 201 },
    { x: -90, z: -260, radius: 34, height: 22, seed: 203 },
    { x: 90, z: -250, radius: 30, height: 20, seed: 207 },
    { x: 270, z: -250, radius: 32, height: 20, seed: 209 },
    { x: -260, z: -80, radius: 28, height: 18, seed: 211 },
    { x: -90, z: -90, radius: 30, height: 20, seed: 213 },
    { x: 90, z: -70, radius: 28, height: 18, seed: 217 },
    { x: 260, z: -90, radius: 30, height: 20, seed: 219 },
    { x: -230, z: 110, radius: 30, height: 20, seed: 221 },
    { x: -90, z: 70, radius: 28, height: 18, seed: 223 },
    { x: 90, z: 90, radius: 32, height: 20, seed: 227 },
    { x: 260, z: 70, radius: 28, height: 18, seed: 229 },
    { x: -270, z: 240, radius: 32, height: 20, seed: 231 },
    { x: -90, z: 240, radius: 30, height: 20, seed: 233 },
    { x: 90, z: 260, radius: 34, height: 22, seed: 237 },
    { x: 270, z: 250, radius: 30, height: 20, seed: 239 },
    { x: -330, z: 170, radius: 26, height: 16, seed: 241 },
    { x: 330, z: -170, radius: 26, height: 16, seed: 251 },
  ],
  spawnA: { x: -270, z: 0, heading: Math.PI / 2 },
  spawnB: { x: 270, z: 0, heading: -Math.PI / 2 },
  spawnC: { x: -270, z: 60, heading: Math.PI / 2 },
};

export const MAPS: MapDef[] = [MAP_OPEN_BAY, MAP_ISLANDS, MAP_LABYRINTH];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAP_OPEN_BAY;
}
