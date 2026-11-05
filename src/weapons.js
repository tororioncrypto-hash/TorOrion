import * as THREE from 'three';

// Armas originais do WAR Thor Orion
export const WEAPONS = [
  { id: 'r7', name: 'TO-R7 TROVÃO', type: 'Fuzil de assalto', auto: true, rpm: 680, dmg: 27, head: 2.0, mag: 30, reserve: 150, reload: 2.1, hip: 2.6, ads: 0.25, recoil: 0.75, adsFov: 48, range: 400, optic: 'scope', accent: 0xc8ff2e },
  { id: 'v9', name: 'V9 RELÂMPAGO', type: 'Submetralhadora', auto: true, rpm: 920, dmg: 19, head: 1.7, mag: 34, reserve: 204, reload: 1.7, hip: 3.2, ads: 0.7, recoil: 0.5, adsFov: 58, range: 200, optic: 'dot', accent: 0x2ee6ff },
  { id: 'lr', name: 'ORION LR-50', type: 'Rifle de precisão', auto: false, rpm: 48, dmg: 115, head: 2.5, mag: 5, reserve: 30, reload: 3.0, hip: 7, ads: 0.0, recoil: 3.6, adsFov: 13, range: 1200, optic: 'sniper', accent: 0xff8a1c },
];

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.6, ...o });

function box(g, w, h, d, x, y, z, m) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  g.add(me);
  return me;
}
function cyl(g, r1, r2, len, x, y, z, m, seg = 14, open = false) {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg, 1, open), m);
  me.rotation.x = Math.PI / 2;
  me.position.set(x, y, z);
  g.add(me);
  return me;
}

// Modelo da arma em 1ª pessoa. Eixo do cano em -Z. Retorna { group, sightY, muzzle }
export function buildWeaponModel(def) {
  const g = new THREE.Group();
  const black = mat(0x1d2024, { roughness: 0.38, metalness: 0.75 });
  const tubeM = mat(0x1d2024, { roughness: 0.38, metalness: 0.75, side: THREE.DoubleSide });
  const dark = mat(0x23272c, { roughness: 0.6 });
  const polymer = mat(0x2b2e2a, { roughness: 0.85, metalness: 0.1 });
  const accent = new THREE.MeshStandardMaterial({ color: def.accent, emissive: def.accent, emissiveIntensity: 0.9, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a3040, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.18, depthWrite: false });

  const L = def.id === 'lr' ? 1.25 : def.id === 'v9' ? 0.62 : 0.9;
  // corpo
  box(g, 0.07, 0.085, L * 0.42, 0, 0, -L * 0.05, black);
  box(g, 0.064, 0.06, L * 0.38, 0, 0.005, -L * 0.42, dark); // guarda-mão
  for (let i = 0; i < 4; i++) box(g, 0.068, 0.008, L * 0.3, 0, -0.02 + i * 0.016, -L * 0.42, polymer);
  cyl(g, 0.012, 0.012, L * 0.35, 0, 0.012, -L * 0.75, black); // cano
  cyl(g, 0.022, 0.02, 0.07, 0, 0.012, -L * 0.93, black); // quebra-chamas
  box(g, 0.075, 0.012, L * 0.6, 0, 0.05, -L * 0.2, dark); // trilho
  for (let i = 0; i < 12; i++) box(g, 0.076, 0.006, 0.01, 0, 0.058, -L * 0.48 + i * L * 0.05, black);
  // carregador
  const magM = box(g, 0.045, def.id === 'lr' ? 0.07 : 0.17, 0.07, 0, -0.1, -L * 0.1, polymer);
  magM.rotation.x = def.id === 'lr' ? 0 : 0.18;
  // empunhadura e coronha
  const grip = box(g, 0.045, 0.12, 0.05, 0, -0.085, L * 0.13, polymer); grip.rotation.x = -0.3;
  box(g, 0.05, 0.075, def.id === 'v9' ? 0.16 : 0.26, 0, -0.01, L * 0.18 + 0.12, polymer);
  box(g, 0.055, 0.11, 0.03, 0, -0.025, L * 0.18 + 0.25, black);
  // detalhes neon (assinatura visual Thor Orion)
  box(g, 0.072, 0.004, L * 0.35, 0, -0.03, -L * 0.05, accent);
  box(g, 0.004, 0.06, 0.004, 0.036, 0.01, -L * 0.5, accent);
  box(g, 0.004, 0.06, 0.004, -0.036, 0.01, -L * 0.5, accent);

  // mira
  let sightY = 0.1;
  if (def.optic === 'scope' || def.optic === 'sniper') {
    const big = def.optic === 'sniper';
    const r = big ? 0.032 : 0.042;
    const len = big ? 0.36 : 0.16;
    sightY = 0.115;
    const tube = cyl(g, r, r, len, 0, sightY, -L * 0.12, tubeM, 24, true);
    cyl(g, r * 1.35, r, 0.05, 0, sightY, -L * 0.12 - len / 2 - 0.02, tubeM, 24, true); // objetiva
    cyl(g, r * 1.1, r * 1.1, 0.04, 0, sightY, -L * 0.12 + len / 2, tubeM, 24, true);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(r * 1.25, 24), glass);
    lens.position.set(0, sightY, -L * 0.12 - len / 2 - 0.046);
    g.add(lens);
    // anel neon no visor
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.12, 0.003, 6, 32), accent);
    ring.position.set(0, sightY, -L * 0.12 + len / 2 + 0.021);
    g.add(ring);
    box(g, 0.02, 0.03, 0.03, 0, 0.068, -L * 0.12 - len * 0.3, black); // montagem
    box(g, 0.02, 0.03, 0.03, 0, 0.068, -L * 0.12 + len * 0.3, black);
    box(g, 0.03, 0.025, 0.03, r + 0.012, sightY, -L * 0.12, dark); // torre
    tube.userData.scope = true;
  } else {
    // red dot
    sightY = 0.098;
    box(g, 0.05, 0.035, 0.05, 0, 0.075, -L * 0.15, black);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 8, 24), black);
    frame.position.set(0, sightY, -L * 0.15);
    g.add(frame);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0022, 10), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    dot.position.set(0, sightY, -L * 0.15 - 0.01);
    g.add(dot);
  }

  // braços/luvas (originais)
  const glove = mat(0x3a3326, { roughness: 0.9, metalness: 0 });
  const sleeve = mat(0x4a4a3a, { roughness: 0.95, metalness: 0 });
  const hand1 = box(g, 0.06, 0.07, 0.11, 0.01, -0.07, L * 0.12, glove); hand1.rotation.x = -0.3;
  const arm1 = box(g, 0.09, 0.09, 0.5, 0.08, -0.14, L * 0.12 + 0.24, sleeve); arm1.rotation.set(-0.15, -0.25, 0);
  const hand2 = box(g, 0.07, 0.06, 0.12, -0.02, -0.045, -L * 0.42, glove); hand2.rotation.z = 0.2;
  const arm2 = box(g, 0.09, 0.09, 0.55, -0.16, -0.12, -L * 0.42 + 0.27, sleeve); arm2.rotation.set(-0.1, 0.45, 0);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  const muzzle = new THREE.Vector3(0, 0.012, -L * 0.97);
  return { group: g, sightY, muzzle, length: L };
}

