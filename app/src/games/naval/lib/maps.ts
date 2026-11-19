// Definisi map arena. N1/N2 hanya Teluk Terbuka; Kepulauan + Labirin Karang
// menyusul di N4 (progresi level bot). Spawn A di barat menghadap timur,
// spawn B di timur menghadap barat; area spawn dijaga kosong dari pulau.

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
};

export const MAPS: MapDef[] = [MAP_OPEN_BAY];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAP_OPEN_BAY;
}
