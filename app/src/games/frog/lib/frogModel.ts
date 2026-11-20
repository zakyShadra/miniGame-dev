// Model katak ala Froggin Around: badan chubby seperti buah pir,
// mata BESAR menonjol di atas kepala (tanpa tangkai), kulit oranye/
// ungu cerah dengan bintik biru, kaki pendek gemuk. Katak menghadap
// +z, titik asal di kaki (y=0). Skala cocok dengan sim (lebar ~0.8 m).
// F5: bentuk + texture + kaki/tangan/mata diekspos buat animasi
// (scene.ts: kaki bergantian, goyang, kedip).

import * as THREE from "three";
import type { FrogColor } from "../../../../../shared/frog/types";
import { getFrogSkinTexture, getSkinBumpTexture } from "./textures";

export interface FrogModel {
  group: THREE.Group;
  /** Badan (buat squash and stretch). */
  body: THREE.Group;
  /** Lidah: atur dengan setTongue, sembunyikan dengan hideTongue. */
  tongue: THREE.Group;
  setTongue: (from: THREE.Vector3, to: THREE.Vector3) => void;
  hideTongue: () => void;
  /** Kaki belakang (pivot di pinggul, putar sumbu X buat melangkah). */
  legL: THREE.Group;
  legR: THREE.Group;
  /** Tangan depan (pivot di bahu, ayun berlawanan dengan kaki). */
  armL: THREE.Group;
  armR: THREE.Group;
  /** Mata (skala Y buat kedip). */
  eyeL: THREE.Group;
  eyeR: THREE.Group;
}

const SKIN: Record<FrogColor, { belly: string; iris: string }> = {
  orange: { belly: "#ffe3b3", iris: "#7a3b12" },
  purple: { belly: "#e6dcff", iris: "#2e1a5e" },
};

function std(color: string, roughness = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** Kulit: texture bintik biru + bump halus, agak mengkilap. */
function skinMat(color: FrogColor): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: getFrogSkinTexture(color),
    roughness: 0.38,
    bumpMap: getSkinBumpTexture(),
    bumpScale: 0.012,
  });
}

export function buildFrogModel(color: FrogColor): FrogModel {
  const skin = SKIN[color];
  const mat = skinMat(color);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Badan: bola tegak seperti buah pir (chubby, bukan gepeng).
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 18), mat);
  torso.scale.set(1, 1.02, 0.95);
  torso.position.y = 0.46;
  body.add(torso);
  // Perut krem menonjol di depan bawah.
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 20, 14),
    std(skin.belly, 0.5),
  );
  belly.scale.set(0.92, 0.88, 0.72);
  belly.position.set(0, 0.38, 0.16);
  body.add(belly);

  // Mata BESAR menonjol di atas kepala (tanpa tangkai): bola putih +
  // iris besar + pupil + kilau. Tiap mata satu grup (buat kedip).
  const white = std("#ffffff", 0.25);
  const irisMat = std(skin.iris, 0.25);
  const pupilMat = std("#141414", 0.2);
  const shineMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const eyes: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.17, 0.79, 0.16);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.23, 20, 16), white);
    eye.add(ball);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), irisMat);
    iris.scale.set(1, 1, 0.5);
    iris.position.set(0, 0.06, 0.19);
    eye.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), pupilMat);
    pupil.position.set(0, 0.06, 0.23);
    eye.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), shineMat);
    shine.position.set(-0.06, 0.13, 0.2);
    eye.add(shine);
    body.add(eye);
    eyes.push(eye);
  }

  // Senyum lebar + pipi merona.
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.022, 6, 20, Math.PI),
    std("#7a3b12", 0.5),
  );
  smile.position.set(0, 0.54, 0.39);
  smile.rotation.set(0.25, 0, Math.PI);
  body.add(smile);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), std("#ff9d9d", 0.7));
    cheek.scale.set(1, 0.7, 0.4);
    cheek.position.set(side * 0.31, 0.5, 0.31);
    body.add(cheek);
  }

  // Kaki belakang: pivot di pinggul, paha gemuk + telapak lebar +
  // 3 jari. Tangan depan: pivot di bahu, lengan pendek + telapak.
  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.36, 0.3, -0.05);
    const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), mat);
    thigh.scale.set(0.62, 0.85, 1.15);
    thigh.position.set(0, -0.08, -0.02);
    leg.add(thigh);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mat);
    foot.scale.set(0.85, 0.35, 1.5);
    foot.position.set(0, -0.24, 0.22);
    leg.add(foot);
    for (const dx of [-0.07, 0, 0.07]) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), mat);
      toe.scale.set(1, 0.7, 1.2);
      toe.position.set(dx, -0.26, 0.42);
      leg.add(toe);
    }
    body.add(leg);
    legs.push(leg);

    const arm = new THREE.Group();
    arm.position.set(side * 0.28, 0.38, 0.28);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.3, 8), mat);
    upper.position.set(0, -0.12, 0.05);
    upper.rotation.x = 0.4;
    arm.add(upper);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mat);
    hand.scale.set(1, 0.7, 1.2);
    hand.position.set(0, -0.26, 0.12);
    arm.add(hand);
    body.add(arm);
    arms.push(arm);
  }

  // Lidah: silinder pink tebal (Froggin: lidah exaggerated) yang
  // dipanjangkan di antara mulut dan target (geometri digeser supaya
  // pangkal di origin, ujung di +y). Ujung cangkir hisap mengkilap.
  const tongue = new THREE.Group();
  const tongueGeo = new THREE.CylinderGeometry(0.055, 0.07, 1, 8);
  tongueGeo.translate(0, 0.5, 0);
  const tongueMesh = new THREE.Mesh(tongueGeo, std("#ff7d9c", 0.3));
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
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

  return {
    group,
    body,
    tongue,
    setTongue,
    hideTongue,
    legL: legs[0]!,
    legR: legs[1]!,
    armL: arms[0]!,
    armR: arms[1]!,
    eyeL: eyes[0]!,
    eyeR: eyes[1]!,
  };
}