// Soldado inimigo (modelo original, low-poly)
export function buildSoldier(colorSet = 0) {
  const g = new THREE.Group();
  const camo = [0x55593f, 0x4d4f52, 0x6b5e45][colorSet % 3];
  const cloth = new THREE.MeshStandardMaterial({ color: camo, roughness: 0.95 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x2c2f2a, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8d6a52, roughness: 0.8 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0x3b3d33, roughness: 0.7 });
  const visor = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2000, emissiveIntensity: 1.2 });
  const gun = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.5, metalness: 0.6 });
  const part = (geo, m, x, y, z, tag, parent = g) => {
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    me.castShadow = true;
    me.userData.part = tag;
    parent.add(me);
    return me;
  };
  const legL = new THREE.Group(); legL.position.set(-0.13, 0.92, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.13, 0.92, 0); g.add(legR);
  part(new THREE.BoxGeometry(0.2, 0.9, 0.22), cloth, 0, -0.45, 0, 'body', legL);
  part(new THREE.BoxGeometry(0.2, 0.9, 0.22), cloth, 0, -0.45, 0, 'body', legR);
  part(new THREE.BoxGeometry(0.22, 0.1, 0.3), vest, 0, -0.88, -0.04, 'body', legL);
  part(new THREE.BoxGeometry(0.22, 0.1, 0.3), vest, 0, -0.88, -0.04, 'body', legR);
  part(new THREE.BoxGeometry(0.5, 0.62, 0.28), cloth, 0, 1.24, 0, 'body');
  part(new THREE.BoxGeometry(0.54, 0.46, 0.34), vest, 0, 1.3, 0, 'body');
  const head = part(new THREE.BoxGeometry(0.24, 0.26, 0.26), skin, 0, 1.72, 0, 'head');
  part(new THREE.BoxGeometry(0.3, 0.14, 0.32), helmet, 0, 1.86, 0, 'head');
  part(new THREE.BoxGeometry(0.22, 0.05, 0.02), visor, 0, 1.75, -0.135, 'head');
  const arms = new THREE.Group(); arms.position.set(0, 1.45, 0); g.add(arms);
  part(new THREE.BoxGeometry(0.14, 0.14, 0.55), cloth, 0.28, -0.1, -0.2, 'body', arms);
  part(new THREE.BoxGeometry(0.14, 0.14, 0.5), cloth, -0.22, -0.12, -0.3, 'body', arms);
  part(new THREE.BoxGeometry(0.07, 0.12, 0.75), gun, 0.05, -0.08, -0.5, 'body', arms);
  // braçadeira vermelha (inimigo)
  part(new THREE.BoxGeometry(0.16, 0.06, 0.16), new THREE.MeshStandardMaterial({ color: 0xc01818 }), 0.28, -0.1, 0.02, 'body', arms);
  g.userData = { legL, legR, arms, head };
  return g;
}
