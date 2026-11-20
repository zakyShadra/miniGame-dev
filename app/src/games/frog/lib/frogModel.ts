// Model katak ala Froggin Around (key art 2026-11-20): badan RENDAH
// dan LEBAR (duduk pipih seperti katak asli), kepala lebar, mata
// besar menonjol di atas kepala, kaki melebar ke samping.
// Katak hijau (bintik kuning, mata merah) + katak oranye-merah
// (bercak biru-ungu, mata kuning, kaki biru). Katak menghadap +z,
// origin di kaki (y=0), lebar ~0.9m. buildFrogModel(color) dipakai
// scene (slot0/slot1). Lidah tebal berdaging + ujung cakram hijau
// terang (F6.5, Froggin).
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
  /** Bulge radial saat tembak (1 = normal, >1 = membesar daging). */
  setTongue(from: THREE.Vector3, to: THREE.Vector3, bulge?: number): void;
  hideTongue(): void;
}

const SKIN: Record<FrogColor, { belly: string; iris: string; legs: string }> = {
  orange: { belly: "#ffd9a8", iris: "#ffc300", legs: "#4a6fd4" },
  green: { belly: "#eaf7c8", iris: "#e63946", legs: "#5da336" },
};

function std(color: string, roughness = 0.4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** Kaki belakang: paha gemuk + telapak lebar pipih + 3 jari melebar.
 * Merentang ke samping ala Froggin (F6.6): kaki keluar dari badan,
 * telapak menghadap keluar. */
function buildHindLeg(side: 1 | -1, mat: THREE.Material): THREE.Group {
  const leg = new THREE.Group();
  leg.position.set(side * 0.45, 0.18, -0.08);
  // Paha: menonjol ke samping (katak duduk, kaki menekuk).
  const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), mat);
  thigh.scale.set(0.9, 0.7, 1.3);
  thigh.position.set(side * 0.09, 0.02, -0.02);
  thigh.rotation.z = side * -0.55;
  leg.add(thigh);
  // Telapak: lebar, pipih, menjulur ke depan-samping.
  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), mat);
  foot.scale.set(1.25, 0.32, 1.7);
  foot.position.set(side * 0.14, -0.12, 0.14);
  foot.rotation.y = side * 0.55;
  leg.add(foot);
  // 3 jari di ujung telapak.
  for (let i = -1; i <= 1; i++) {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat);
    toe.scale.set(1, 0.5, 1.4);
    toe.position.set(side * 0.14 + i * 0.07, -0.13, 0.34);
    toe.rotation.y = side * 0.55 + i * 0.25;
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

  // Kulit: texture prosedural (bintik/bercak) + kilau halus. F6.6:
  // roughness 0.3 (glossy ala Froggin).
  const skin = new THREE.MeshStandardMaterial({
    map: getFrogSkinTexture(color),
    roughness: 0.3,
    bumpMap: getFrogSkinTexture(color),
    bumpScale: 0.6,
  });
  const legMat = std(s.legs, 0.32);

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

  // Pantat BESAR 2 lobus, signature Froggin (F6.6): menonjol ke
  // belakang dari badan, terlihat jelas dari kamera belakang.
  // Referensi: f6-walk-pantat-katak.png.
  for (const side of [-1, 1] as const) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), skin);
    lobe.scale.set(1, 0.92, 1);
    lobe.position.set(side * 0.17, 0.3, -0.33);
    body.add(lobe);
  }

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

  // Lidah TEBAL berdaging ala Froggin (F6.5): silinder meruncing
  // (pangkal 0.15, ujung 0.12) + cangkir hisap cakram HIJAU TERANG
  // ganda di ujung (referensi: f6-trailer-lidah-tebal.png).
  const tongue = new THREE.Group();
  const tongueMat = std("#ff7d9c", 0.35);
  const tongueMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1, 14), tongueMat);
  const tipMat = new THREE.MeshStandardMaterial({
    color: "#39ff14",
    roughness: 0.3,
    emissive: "#1fd41f",
    emissiveIntensity: 0.6,
  });
  // Cakram luar (menghadap target) + cakram dalam (pangkal cangkir).
  // Tebal 0.12/0.10 m: lidah ke anchor lentera hampir vertikal, jadi
  // kamera melihat cakram dari samping (edge-on); cakram tipis 0.05 m
  // tidak terlihat sama sekali dari sudut itu.
  const tipOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 20), tipMat);
  const tipInner = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 20), tipMat);
  tongue.add(tongueMesh, tipOuter, tipInner);
  tongue.visible = false;

  function setTongue(from: THREE.Vector3, to: THREE.Vector3, bulge = 1): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    // Lidah belum keluar dari mulut: sembunyikan (hindari skala 1/0).
    if (len < 0.05) {
      tongue.visible = false;
      return;
    }
    tongue.visible = true;
    tongue.position.copy(from).addScaledVector(dir, 0.5);
    tongue.scale.set(bulge, len, bulge);
    tongue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    // Ujung di y=0.5 (ujung silinder satuan); skala y 1/len menjaga
    // ketebalan cakram tetap dalam satuan dunia. Cakram ditarik mundur
    // dari ujung: sangkar lentera anchor (0.42 m, berpusat di titik
    // anchor, bawahnya 0.21 m di bawah anchor) menutupi cakram bila
    // tepat di ujung. Cakram luar 0.26-0.38 m, dalam 0.39-0.49 m
    // sebelum ujung.
    tipOuter.position.y = 0.5 - 0.32 / len;
    tipOuter.scale.set(1, 1 / len, 1);
    tipInner.position.y = 0.5 - 0.44 / len;
    tipInner.scale.set(1, 1 / len, 1);
  }
  function hideTongue(): void {
    tongue.visible = false;
  }

  return { group, body, tongue, legL, legR, armL, armR, eyeL, eyeR, setTongue, hideTongue };
}
