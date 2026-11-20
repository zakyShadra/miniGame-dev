// Model katak kartun dari primitif Three.js: badan gepeng, 2 mata besar,
// kaki, pipi merona, lidah pink yang bisa meregang. Katak menghadap +z,
// titik asal di kaki (y=0). Skala cocok dengan sim (lebar ~0.8 m).

import * as THREE from "three";
import type { FrogColor } from "../../../../../shared/frog/types";

export interface FrogModel {
  group: THREE.Group;
  /** Badan (buat squash and stretch). */
  body: THREE.Group;
  /** Lidah: atur dengan setTongue, sembunyikan dengan hideTongue. */
  tongue: THREE.Group;
  setTongue: (from: THREE.Vector3, to: THREE.Vector3) => void;
  hideTongue: () => void;
}

const SKIN: Record<FrogColor, { main: string; belly: string; spot: string }> = {
  orange: { main: "#ff8c42", belly: "#ffd9a0", spot: "#e56f24" },
  purple: { main: "#8b5cf6", belly: "#d8c8ff", spot: "#6d3fd4" },
};

function std(color: string, roughness = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

export function buildFrogModel(color: FrogColor): FrogModel {
  const skin = SKIN[color];
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Badan: bola gepeng + perut lebih terang di depan bawah.
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), std(skin.main));
  torso.scale.set(1, 0.78, 1.05);
  torso.position.y = 0.42;
  body.add(torso);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), std(skin.belly));
  belly.scale.set(0.85, 0.6, 0.7);
  belly.position.set(0, 0.34, 0.2);
  body.add(belly);
  // Bintik punggung (3 titik gelap, ciri katak).
  for (const [sx, sz, r] of [
    [-0.16, -0.1, 0.07],
    [0.18, -0.05, 0.06],
    [0.02, -0.28, 0.05],
  ] as const) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), std(skin.spot));
    spot.scale.set(1, 0.4, 1);
    spot.position.set(sx, 0.72, sz);
    body.add(spot);
  }

  // Mata: tangkai + bola putih + pupil + kilau.
  const white = std("#ffffff", 0.35);
  const pupilMat = std("#1a1a1a", 0.3);
  const shineMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  for (const side of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.16, 8), std(skin.main));
    stalk.position.set(side * 0.2, 0.72, 0.12);
    body.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), white);
    eye.position.set(side * 0.2, 0.84, 0.14);
    body.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), pupilMat);
    pupil.position.set(side * 0.2, 0.86, 0.27);
    body.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), shineMat);
    shine.position.set(side * 0.2 - 0.04, 0.9, 0.32);
    body.add(shine);
  }

  // Senyum: busur torus tipis. Pipi merona: 2 cakram pink.
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.018, 6, 16, Math.PI),
    std("#7a3b12", 0.5),
  );
  smile.position.set(0, 0.52, 0.4);
  smile.rotation.set(0.25, 0, Math.PI);
  body.add(smile);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), std("#ff9d9d", 0.7));
    cheek.scale.set(1, 0.7, 0.4);
    cheek.position.set(side * 0.3, 0.5, 0.32);
    body.add(cheek);
  }

  // Kaki belakang: paha gepeng + telapak. Kaki depan: silinder kecil.
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), std(skin.main));
    thigh.scale.set(0.6, 0.8, 1.1);
    thigh.position.set(side * 0.4, 0.22, -0.08);
    body.add(thigh);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), std(skin.main));
    foot.scale.set(0.8, 0.35, 1.4);
    foot.position.set(side * 0.38, 0.05, 0.22);
    body.add(foot);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.28, 8), std(skin.main));
    arm.position.set(side * 0.26, 0.16, 0.3);
    arm.rotation.x = 0.3;
    body.add(arm);
  }

  // Lidah: silinder yang dipanjangkan di antara mulut dan target
  // (geometri digeser supaya pangkal di origin, ujung di +y).
  const tongue = new THREE.Group();
  const tongueGeo = new THREE.CylinderGeometry(0.045, 0.06, 1, 8);
  tongueGeo.translate(0, 0.5, 0);
  const tongueMesh = new THREE.Mesh(tongueGeo, std("#ff7d9c", 0.4));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), std("#ff5c85", 0.4));
  tip.position.y = 1;
  tongue.add(tongueMesh);
  tongue.add(tip);
  tongue.visible = false;
  // Lidah hidup di ruang dunia (bukan anak body, supaya tidak ikut squash).
  group.add(tongue);

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  function setTongue(from: THREE.Vector3, to: THREE.Vector3): void {
    dir.subVectors(to, from);
    const length = Math.max(0.05, dir.length());
    tongue.visible = true;
    tongue.position.copy(from);
    tongue.quaternion.setFromUnitVectors(up, dir.normalize());
    tongue.scale.set(1, length, 1);
    // Ujung lidah tetap bulat (kompensasi skala Y).
    tip.scale.set(1, 1 / length, 1);
  }
  function hideTongue(): void {
    tongue.visible = false;
  }

  return { group, body, tongue, setTongue, hideTongue };
}
