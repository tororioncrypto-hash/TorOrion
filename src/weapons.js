import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Armas originais do WAR Thor Orion (desenho próprio, proporções de armas reais)
export const WEAPONS = [
  { id: 'r7', name: 'TO-R7 TROVÃO', type: 'Fuzil de assalto', auto: true, rpm: 680, dmg: 27, head: 2.0, mag: 30, reserve: 150, reload: 2.1, hip: 2.6, ads: 0.25, recoil: 0.75, adsFov: 50, range: 400, optic: 'holo', furniture: 0x6f604a },
  { id: 'v9', name: 'V9 RELÂMPAGO', type: 'Submetralhadora', auto: true, rpm: 920, dmg: 19, head: 1.7, mag: 34, reserve: 204, reload: 1.7, hip: 3.2, ads: 0.7, recoil: 0.5, adsFov: 58, range: 200, optic: 'dot', furniture: 0x1f2022 },
  { id: 'lr', name: 'ORION LR-50', type: 'Rifle de precisão', auto: false, rpm: 48, dmg: 115, head: 2.5, mag: 5, reserve: 30, reload: 3.0, hip: 7, ads: 0.0, recoil: 3.6, adsFov: 13, range: 1200, optic: 'sniper', furniture: 0x4a4e3c },
];

// ---------- texturas procedurais (micro-detalhe: arranhões, textura de polímero, camuflagem) ----------
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const mk = (size, draw, rep) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep, rep);
    t.anisotropy = 4;
    return t;
  };
  const rough = mk(256, (g, n) => {
    const im = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const v = 205 + Math.random() * 50; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
    g.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(110,110,110,${0.15 + Math.random() * 0.3})`;
      const x = Math.random() * n, y = Math.random() * n, a = Math.random() * Math.PI, l = 4 + Math.random() * 26;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }, 5);
  const stipple = mk(256, (g, n) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 6000; i++) {
      const v = Math.random() < 0.5 ? 70 : 190;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath(); g.arc(Math.random() * n, Math.random() * n, 0.6 + Math.random() * 1.3, 0, 7); g.fill();
    }
  }, 9);
  const camo = mk(512, (g, n) => {
    g.fillStyle = '#5f5a46'; g.fillRect(0, 0, n, n);
    const cols = ['#4a4737', '#77705a', '#3a3a2c', '#867c62', '#2e2e25'];
    for (let k = 0; k < cols.length; k++) {
      g.fillStyle = cols[k];
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * n, y = Math.random() * n, r = 10 + Math.random() * 34;
        g.beginPath();
        for (let a = 0; a < 6.28; a += 0.5) { const rr = r * (0.6 + Math.random() * 0.6); g.lineTo(x + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr); }
        g.fill();
      }
    }
    // trama do tecido
    g.globalAlpha = 0.08; g.fillStyle = '#000';
    for (let y = 0; y < n; y += 3) g.fillRect(0, y, n, 1);
    for (let x = 0; x < n; x += 3) g.fillRect(x, 0, 1, n);
    g.globalAlpha = 1;
  }, 1);
  const reticle = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,40,30,1)'; g.lineWidth = 5;
    g.beginPath(); g.arc(64, 64, 50, 0, 7); g.stroke();
    g.fillStyle = 'rgba(255,40,30,1)';
    g.beginPath(); g.arc(64, 64, 6, 0, 7); g.fill();
    for (const [x, y, w, h] of [[61, 4, 6, 14], [61, 110, 6, 14], [4, 61, 14, 6], [110, 61, 14, 6]]) g.fillRect(x, y, w, h);
    return new THREE.CanvasTexture(c);
  })();
  const dot = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    r.addColorStop(0, 'rgba(255,60,40,1)'); r.addColorStop(0.18, 'rgba(255,30,20,1)'); r.addColorStop(0.35, 'rgba(255,20,10,0.25)'); r.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  camo.colorSpace = reticle.colorSpace = dot.colorSpace = THREE.SRGBColorSpace;
  TEX = { rough, stipple, camo, reticle, dot };
  return TEX;
}

function materials(def) {
  const T = textures();
  const metal = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, roughnessMap: T.rough, envMapIntensity: 1.1, ...extra });
  const poly = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, bumpMap: T.stipple, bumpScale: 0.6 });
  return {
    al: metal(0x24262a, 0.42, 0.85), // alumínio anodizado
    st: metal(0x17181a, 0.3, 0.95), // aço
    tube: metal(0x1d1f22, 0.38, 0.85, { side: THREE.DoubleSide }),
    fur: def.id === 'lr' ? metal(def.furniture, 0.62, 0.35) : poly(def.furniture), // coronha/guarda-mão
    blk: poly(0x1c1d1c),
    rub: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95, metalness: 0 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x2f2c27, roughness: 0.92, metalness: 0, bumpMap: T.stipple, bumpScale: 0.4 }),
    knuckle: new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: 0.7, metalness: 0.05 }),
    sleeve: new THREE.MeshStandardMaterial({ map: T.camo, roughness: 0.95, metalness: 0, bumpMap: T.stipple, bumpScale: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fc4d8, roughness: 0.02, metalness: 0, transmission: 0, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 2 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0b1a26, roughness: 0.05, metalness: 0.9, envMapIntensity: 2.5 }),
  };
}

// ---------- utilitários de geometria (eixo do cano em -Z; "s" = distância para frente) ----------
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);

class Kit {
  constructor() { this.list = new Map(); }
  put(mat, geo) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!this.list.has(mat)) this.list.set(mat, []);
    this.list.get(mat).push(g);
    return g;
  }
  build(group) {
    for (const [mat, geos] of this.list) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }
}
function xf(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), ONE);
  return geo.applyMatrix4(M4);
}
// contorno 2D em (s, y). Itens ['q', cx, cy, x, y] são curvas.
function shape(pts, holes = []) {
  const run = (path, list) => list.forEach((p, i) => {
    if (p[0] === 'q') path.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else if (i === 0) path.moveTo(p[0], p[1]);
    else path.lineTo(p[0], p[1]);
  });
  const s = new THREE.Shape(); run(s, pts);
  for (const h of holes) { const p = new THREE.Path(); run(p, h); s.holes.push(p); }
  return s;
}
// peça de perfil lateral extrudada na largura (eixo X), com cantos chanfrados
function side(sh, w, b = 0.0018, x = 0) {
  const d = Math.max(0.0005, w - 2 * b);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -d / 2);
  g.rotateY(Math.PI / 2);
  if (x) g.translate(x, 0, 0);
  return g;
}
// peça de perfil frontal (x, y) extrudada no comprimento
function front(sh, len, s, b = 0.0015) {
  const d = Math.max(0.0005, len - 2 * b);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -d / 2 - s);
  return g;
}
function roundRect(x0, y0, x1, y1, r) {
  return [[x0 + r, y0], [x1 - r, y0], ['q', x1, y0, x1, y0 + r], [x1, y1 - r], ['q', x1, y1, x1 - r, y1], [x0 + r, y1], ['q', x0, y1, x0, y1 - r], [x0, y0 + r], ['q', x0, y0, x0 + r, y0]];
}
// cilindro ao longo do cano: r0 atrás (s0), r1 na frente (s1)
function tube(r0, r1, s0, s1, y, seg = 20, x = 0, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, s1 - s0, seg, 1, open);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, -(s0 + s1) / 2);
  return g;
}
function lathe(prof, y, seg = 36) {
  const g = new THREE.LatheGeometry(prof.map(([r, s]) => new THREE.Vector2(r, s)), seg);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
function rbox(w, h, len, x, y, s, r = 0.002, rx = 0, ry = 0, rz = 0) {
  return xf(new RoundedBoxGeometry(w, h, len, 2, Math.min(r, w / 2.1, h / 2.1, len / 2.1)), x, y, -s, rx, ry, rz);
}
// membro entre dois pontos (x, y, s) com raios diferentes nas pontas
function limb(a, b, ra, rb, seg = 16) {
  const A = new THREE.Vector3(a[0], a[1], -a[2]), B = new THREE.Vector3(b[0], b[1], -b[2]);
  const d = B.clone().sub(A); const len = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 3, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(Q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(A.x, A.y, A.z);
  const capA = new THREE.SphereGeometry(ra, seg, 8); capA.translate(A.x, A.y, A.z);
  const capB = new THREE.SphereGeometry(rb, seg, 8); capB.translate(B.x, B.y, B.z);
  return [g, capA, capB];
}

// ---------- peças comuns ----------
function rail(k, m, s0, s1, y) {
  k.put(m.al, rbox(0.021, 0.007, s1 - s0, 0, y + 0.0035, (s0 + s1) / 2, 0.0015));
  for (let s = s0 + 0.004; s < s1 - 0.003; s += 0.01) k.put(m.al, xf(new THREE.BoxGeometry(0.0225, 0.0035, 0.0052), 0, y + 0.0085, -s));
  return y + 0.0102; // topo do trilho
}
function pistolGrip(k, m, ds, mat) {
  const p = [[-0.058, -0.044], [-0.086, -0.044], [-0.096, -0.06], [-0.128, -0.15], ['q', -0.133, -0.169, -0.113, -0.171], [-0.097, -0.169], ['q', -0.086, -0.162, -0.088, -0.15], ['q', -0.079, -0.139, -0.083, -0.126], ['q', -0.073, -0.113, -0.077, -0.1], ['q', -0.067, -0.088, -0.07, -0.075], [-0.058, -0.05]];
  k.put(mat, side(shape(p.map((q) => q[0] === 'q' ? ['q', q[1] + ds, q[2], q[3] + ds, q[4]] : [q[0] + ds, q[1]])), 0.032, 0.006));
}
function triggerGroup(k, m, ds) {
  const o = (pts) => pts.map((q) => q[0] === 'q' ? ['q', q[1] + ds, q[2], q[3] + ds, q[4]] : [q[0] + ds, q[1]]);
  k.put(m.al, side(shape(o([[-0.072, -0.043], [0.004, -0.043], [0.004, -0.05], [-0.004, -0.074], [-0.064, -0.074], [-0.072, -0.066]]), [o([[-0.062, -0.049], [-0.006, -0.049], [-0.011, -0.068], [-0.058, -0.068]])]), 0.012, 0.0015));
  k.put(m.st, side(shape(o([[-0.036, -0.046], [-0.028, -0.046], [-0.03, -0.056], ['q', -0.033, -0.064, -0.041, -0.066], [-0.04, -0.061], ['q', -0.035, -0.057, -0.036, -0.046]])), 0.006, 0.001));
}
function muzzleBrake(k, m, s0, len, r, y) {
  k.put(m.st, tube(r, r, s0, s0 + len, y, 18));
  k.put(m.st, tube(r, r * 0.8, s0 + len, s0 + len + 0.006, y, 18));
  for (let i = 0; i < 3; i++) k.put(m.rub, xf(new THREE.BoxGeometry(r * 2.08, r * 0.55, len * 0.13), 0, y, -(s0 + len * (0.22 + i * 0.25))));
}
function pins(k, m, list) {
  for (const [s, y, w] of list) k.put(m.st, xf(new THREE.CylinderGeometry(0.0034, 0.0034, w, 10), 0, y, -s, 0, 0, Math.PI / 2));
}

// mira holográfica (janela retangular + retículo flutuante)
function holoSight(k, m, g, rt, s) {
  k.put(m.al, rbox(0.032, 0.012, 0.1, 0, rt + 0.006, s, 0.003));
  const yb = rt + 0.011, yt = rt + 0.054;
  k.put(m.al, front(shape(roundRect(-0.023, yb, 0.023, yt, 0.006), [roundRect(-0.0175, yb + 0.004, 0.0175, yt - 0.005, 0.003)]), 0.058, s + 0.016));
  k.put(m.al, rbox(0.03, 0.012, 0.036, 0, rt + 0.016, s - 0.034, 0.004));
  k.put(m.rub, rbox(0.006, 0.003, 0.006, -0.009, rt + 0.0235, s - 0.045, 0.001));
  k.put(m.rub, rbox(0.006, 0.003, 0.006, 0.009, rt + 0.0235, s - 0.045, 0.001));
  const sightY = (yb + 0.004 + yt - 0.005) / 2;
  for (const ss of [s + 0.04, s - 0.01]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.035, yt - yb - 0.009), m.glass);
    pane.position.set(0, sightY, -ss);
    g.add(pane);
  }
  const ret = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.014), new THREE.MeshBasicMaterial({ map: textures().reticle, color: 0xff6050, transparent: true, depthWrite: false, depthTest: false }));
  ret.position.set(0, sightY, -(s + 0.041));
  ret.renderOrder = 10;
  g.add(ret);
  return { sightY, rearS: s - 0.013, reticle: ret };
}
// mira reflex compacta (ponto vermelho)
function reflexSight(k, m, g, rt, s) {
  k.put(m.al, rbox(0.027, 0.01, 0.045, 0, rt + 0.005, s, 0.003));
  const yb = rt + 0.009, yt = rt + 0.04;
  k.put(m.al, front(shape(roundRect(-0.018, yb, 0.018, yt, 0.008), [roundRect(-0.0145, yb + 0.003, 0.0145, yt - 0.0035, 0.006)]), 0.01, s + 0.012));
  k.put(m.al, rbox(0.012, 0.012, 0.016, 0.019, rt + 0.017, s - 0.006, 0.003));
  const sightY = (yb + 0.003 + yt - 0.0035) / 2;
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.03, yt - yb - 0.006), m.glass);
  pane.position.set(0, sightY, -(s + 0.012));
  g.add(pane);
  const ret = new THREE.Mesh(new THREE.PlaneGeometry(0.0035, 0.0035), new THREE.MeshBasicMaterial({ map: textures().dot, color: 0xff6050, transparent: true, depthWrite: false, depthTest: false }));
  ret.position.set(0, sightY, -(s + 0.013));
  ret.renderOrder = 10;
  g.add(ret);
  return { sightY, rearS: s + 0.007, reticle: ret };
}
// luneta de precisão
function longScope(k, m, g, rt, s) {
  const y = rt + 0.04;
  const prof = [[0.021, -0.2], [0.024, -0.198], [0.024, -0.14], [0.019, -0.125], [0.0165, -0.115], [0.0165, 0.06], [0.021, 0.085], [0.029, 0.12], [0.029, 0.2], [0.026, 0.203]];
  const L = lathe(prof.map(([r, ss]) => [r, ss + s]), y);
  k.put(m.tube, L);
  k.put(m.st, xf(new THREE.CylinderGeometry(0.013, 0.013, 0.022, 24), 0, y + 0.024, -(s - 0.02)));
  k.put(m.st, xf(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 24), 0.024, y, -(s - 0.02), 0, 0, Math.PI / 2));
  k.put(m.st, xf(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 16), -0.021, y, -(s - 0.02), 0, 0, Math.PI / 2));
  for (const ss of [s - 0.085, s + 0.045]) {
    k.put(m.al, tube(0.0195, 0.0195, ss - 0.009, ss + 0.009, y, 24));
    k.put(m.al, rbox(0.02, y - rt - 0.012, 0.018, 0, (y + rt) / 2 - 0.006, ss, 0.002));
  }
  const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.027, 32), m.lens);
  lensF.position.set(0, y, -(s + 0.198)); lensF.rotation.y = Math.PI; g.add(lensF);
  const lensR = new THREE.Mesh(new THREE.CircleGeometry(0.022, 32), m.lens);
  lensR.position.set(0, y, -(s - 0.195)); g.add(lensR);
  return { sightY: y, rearS: s - 0.2, reticle: null };
}

// braços e luvas: mão direita no punho, mão esquerda no guarda-mão
function arms(k, m, ds, leftS, hgBottom, boreY) {
  const G = m.glove, S = m.sleeve;
  // mão direita (gira para trás junto com o punho)
  const gx = (y) => -0.07 + ds - (y + 0.05) * 0.29; // borda da frente do punho na altura y
  k.put(G, rbox(0.03, 0.07, 0.05, 0.017, -0.105, -0.112 + ds, 0.012, 0.3));
  for (let i = 0; i < 3; i++) {
    const y = -0.092 - i * 0.022, s = gx(y) + 0.006;
    for (const geo of limb([0.02, y, s - 0.01], [-0.012, y - 0.003, s + 0.004], 0.0092, 0.0088, 10)) k.put(G, geo);
    for (const geo of limb([-0.012, y - 0.003, s + 0.004], [-0.022, y - 0.006, s - 0.016], 0.0088, 0.0082, 10)) k.put(G, geo);
    k.put(m.knuckle, rbox(0.012, 0.012, 0.012, 0.008, y + 0.002, s + 0.004, 0.004));
  }
  // indicador estendido ao lado do guarda-mato (dedo fora do gatilho)
  for (const geo of limb([0.006, -0.058, -0.08 + ds], [-0.021, -0.05, -0.05 + ds], 0.0092, 0.0088, 10)) k.put(G, geo);
  for (const geo of limb([-0.021, -0.05, -0.05 + ds], [-0.023, -0.047, -0.012 + ds], 0.0088, 0.008, 10)) k.put(G, geo);
  // polegar
  for (const geo of limb([-0.004, -0.06, -0.12 + ds], [-0.024, -0.03, -0.085 + ds], 0.011, 0.0095, 10)) k.put(G, geo);
  for (const geo of limb([-0.024, -0.03, -0.085 + ds], [-0.025, -0.018, -0.06 + ds], 0.0095, 0.0085, 10)) k.put(G, geo);
  // punho/antebraço direito
  for (const geo of limb([0.018, -0.14, -0.13 + ds], [0.03, -0.175, -0.18 + ds], 0.028, 0.03)) k.put(G, geo);
  for (const geo of limb([0.03, -0.17, -0.175 + ds], [0.11, -0.3, -0.45 + ds], 0.036, 0.048)) k.put(S, geo);
  k.put(m.knuckle, tube(0.036, 0.036, -0.2 + ds, -0.185 + ds, 0, 16)); // punho elástico (escondido no braço)

  // mão esquerda segurando por baixo
  const yb = hgBottom;
  k.put(G, rbox(0.05, 0.028, 0.075, 0.004, yb - 0.012, leftS, 0.012, 0, 0, 0.15));
  for (let i = 0; i < 4; i++) {
    const s = leftS + 0.03 - i * 0.021;
    for (const geo of limb([0.022, yb - 0.016, s], [0.034, boreY, s + 0.003], 0.0092, 0.0085, 10)) k.put(G, geo);
    for (const geo of limb([0.034, boreY, s + 0.003], [0.026, boreY + 0.02, s + 0.005], 0.0085, 0.0078, 10)) k.put(G, geo);
  }
  for (const geo of limb([-0.022, yb - 0.012, leftS - 0.03], [-0.035, boreY - 0.004, leftS + 0.0], 0.012, 0.0105, 10)) k.put(G, geo);
  for (const geo of limb([-0.035, boreY - 0.004, leftS + 0.0], [-0.036, boreY + 0.006, leftS + 0.03], 0.0105, 0.009, 10)) k.put(G, geo);
  for (const geo of limb([-0.012, yb - 0.03, leftS - 0.04], [-0.04, yb - 0.06, leftS - 0.1], 0.027, 0.029)) k.put(G, geo);
  for (const geo of limb([-0.038, yb - 0.057, leftS - 0.095], [-0.2, -0.24, leftS - 0.38], 0.035, 0.047)) k.put(S, geo);
}

// ---------- montagem de cada arma ----------
function buildR7(k, m, g) {
  const Y = 0.024;
  k.put(m.al, side(shape([[-0.13, 0.0], [0.125, 0.0], [0.125, 0.046], [-0.115, 0.046], [-0.13, 0.034]]), 0.044, 0.0025));
  k.put(m.st, rbox(0.002, 0.016, 0.06, 0.0225, 0.022, 0.03, 0.0008));
  k.put(m.al, tube(0.0075, 0.0075, -0.095, -0.062, 0.032, 14, 0.026));
  k.put(m.al, rbox(0.052, 0.009, 0.02, 0, 0.04, -0.142, 0.003));
  k.put(m.al, side(shape([[-0.125, 0.0], [0.098, 0.0], [0.098, -0.022], [0.088, -0.03], [0.088, -0.082], [0.004, -0.082], [0.004, -0.044], [-0.07, -0.044], [-0.085, -0.035], [-0.125, -0.024]]), 0.04, 0.0025));
  triggerGroup(k, m, 0);
  pistolGrip(k, m, 0, m.fur);
  k.put(m.st, rbox(0.003, 0.006, 0.018, -0.021, -0.013, -0.076, 0.001, 0.4));
  k.put(m.al, rbox(0.004, 0.014, 0.009, -0.021, -0.012, 0.012, 0.001));
  pins(k, m, [[-0.112, -0.012, 0.044], [0.09, -0.008, 0.044]]);
  // coronha
  k.put(m.al, tube(0.0155, 0.0155, -0.31, -0.128, 0.026, 20));
  k.put(m.al, tube(0.019, 0.019, -0.142, -0.128, 0.026, 10));
  k.put(m.fur, side(shape([[-0.212, 0.047], [-0.386, 0.051], [-0.4, 0.045], [-0.4, -0.072], [-0.39, -0.08], [-0.35, -0.062], [-0.29, -0.03], [-0.212, 0.0]], [[[-0.36, -0.006], [-0.305, -0.006], [-0.305, -0.026], [-0.36, -0.05]]]), 0.042, 0.005));
  k.put(m.rub, rbox(0.044, 0.13, 0.012, 0, -0.016, -0.405, 0.004));
  // guarda-mão com fendas
  const slots = [];
  for (let s = 0.15; s < 0.47; s += 0.052) { slots.push(roundRect(s, 0.001, s + 0.032, 0.011, 0.0045)); slots.push(roundRect(s + 0.02, 0.027, s + 0.044, 0.035, 0.004)); }
  k.put(m.al, side(shape([[0.125, -0.008], [0.49, -0.008], [0.5, 0.0], [0.5, 0.042], [0.49, 0.05], [0.125, 0.05]], slots), 0.058, 0.006));
  const rt = rail(k, m, -0.125, 0.495, 0.046);
  // cano e freio de boca
  k.put(m.st, tube(0.0095, 0.0095, 0.48, 0.76, Y, 16));
  muzzleBrake(k, m, 0.755, 0.06, 0.0135, Y);
  // carregador curvo
  k.put(m.blk, side(shape([[0.006, -0.076], [0.086, -0.076], ['q', 0.092, -0.16, 0.118, -0.243], [0.121, -0.252], [0.058, -0.263], [0.054, -0.252], ['q', 0.022, -0.165, 0.006, -0.076]]), 0.025, 0.003));
  k.put(m.blk, side(shape([[0.053, -0.249], [0.124, -0.238], [0.127, -0.252], [0.056, -0.266]]), 0.03, 0.003));
  const sight = holoSight(k, m, g, rt, -0.005);
  arms(k, m, 0, 0.36, -0.008, Y);
  return { ...sight, muzzleS: 0.83, boreY: Y, relief: 0.15 };
}

function buildV9(k, m, g) {
  const Y = 0.02;
  k.put(m.al, side(shape([[-0.11, -0.02], [0.135, -0.02], [0.135, 0.044], [-0.1, 0.044], [-0.11, 0.034]]), 0.042, 0.003));
  k.put(m.blk, side(shape([[-0.1, -0.02], [0.065, -0.02], [0.065, -0.03], [0.025, -0.046], [-0.07, -0.046], [-0.1, -0.032]]), 0.04, 0.003));
  k.put(m.al, side(shape([[0.024, -0.03], [0.068, -0.03], [0.068, -0.075], [0.024, -0.075]]), 0.034, 0.003));
  triggerGroup(k, m, 0.005);
  pistolGrip(k, m, 0.0, m.blk);
  k.put(m.st, rbox(0.003, 0.006, 0.018, -0.021, -0.012, -0.07, 0.001, 0.4));
  pins(k, m, [[-0.09, -0.01, 0.043], [0.1, 0.0, 0.043]]);
  k.put(m.st, rbox(0.012, 0.012, 0.03, 0.02, 0.028, 0.02, 0.002));
  // coronha esqueleto
  k.put(m.st, side(shape([[-0.105, 0.04], [-0.33, 0.032], [-0.342, 0.022], [-0.342, -0.062], [-0.33, -0.07], [-0.105, -0.022]], [[[-0.125, 0.026], [-0.318, 0.019], [-0.318, -0.052], [-0.125, -0.009]]]), 0.026, 0.003));
  k.put(m.rub, rbox(0.03, 0.1, 0.012, 0, -0.02, -0.347, 0.004));
  // guarda-mão e supressor
  const slots = [roundRect(0.16, 0.0, 0.19, 0.01, 0.004), roundRect(0.205, 0.0, 0.235, 0.01, 0.004)];
  k.put(m.blk, side(shape([[0.135, -0.014], [0.26, -0.014], [0.27, -0.004], [0.27, 0.036], [0.26, 0.044], [0.135, 0.044]], slots), 0.05, 0.006));
  const rt = rail(k, m, -0.1, 0.13, 0.044);
  k.put(m.st, tube(0.009, 0.009, 0.26, 0.29, Y, 14));
  k.put(m.rub, tube(0.021, 0.021, 0.285, 0.47, Y, 28));
  k.put(m.st, tube(0.021, 0.018, 0.47, 0.478, Y, 28));
  k.put(m.st, tube(0.0215, 0.0215, 0.282, 0.296, Y, 28));
  // carregador reto
  k.put(m.al, side(shape([[0.028, -0.065], [0.064, -0.065], [0.072, -0.205], [0.034, -0.205]]), 0.022, 0.003));
  k.put(m.blk, side(shape([[0.031, -0.2], [0.076, -0.2], [0.077, -0.212], [0.031, -0.212]]), 0.026, 0.002));
  const sight = reflexSight(k, m, g, rt, 0.0);
  arms(k, m, 0.005, 0.2, -0.014, Y);
  return { ...sight, muzzleS: 0.48, boreY: Y, relief: 0.2 };
}

function buildLR(k, m, g) {
  const Y = 0.028;
  // chassi
  k.put(m.fur, side(shape([[-0.2, 0.004], [0.25, 0.004], [0.25, -0.015], [0.1, -0.032], [0.1, -0.072], [0.03, -0.072], [0.03, -0.044], [-0.07, -0.044], [-0.09, -0.03], [-0.2, -0.022]]), 0.05, 0.004));
  // ação de ferrolho
  k.put(m.st, tube(0.021, 0.021, -0.19, 0.16, Y, 28));
  k.put(m.st, tube(0.015, 0.019, -0.235, -0.19, Y, 24));
  k.put(m.st, rbox(0.004, 0.018, 0.06, -0.021, Y + 0.004, 0.0, 0.001));
  for (const geo of limb([0.018, Y + 0.004, -0.13], [0.05, Y - 0.03, -0.15], 0.0045, 0.0045, 10)) k.put(m.st, geo);
  k.put(m.st, xf(new THREE.SphereGeometry(0.011, 16, 12), 0.054, Y - 0.035, 0.152));
  triggerGroup(k, m, -0.02);
  pistolGrip(k, m, -0.02, m.blk);
  // coronha de precisão com apoio de bochecha
  k.put(m.fur, side(shape([[-0.2, 0.038], [-0.29, 0.04], [-0.3, 0.064], [-0.48, 0.066], [-0.5, 0.05], [-0.52, 0.05], [-0.522, -0.1], [-0.505, -0.112], [-0.44, -0.1], [-0.42, -0.088], [-0.36, -0.062], [-0.24, -0.03], [-0.2, -0.022]], [[[-0.42, 0.03], [-0.33, 0.03], [-0.33, -0.012], [-0.38, -0.035], [-0.42, -0.04]]]), 0.046, 0.005));
  k.put(m.rub, rbox(0.048, 0.162, 0.014, 0, -0.025, -0.527, 0.005));
  // guarda-mão
  const slots = [];
  for (let s = 0.28; s < 0.6; s += 0.06) slots.push(roundRect(s, 0.0, s + 0.036, 0.012, 0.005));
  k.put(m.fur, side(shape([[0.25, -0.018], [0.61, -0.018], [0.62, -0.006], [0.62, 0.05], [0.61, 0.058], [0.25, 0.058]], slots), 0.064, 0.007));
  const rt = rail(k, m, -0.19, 0.6, Y + 0.02);
  // cano pesado e freio
  k.put(m.st, tube(0.014, 0.012, 0.6, 1.02, Y, 20));
  muzzleBrake(k, m, 1.015, 0.085, 0.019, Y);
  // carregador e bipé recolhido
  k.put(m.st, side(shape([[0.036, -0.06], [0.094, -0.06], [0.096, -0.106], [0.034, -0.106]]), 0.028, 0.003));
  k.put(m.al, rbox(0.03, 0.012, 0.03, 0, -0.026, 0.57, 0.003));
  for (const x of [-0.011, 0.011]) k.put(m.al, tube(0.005, 0.005, 0.36, 0.565, -0.03, 10, x));
  const sight = longScope(k, m, g, rt, 0.0);
  arms(k, m, -0.02, 0.42, -0.018, Y);
  return { ...sight, muzzleS: 1.105, boreY: Y, relief: 0.12 };
}

// Modelo da arma em 1ª pessoa. Eixo do cano em -Z.
// Retorna { group, sightY, muzzle, length, adsZ, reticle }
export function buildWeaponModel(def) {
  const g = new THREE.Group();
  const m = materials(def);
  const k = new Kit();
  const info = def.id === 'lr' ? buildLR(k, m, g) : def.id === 'v9' ? buildV9(k, m, g) : buildR7(k, m, g);
  k.build(g);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return {
    group: g,
    sightY: info.sightY,
    muzzle: new THREE.Vector3(0, info.boreY, -info.muzzleS),
    length: info.muzzleS,
    adsZ: info.rearS - info.relief,
    reticle: info.reticle,
  };
}
