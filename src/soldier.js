import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Soldado humano com animações (Idle / Walk / Run). Modelo: three.js examples (Soldier.glb, Mixamo).
let base = null;

export async function loadSoldierModel() {
  if (base) return base;
  const gltf = await new GLTFLoader().loadAsync(import.meta.env.BASE_URL + 'models/soldier.glb');
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      if (o.material) { o.material.envMapIntensity = 0.8; }
    }
  });
  base = { scene: gltf.scene, clips: gltf.animations };
  return base;
}

function gunMesh() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.7 });
  const p = new THREE.MeshStandardMaterial({ color: 0x3a3830, roughness: 0.85, metalness: 0.1 });
  const add = (geo, mat, x, y, z) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); me.castShadow = true; g.add(me); return me; };
  add(new THREE.BoxGeometry(0.06, 0.09, 0.42), m, 0, 0, 0);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 8).rotateX(Math.PI / 2), m, 0, 0.01, -0.36);
  add(new THREE.BoxGeometry(0.05, 0.16, 0.07), p, 0, -0.11, -0.06).rotation.x = 0.2;
  add(new THREE.BoxGeometry(0.05, 0.08, 0.22), p, 0, -0.02, 0.3);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 10).rotateX(Math.PI / 2), m, 0, 0.075, -0.02);
  return g;
}

// Cria um soldado. Retorna grupo raiz (encara -Z), mixer, ações e caixas de acerto.
export function makeSoldier(tint = 0) {
  const root = new THREE.Group();
  const model = cloneSkinned(base.scene);
  model.rotation.y = Math.PI; // o modelo original encara +Z
  // variação de cor do uniforme
  if (tint) {
    model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.color = new THREE.Color().setHSL(0.1 + tint * 0.05, 0.15, 0.55 + tint * 0.08);
      }
    });
  }
  root.add(model);

  // arma na mão direita
  let hand = null;
  model.traverse((o) => { if (!hand && /RightHand$/i.test(o.name)) hand = o; });
  if (hand) {
    const gun = gunMesh();
    gun.scale.setScalar(1 / (hand.getWorldScale(new THREE.Vector3()).x || 1));
    gun.rotation.set(0, Math.PI / 2, Math.PI / 2);
    gun.position.set(0, 8, 4);
    hand.add(gun);
  }

  // caixas de acerto invisíveis (mais leves que testar a malha animada)
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.45, 0.4), hitMat);
  body.position.y = 0.75;
  body.userData.part = 'body';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), hitMat);
  head.position.set(0, 1.63, 0);
  head.userData.part = 'head';
  root.add(body, head);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of base.clips) actions[clip.name] = mixer.clipAction(clip);
  ['Idle', 'Walk', 'Run'].forEach((n) => { if (actions[n]) { actions[n].play(); actions[n].setEffectiveWeight(n === 'Idle' ? 1 : 0); } });
  return { root, model, mixer, actions, hitboxes: [body, head] };
}

// mistura as animações conforme a velocidade (m/s)
export function blendSoldier(s, speed, dt) {
  const w = { Idle: speed < 0.3 ? 1 : 0, Walk: speed >= 0.3 && speed < 2.8 ? 1 : 0, Run: speed >= 2.8 ? 1 : 0 };
  for (const n of ['Idle', 'Walk', 'Run']) {
    const a = s.actions[n];
    if (!a) continue;
    const cur = a.getEffectiveWeight();
    a.setEffectiveWeight(cur + (w[n] - cur) * Math.min(1, dt * 8));
  }
  if (s.actions.Walk) s.actions.Walk.timeScale = Math.max(0.6, speed / 1.6);
  if (s.actions.Run) s.actions.Run.timeScale = Math.max(0.7, speed / 4.5);
  s.mixer.update(dt);
}
