// Model katak ala Froggin Around (key art 2026-11-20): badan RENDAH
// dan LEBAR (duduk pipih seperti katak asli), kepala lebar, mata
// besar menonjol di atas kepala, kaki melebar ke samping.
// Katak hijau (bintik kuning, mata merah) + katak oranye-merah
// (bercak biru-ungu, mata kuning, kaki biru). Katak menghadap +z,
// origin di kaki (y=0), lebar ~0.9m. buildFrogModel(color) dipakai
// scene (slot0/slot1). Lidah pink panjang (Froggin).
import * as THREE from "three";
import type { FrogColor } from "../../../../../shared/frog/types";
import { getFrogSkinTexture } from "./textures";

export interface FrogModel {
  group: THREE.Group;
  body: THREE.Group;
  tongue: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  setTongue(from: THREE.Vector3, to: THREE.Vector3): void;
  hideTongue(): void;
}

const SKIN: Record<FrogColor, { belly: string; iris: string; legs: string }> = {
  orange: { belly: "#ffd9a8", iris: "#ffc300", legs: "#4a6fd4" },
  green: { belly: "#eaf7c8", iris: "#e63946", legs: "#5da336" },
};

function std(color: string, roughness = 0.4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** Kaki belakang: paha gemuk + telapak lebar pipih + 3 jari melebar. */
function buildHindLeg(side: 1 | -1, mat: THREE.Material): THREE.Group {
  const leg = new THREE.Group();
  leg.position.set(side * 0.38, 0.18, -0.08);
  // Paha: menonjol ke samping (katak duduk, kaki menekuk).
  const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), mat);
  thigh.scale.set(0.9, 0.7, 1.3);
  thigh.position.set(side * 0.06, 0.02, -0.02);
  thigh.rotation.z = side * -0.4;
  leg.add(thigh);
  // Telapak: lebar, pipih, menjulur ke depan-samping.
  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), mat);
  foot.scale.set(1.25, 0.32, 1.7);
  foot.position.set(side * 0.1, -0.12, 0.14);
  foot.rotation.y = side * 0.35;
  leg.add(foot);
  // 3 jari di ujung telapak.
  for (let i = -1; i <= 1; i++) {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat);
    toe.scale.set(1, 0.5, 1.4);
    toe.position.set(side * 0.1 + i * 0.07, -0.13, 0.34);
    toe.rotation.y = side * 0.35 + i * 0.25;
    leg.add(toe);
  }
  return leg;
}

/** Kaki depan: pendek, tegak, tangan kecil + 3 jari. */
function buildFrontLeg(side: 1 | -1, mat: THREE.Material): THREE.Group {
  const arm = new THREE.Group();
  arm.position.set(side * 0.3, 0.24, 0.26);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.24, 10), mat);
  upper.position.set(side * 0.04, -0.1, 0);
  upper.rotation.z = side * -0.35;
  arm.add(upper);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), mat);
  hand.scale.set(1.2, 0.5, 1.3);
  hand.position.set(side * 0.08, -0.21, 0.02);
  arm.add(hand);
  for (let i = -1; i <= 1; i++) {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), mat);
    toe.scale.set(1, 0.5, 1.3);
    toe.position.set(side * 0.08 + i * 0.045, -0.22, 0.09);
    arm.add(toe);
  }
  return arm;
}

/** Mata besar menonjol: bola putih + iris berwarna + pupil + highlight. */
function buildEye(side: 1 | -1, irisColor: string): THREE.Group {
  const eye = new THREE.Group();
  eye.position.set(side * 0.18, 0.52, 0.2);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), std("#ffffff", 0.25));
  eye.add(ball);
  const iris = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 20, 14),
    new THREE.MeshStandardMaterial({ color: irisColor, roughness: 0.2 }),
  );
  iris.position.set(0, 0.02, 0.15);
  iris.scale.z = 0.5;
  eye.add(iris);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), std("#111111", 0.15));
  pupil.position.set(0, 0.02, 0.2);
  pupil.scale.z = 0.5;
  eye.add(pupil);
  const hi = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 8, 6),
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
  );
  hi.position.set(-0.045, 0.08, 0.2);
  eye.add(hi);
  return eye;
}

export function buildFrogModel(color: FrogColor): FrogModel {
  const s = SKIN[color] ?? SKIN.orange;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Kulit: texture prosedural (bintik/bercak) + kilau halus.
  const skin = new THREE.MeshStandardMaterial({
    map: getFrogSkinTexture(color),
    roughness: 0.38,
    bumpMap: getFrogSkinTexture(color),
    bumpScale: 0.6,
  });
  const legMat = std(s.legs, 0.42);

  // Badan RENDAH + LEBAR (duduk pipih, bukan tegak): r 0.38,
  // scale (1.2, 0.72, 1.05) = lebar 0.91m, tinggi 0.55m.
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.38, 32, 24), skin);
  torso.scale.set(1.2, 0.72, 1.05);
  torso.position.set(0, 0.28, 0);
  body.add(torso);

  // Perut krem (depan-bawah).
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), std(s.belly, 0.5));
  belly.scale.set(1.1, 0.55, 0.45);
  belly.position.set(0, 0.2, 0.27);
  body.add(belly);

  const eyeL = buildEye(-1, s.iris);
  const eyeR = buildEye(1, s.iris);
  body.add(eyeL, eyeR);

  // Mulut: garis tipis melengkung halus (katak 3D Froggin hampir lurus).
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.012, 6, 20, Math.PI * 0.7),
    std("#5a2d10", 0.5),
  );
  mouth.position.set(0, 0.34, 0.42);
  mouth.rotation.z = Math.PI + (Math.PI - Math.PI * 0.7) / 2;
  body.add(mouth);

  // Pipi merona (tipis, di samping mulut).
  for (const side of [-1, 1] as const) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), std("#ff9e9e", 0.5));
    cheek.scale.set(1, 0.7, 0.4);
    cheek.position.set(side * 0.26, 0.28, 0.3);
    body.add(cheek);
  }

  const legL = buildHindLeg(-1, legMat);
  const legR = buildHindLeg(1, legMat);
  const armL = buildFrontLeg(-1, legMat);
  const armR = buildFrontLeg(1, legMat);
  body.add(legL, legR, armL, armR);

  // Lidah pink panjang (Froggin): silinder + ujung cangkir hisap.
  const tongue = new THREE.Group();
  const tongueMat = std("#ff7d9c", 0.35);
  const tongueMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 1, 12), tongueMat);
  const tongueTip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), tongueMat);
  tongueTip.scale.set(1, 0.6, 1);
  tongue.add(tongueMesh, tongueTip);
  tongue.visible = false;

  function setTongue(from: THREE.Vector3, to: THREE.Vector3): void {
    tongue.visible = true;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    tongue.position.copy(from).addScaledVector(dir, 0.5);
    tongue.scale.set(1, len, 1);
    tongue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    tongueTip.position.y = 0.5;
    tongueTip.scale.set(1 / 1, 0.6 / len, 1);
  }
  function hideTongue(): void {
    tongue.visible = false;
  }

  return { group, body, tongue, legL, legR, armL, armR, eyeL, eyeR, setTongue, hideTongue };
}
