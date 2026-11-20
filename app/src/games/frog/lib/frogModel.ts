// Model katak kartun dari primitif Three.js: badan gepeng, 2 mata besar,
// kaki, pipi merona, lidah pink yang bisa meregang. Katak menghadap +z,
// titik asal di kaki (y=0). Skala cocok dengan sim (lebar ~0.8 m).
// F4 HD: mata lebih besar + iris, jari kaki (1 draw call instanced),
// ujung lidah cangkir hisap, bump halus di kulit.

import * as THREE from "three";
import type { FrogColor } from "../../../../../shared/frog/types";
import { getLeatherNormalTexture, getSkinBumpTexture } from "./textures";

export interface FrogModel {
  group: THREE.Group;
  /** Badan (buat squash and stretch). */
  body: THREE.Group;
  /** Lidah: atur dengan setTongue, sembunyikan dengan hideTongue. */
  tongue: THREE.Group;
  setTongue: (from: THREE.Vector3, to: THREE.Vector3) => void;
  hideTongue: () => void;
}

const SKIN: Record<FrogColor, { main: string; belly: string; spot: string; iris: string }> = {
  orange: { main: "#ff8c42", belly: "#ffd9a0", spot: "#e56f24", iris: "#8a4a12" },
  purple: { main: "#8b5cf6", belly: "#d8c8ff", spot: "#6d3fd4", iris: "#3d2a7a" },
};

function std(color: string, roughness = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** Material kulit: bump halus + normal kulit samar (bukan flat). */
function skinMat(color: string, roughness = 0.55): THREE.MeshStandardMaterial {
  const bump = getSkinBumpTexture();
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    bumpMap: bump,
    bumpScale: 0.015,
    normalMap: getLeatherNormalTexture(),
    normalScale: new THREE.Vector2(0.12, 0.12),
  });
}

export function buildFrogModel(color: FrogColor): FrogModel {
  const skin = SKIN[color];
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Badan: bola gepeng + perut lebih terang di depan bawah.
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), skinMat(skin.main));
  torso.scale.set(1, 0.78, 1.05);
  torso.position.y = 0.42;
  body.add(torso);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), skinMat(skin.belly, 0.65));
  belly.scale.set(0.85, 0.62, 0.7);
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

  // Mata: tangkai + bola putih besar + iris + pupil + kilau.
  const white = std("#ffffff", 0.3);
  const irisMat = std(skin.iris, 0.3);
  const pupilMat = std("#1a1a1a", 0.25);
  const shineMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  for (const side of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.18, 8), skinMat(skin.main));
    stalk.position.set(side * 0.21, 0.72, 0.12);
    body.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), white);
    eye.position.set(side * 0.21, 0.86, 0.14);
    body.add(eye);
    // Iris + pupil di atas-tengah bola mata (bukan tengah depan):
    // kamera selalu melihat dari atas, iris di tengah depan terbaca
    // seperti mata melirik ke bawah.
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), irisMat);
    iris.scale.set(1, 1, 0.5);
    iris.position.set(side * 0.21, 0.93, 0.26);
    body.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), pupilMat);
    pupil.position.set(side * 0.21, 0.93, 0.3);
    body.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), shineMat);
    shine.position.set(side * 0.21 - 0.05, 0.97, 0.32);
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
  // Jari kaki: 3 per telapak, 1 draw call instanced.
  const legMat = skinMat(skin.main);
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), legMat);
    thigh.scale.set(0.6, 0.8, 1.1);
    thigh.position.set(side * 0.4, 0.22, -0.08);
    body.add(thigh);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), legMat);
    foot.scale.set(0.8, 0.35, 1.4);
    foot.position.set(side * 0.38, 0.05, 0.22);
    body.add(foot);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.28, 8), legMat);
    arm.position.set(side * 0.26, 0.16, 0.3);
    arm.rotation.x = 0.3;
    body.add(arm);
  }
  const toeSpots: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    for (const dx of [-0.06, 0, 0.06]) toeSpots.push([side * 0.26 + dx, 0.035, 0.4]);
    for (const dx of [-0.07, 0, 0.07]) toeSpots.push([side * 0.38 + dx, 0.035, 0.44]);
  }
  const toes = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.032, 6, 6),
    legMat,
    toeSpots.length,
  );
  const tm = new THREE.Matrix4();
  toeSpots.forEach((p, i) => {
    tm.makeScale(1, 0.7, 1.2);
    tm.setPosition(p[0], p[1], p[2]);
    toes.setMatrixAt(i, tm);
  });
  toes.instanceMatrix.needsUpdate = true;
  body.add(toes);

  // Lidah: silinder yang dipanjangkan di antara mulut dan target
  // (geometri digeser supaya pangkal di origin, ujung di +y).
  // Ujungnya cangkir hisap pipih yang mengkilap (F4).
  const tongue = new THREE.Group();
  const tongueGeo = new THREE.CylinderGeometry(0.045, 0.06, 1, 8);
  tongueGeo.translate(0, 0.5, 0);
  const tongueMesh = new THREE.Mesh(tongueGeo, std("#ff7d9c", 0.35));
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: "#ff5c85", roughness: 0.2 }),
  );
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
    // Ujung lidah tetap bulat pipih (kompensasi skala Y + pipih 0.45).
    tip.scale.set(1, 0.45 / length, 1);
  }
  function hideTongue(): void {
    tongue.visible = false;
  }

  return { group, body, tongue, setTongue, hideTongue };
}
