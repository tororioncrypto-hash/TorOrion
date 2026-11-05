import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { OVERPASS_URLS, IMAGERY_ATTRIB } from '../config.js';
import { buildImageryCanvas, imageryPlane, makeProjection, pointInPoly, closestOnSeg, seededRandom, addSkyAndLights } from './common.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const CELL = 16;

// ---------- Fachadas (texturas geradas: tijolo, reboco, vidro espelhado, lojas) ----------
function canvasTex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function noise(g, w, h, n, a, base = 128, spread = 60) {
  for (let i = 0; i < n; i++) {
    const v = base + (Math.random() - 0.5) * spread;
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}
function drawWindow(g, x, y, w, h, frame = '#e8e6e0') {
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 3, y - 3, w + 6, h + 8); // sombra/recorte
  g.fillStyle = frame; g.fillRect(x - 2, y - 2, w + 4, h + 4);
  const gr = g.createLinearGradient(x, y, x + w * 0.6, y + h);
  gr.addColorStop(0, '#9db4c6'); gr.addColorStop(0.45, '#3d5466'); gr.addColorStop(1, '#1c2733');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 2, y + 2, w * 0.35, h * 0.12);
  g.fillStyle = frame; g.fillRect(x + w / 2 - 1.5, y, 3, h); g.fillRect(x, y + h * 0.38, w, 3);
  g.fillStyle = '#cfcac0'; g.fillRect(x - 5, y + h + 2, w + 10, 5); // peitoril
  // cortina em algumas
  if (Math.random() < 0.35) { g.fillStyle = `rgba(${200 + Math.random() * 55},${180 + Math.random() * 60},${150 + Math.random() * 80},.55)`; g.fillRect(x + 1, y + 1, w * (0.3 + Math.random() * 0.4), h - 2); }
}
function facadeSet(brickImg) {
  const S = 256;
  // reboco pintado
  const plaster = document.createElement('canvas'); plaster.width = plaster.height = S;
  let g = plaster.getContext('2d');
  g.fillStyle = '#e9e4da'; g.fillRect(0, 0, S, S);
  noise(g, S, S, 2500, 0.08, 200, 80);
  g.fillStyle = 'rgba(80,70,60,.10)'; for (let i = 0; i < 6; i++) g.fillRect(Math.random() * S, S * 0.8, 2, S * 0.2); // escorridos
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, S - 10, S, 10); // laje
  drawWindow(g, 70, 60, 116, 120);
  // tijolo aparente
  const brick = document.createElement('canvas'); brick.width = brick.height = S;
  g = brick.getContext('2d');
  if (brickImg) g.drawImage(brickImg, 0, 0, S, S); else { g.fillStyle = '#8b4a35'; g.fillRect(0, 0, S, S); }
  g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, S - 12, S, 12);
  drawWindow(g, 74, 62, 108, 118, '#f2efe8');
  // vidro espelhado (prédios altos)
  const glass = document.createElement('canvas'); glass.width = glass.height = S;
  g = glass.getContext('2d');
  const gg = g.createLinearGradient(0, 0, S, S);
  gg.addColorStop(0, '#7d95a8'); gg.addColorStop(0.5, '#2e4152'); gg.addColorStop(1, '#4f6678');
  g.fillStyle = gg; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 0, S * 0.45, S);
  g.fillStyle = '#8b9196'; g.fillRect(0, 0, 6, S); g.fillRect(S / 2 - 3, 0, 6, S); g.fillRect(0, S - 14, S, 14);
  for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(255,240,200,${Math.random() * 0.12})`; g.fillRect(10 + Math.random() * 200, 10 + Math.random() * 200, 40, 30); }
  // térreo com lojas (16 m = 4 lojas)
  const shop = document.createElement('canvas'); shop.width = 1024; shop.height = 256;
  g = shop.getContext('2d');
  g.fillStyle = '#d8d2c6'; g.fillRect(0, 0, 1024, 256); noise(g, 1024, 256, 3000, 0.08, 190, 70);
  const signs = ['#c0392b', '#1f6fb2', '#e8a317', '#2e8b57', '#6c3483', '#d35400', '#117a65', '#b03a2e'];
  for (let k = 0; k < 4; k++) {
    const x = k * 256;
    const c = signs[Math.floor(Math.random() * signs.length)];
    g.fillStyle = c; g.fillRect(x + 8, 14, 240, 42); // letreiro
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
    g.fillText(['MERCADO', 'FARMÁCIA', 'PADARIA', 'BAR', 'LOJA', 'ÓTICA', 'LANCHES', 'SALÃO', 'AÇOUGUE', 'BAZAR'][Math.floor(Math.random() * 10)], x + 128, 45);
    // toldo
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? c : '#f4f1ea'; g.fillRect(x + 8 + i * 20, 58, 20, 18); }
    // vitrine e porta
    g.fillStyle = '#2b2b2b'; g.fillRect(x + 14, 84, 228, 168);
    const vg = g.createLinearGradient(x, 84, x + 120, 252);
    vg.addColorStop(0, '#8aa0b0'); vg.addColorStop(1, '#1d262e');
    g.fillStyle = vg; g.fillRect(x + 20, 90, 140, 160); g.fillRect(x + 168, 90, 68, 160);
    g.fillStyle = 'rgba(255,230,170,.25)'; for (let i = 0; i < 6; i++) g.fillRect(x + 26 + Math.random() * 120, 150 + Math.random() * 80, 18, 14); // produtos
    if (Math.random() < 0.4) { g.fillStyle = '#555'; for (let i = 0; i < 228; i += 6) g.fillRect(x + 14 + i, 84, 3, 168); } // porta de enrolar
  }
  const T = (c) => canvasTex(c);
  return { plaster: T(plaster), brick: T(brick), glass: T(glass), shop: T(shop) };
}

function containerTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 8) {
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 3, 128);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 4, 0, 2, 128);
  }
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 256, 6); g.fillRect(0, 122, 256, 6);
  // ferrugem
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${90 + Math.random() * 40},${40 + Math.random() * 20},20,${Math.random() * 0.35})`;
    g.beginPath(); g.arc(Math.random() * 256, Math.random() * 128, Math.random() * 5, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function parseHeight(tags, rnd) {
  const h = parseFloat(tags.height);
  if (h > 0 && h < 500) return h;
  const lv = parseFloat(tags['building:levels']);
  if (lv > 0 && lv < 150) return lv * 3.1 + 1;
  const t = tags.building;
  if (['house', 'detached', 'semidetached_house', 'bungalow', 'hut', 'shed', 'garage', 'garages', 'roof', 'kiosk'].includes(t)) return 3.5 + rnd() * 3;
  if (['apartments', 'residential'].includes(t)) return t === 'apartments' ? 14 + rnd() * 18 : 5 + rnd() * 5;
  if (['commercial', 'office', 'hotel', 'hospital', 'university', 'school', 'public', 'civic'].includes(t)) return 9 + rnd() * 14;
  if (['industrial', 'warehouse', 'hangar', 'manufacture'].includes(t)) return 7 + rnd() * 5;
  if (['church', 'cathedral'].includes(t)) return 14 + rnd() * 10;
  return 5 + rnd() * 6;
}

// Overpass: tenta todos os servidores ao mesmo tempo e usa o primeiro que responder
async function overpass(query, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await Promise.any(OVERPASS_URLS.map(async (url) => {
      const r = await fetch(url + '?data=' + encodeURIComponent(query), { signal: ctrl.signal });
      if (!r.ok) throw new Error('Overpass ' + r.status);
      return r.json();
    }));
  } finally { clearTimeout(to); ctrl.abort(); }
}

function fetchT(url, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(to));
}

// Prédios do OpenStreetMap via tiles vetoriais do OpenFreeMap (rápido, CDN, sem chave)
let ofmTemplate = null;
async function openFreeMapBuildings(lat, lon, R) {
  if (!ofmTemplate) {
    const tj = await (await fetchT('https://tiles.openfreemap.org/planet', 12000)).json();
    ofmTemplate = tj.tiles[0];
  }
  const z = 14, n = 2 ** z;
  const dLat = R / 111320, dLon = R / (111320 * Math.cos((lat * Math.PI) / 180));
  const tx = (lo) => Math.floor(((lo + 180) / 360) * n);
  const ty = (la) => { const r = (la * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  const x0 = tx(lon - dLon), x1 = tx(lon + dLon), y0 = ty(lat + dLat), y1 = ty(lat - dLat);
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ x, y });
  const els = [];
  await Promise.all(jobs.map(async ({ x, y }) => {
    const r = await fetchT(ofmTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y), 20000);
    if (!r.ok) throw new Error('OFM ' + r.status);
    const vt = new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer())));
    const layer = vt.layers.building;
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const gj = f.toGeoJSON(x, y, z);
      const p = f.properties;
      const tags = { building: 'yes', height: p.render_height, min_height: p.render_min_height, colour: p.colour };
      const polys = gj.geometry.type === 'Polygon' ? [gj.geometry.coordinates] : gj.geometry.type === 'MultiPolygon' ? gj.geometry.coordinates : [];
      for (const poly of polys) {
        const ring = poly[0];
        if (!ring || ring.length < 4) continue;
        const c = ring[0];
        if (Math.abs(c[1] - lat) > dLat * 1.1 || Math.abs(c[0] - lon) > dLon * 1.1) continue;
        els.push({ type: 'way', tags, geometry: ring.map(([lo, la]) => ({ lat: la, lon: lo })) });
      }
    }
  }));
  return { elements: els };
}

// ---------- árvores: tronco com galhos + copa feita de "cartões" de folhas (técnica usada em jogos) ----------
let _treeKit = null;
function treeKit() {
  if (_treeKit) return _treeKit;
  const R = seededRandom(1234);
  // textura de folhas com transparência
  const n = 256, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d');
  for (let i = 0; i < 1100; i++) {
    const x = n / 2 + (R() - 0.5) * n * 0.95 * Math.sqrt(R()), y = n / 2 + (R() - 0.5) * n * 0.95 * Math.sqrt(R());
    if (Math.hypot(x - n / 2, y - n / 2) > n * 0.46) continue;
    const l = 7 + R() * 9, a = R() * 6.28, sh = 0.55 + R() * 0.45;
    g.fillStyle = `rgb(${Math.floor(60 * sh + 20)},${Math.floor(120 * sh + 25)},${Math.floor(40 * sh + 10)})`;
    g.save(); g.translate(x, y); g.rotate(a);
    g.beginPath(); g.ellipse(0, 0, l, l * 0.42, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(30,50,20,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-l, 0); g.lineTo(l, 0); g.stroke();
    g.restore();
  }
  const leafTex = new THREE.CanvasTexture(cv);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.anisotropy = 4;
  // casca
  const bc = document.createElement('canvas'); bc.width = 64; bc.height = 256;
  const bg = bc.getContext('2d');
  bg.fillStyle = '#5a4a3a'; bg.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 160; i++) { const v = 40 + R() * 60; bg.fillStyle = `rgba(${v},${v * 0.85},${v * 0.7},0.6)`; bg.fillRect(R() * 64, R() * 256, 1 + R() * 3, 6 + R() * 30); }
  const barkTex = new THREE.CanvasTexture(bc);
  barkTex.colorSpace = THREE.SRGBColorSpace;
  barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping;
  const leaf = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  const bark = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1, metalness: 0 });

  const variants = [];
  for (let v = 0; v < 3; v++) {
    const parts = [];
    const H = 2.6 + R() * 1.0;
    const t = new THREE.CylinderGeometry(0.13, 0.24, H + 0.6, 7, 4); t.translate(0, (H + 0.6) / 2, 0);
    parts.push(t);
    const cy = H + 1.8 + R() * 0.6, rx = 2.3 + R() * 0.8, ry = 1.8 + R() * 0.6;
    const heads = [];
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * 6.28 + R() * 0.8, len = 1.3 + R() * 0.8, el = 0.6 + R() * 0.5;
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      const br = new THREE.CylinderGeometry(0.04, 0.09, len, 5); br.translate(0, len / 2, 0);
      br.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      const y0 = H - 0.4 + R() * 0.6;
      br.translate(0, y0, 0);
      parts.push(br);
      heads.push(new THREE.Vector3(0, y0, 0).addScaledVector(dir, len));
    }
    const trunk = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    // copa
    const cards = [];
    const center = new THREE.Vector3(0, cy, 0);
    for (let i = 0; i < 72; i++) {
      const sz = 1.6 + R() * 1.1;
      const pl = new THREE.PlaneGeometry(sz, sz);
      pl.rotateX(R() * 6.28); pl.rotateY(R() * 6.28); pl.rotateZ(R() * 6.28);
      let pos;
      if (i < heads.length * 3) pos = heads[i % heads.length].clone().add(new THREE.Vector3((R() - 0.5) * 1.2, R() * 0.8, (R() - 0.5) * 1.2));
      else { const u = R() * 6.28, w = Math.acos(2 * R() - 1), rr = Math.cbrt(R()); pos = new THREE.Vector3(Math.sin(w) * Math.cos(u) * rx * rr, Math.cos(w) * ry * rr, Math.sin(w) * Math.sin(u) * rx * rr).add(center); }
      pl.translate(pos.x, pos.y, pos.z);
      // normais "esféricas": a copa é iluminada como um volume redondo
      const P = pl.attributes.position, N = pl.attributes.normal, tmp = new THREE.Vector3();
      for (let j = 0; j < P.count; j++) {
        tmp.set(P.getX(j), P.getY(j), P.getZ(j)).sub(center);
        tmp.x /= rx; tmp.y /= ry; tmp.z /= rx;
        tmp.normalize();
        N.setXYZ(j, tmp.x, tmp.y + 0.15, tmp.z);
      }
      cards.push(pl);
    }
    const leaves = mergeGeometries(cards);
    leaves.computeBoundingSphere();
    variants.push({ trunk, leaves });
  }
  _treeKit = { variants, leaf, bark };
  return _treeKit;
}

export class OsmWorld {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.polys = [];
    this.grid = new Map();
    this.solid = []; // meshes para raycast
    this.attribution = IMAGERY_ATTRIB;
    this.kind = 'osm';
    this.northAngle = 0; // ângulo (rad) do norte em relação a -Z
  }

  addPoly(pts, h, kind) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const idx = this.polys.length;
    this.polys.push({ pts, h, kind, minX, maxX, minZ, maxZ });
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const k = ix + ',' + iz;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(idx);
      }
  }

  near(x, z, r) {
    const out = new Set();
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++)
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const l = this.grid.get(ix + ',' + iz);
        if (l) for (const i of l) out.add(i);
      }
    return [...out].map((i) => this.polys[i]);
  }

  async load(lat, lon, progress) {
    this.lat = lat; this.lon = lon;
    const proj = makeProjection(lat, lon);
    this.proj = proj;
    this.env = addSkyAndLights(this.scene, this.renderer, this.quality);

    // 1) imagem de satélite do chão (alta resolução perto, baixa resolução longe)
    progress(0.02, 'Baixando imagens de satélite...');
    const n = this.quality === 'low' ? 6 : 8;
    const [near, far] = await Promise.all([
      buildImageryCanvas(lat, lon, 18, n, (f) => progress(0.02 + f * 0.4, 'Baixando imagens de satélite...')),
      buildImageryCanvas(lat, lon, 15, 6),
    ]);
    if (!near.ok) throw new Error('Não consegui baixar as imagens de satélite. Verifique sua internet.');
    this.imagery = near;
    this.group.add(imageryPlane(near, this.renderer, 0, -1));
    const farMesh = imageryPlane(far, this.renderer, -0.15, 0);
    farMesh.receiveShadow = false;
    this.group.add(farMesh);
    this.bounds = near.sizeM / 2 - 15;

    // 2) prédios e árvores do OpenStreetMap
    progress(0.45, 'Carregando prédios reais da região...');
    const R = Math.round(near.sizeM * 0.62);
    let data = { elements: [] };
    try {
      data = await openFreeMapBuildings(lat, lon, R);
    } catch (e) {
      console.warn('OpenFreeMap falhou, tentando Overpass', e);
      progress(0.5, 'Carregando prédios (servidor alternativo)...');
      const q = `[out:json][timeout:25];(way["building"](around:${R},${lat},${lon});relation["building"]["type"="multipolygon"](around:${R},${lat},${lon}););out geom qt;`;
      try { data = await overpass(q, 35000); } catch (e2) { console.warn('Overpass falhou', e2); this.buildingsFailed = true; }
    }
    progress(0.75, 'Construindo a cidade...');

    const rnd = seededRandom(Math.floor(Math.abs(lat * 1e5 + lon * 1e5)));
    const roofGeos = [];
    const walls = { plaster: [], brick: [], glass: [], shop: [] };
    const quad = (arr, ax, az, bx, bz, y0, y1, u0, u1, v0, v1, c) => {
      arr.push([[ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az], [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], c]);
    };
    let brickImg = null;
    try { brickImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = import.meta.env.BASE_URL + 'textures/brick.jpg'; }); } catch {}
    const fac = facadeSet(brickImg);
    const trees = [];
    const col = new THREE.Color();
    const palette = [0xe8e2d6, 0xd9cbb5, 0xcfd4d8, 0xe0c9a6, 0xbfb6a8, 0xf0ece4, 0xc9b8a0, 0xd6d0c4, 0xa9b4bf];

    const addBuilding = (ring, tags) => {
      if (ring.length < 4) return;
      const pts = ring.map((g) => { const p = proj.toLocal(g.lat, g.lon); return [p.x, p.z]; });
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      if (pts.length < 3) return;
      // garante o sentido do contorno para as placas das lojas não ficarem espelhadas
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
      if (area > 0) pts.reverse();
      const h = parseHeight(tags, rnd);
      const minH = Math.max(0, parseFloat(tags.min_height) || 0);
      if (minH > 0) return; // partes suspensas: ignoradas no protótipo
      this.addPoly(pts, h, 'building');
      col.setHex(palette[Math.floor(rnd() * palette.length)]);
      if (tags.colour && /^#[0-9a-f]{6}$/i.test(tags.colour)) col.lerp(new THREE.Color(tags.colour), 0.5);
      // paredes: térreo (lojas em parte dos prédios) + andares
      const tall = h > 24;
      const style = tall ? 'glass' : rnd() < 0.42 ? 'brick' : 'plaster';
      const commercial = /commercial|retail|shop|mixed/.test(tags.building || '') || (h > 5 && h < 40 && rnd() < 0.35);
      const gf = commercial && h > 4.5 ? 3.8 : 0;
      const wc = style === 'brick' ? new THREE.Color(1, 1, 1).multiplyScalar(0.85 + rnd() * 0.2) : style === 'glass' ? new THREE.Color(0.9 + rnd() * 0.1, 0.95, 1) : col;
      let u = 0;
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
        const len = Math.hypot(bx - ax, bz - az);
        if (gf) {
          const su0 = u / 16, su1 = (u + len) / 16;
          quad(walls.shop, ax, az, bx, bz, 0, gf, su0, su1, 0, 1, [1, 1, 1]);
        }
        const bw = style === 'glass' ? 3 : 4, bh = style === 'glass' ? 3.6 : 3.1;
        quad(walls[style], ax, az, bx, bz, gf, h, u / bw, (u + len) / bw, gf / bh, h / bh, [wc.r, wc.g, wc.b]);
        u += len;
      }
      // telhado
      try {
        const contour = pts.map(([x, z]) => new THREE.Vector2(x, -z));
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        const pos = [];
        for (const t of tris) for (const k of t) pos.push(pts[k][0], h, pts[k][1]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const rc = new THREE.Color(rnd() < 0.5 ? 0x8a8580 : 0x6d6a66).multiplyScalar(0.9 + rnd() * 0.25);
        if (['house', 'detached', 'residential'].includes(tags.building) && rnd() < 0.5) rc.setHex(0x9c5a3c);
        const cols = new Float32Array(pos.length);
        for (let i = 0; i < cols.length; i += 3) { cols[i] = rc.r; cols[i + 1] = rc.g; cols[i + 2] = rc.b; }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        roofGeos.push(g);
      } catch {}
    };

    for (const el of data.elements || []) {
      if (el.type === 'way' && el.geometry) addBuilding(el.geometry, el.tags || {});
      else if (el.type === 'relation' && el.members) {
        for (const m of el.members) if (m.role === 'outer' && m.geometry) addBuilding(m.geometry, el.tags || {});
      } else if (el.type === 'node' && el.tags && el.tags.natural === 'tree') {
        const p = proj.toLocal(el.lat, el.lon);
        trees.push(p);
      }
    }
    this.buildingCount = this.polys.length;

    const matProps = {
      plaster: { roughness: 0.9, metalness: 0 },
      brick: { roughness: 0.95, metalness: 0 },
      glass: { roughness: 0.12, metalness: 0.75, envMapIntensity: 1.4 },
      shop: { roughness: 0.6, metalness: 0.1 },
    };
    for (const k of Object.keys(walls)) {
      const list = walls[k];
      if (!list.length) continue;
      const pos = [], uv = [], cl = [];
      for (const [p6, u6, c] of list) { pos.push(...p6); uv.push(...u6); for (let i = 0; i < 6; i++) cl.push(c[0], c[1], c[2]); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      g.computeVertexNormals();
      g.computeBoundsTree();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: fac[k], vertexColors: true, side: THREE.DoubleSide, ...matProps[k] }));
      m.castShadow = m.receiveShadow = true;
      this.group.add(m); this.solid.push(m);
    }
    if (roofGeos.length) {
      const g = mergeGeometries(roofGeos);
      g.computeVertexNormals();
      g.computeBoundsTree();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
      m.castShadow = m.receiveShadow = true;
      this.group.add(m); this.solid.push(m);
    }

    // 3) árvores (chegam depois, sem travar o carregamento)
    this.buildTrees(trees, rnd);
    if (!trees.length) {
      overpass(`[out:json][timeout:20];node["natural"="tree"](around:${R},${lat},${lon});out qt;`, 40000)
        .then((d) => {
          const t = (d.elements || []).map((e) => proj.toLocal(e.lat, e.lon));
          if (t.length) this.buildTrees(t, seededRandom(7));
        })
        .catch(() => {});
    }
    // 4) cobertura: contêineres e barreiras perto do ponto de nascimento
    this.buildCover(rnd);
    progress(0.95, 'Posicionando tropas...');
    this.spawn = this.findFree(0, 0, 0.8);
  }

  buildTrees(trees, rnd) {
    const list = trees.filter((t) => Math.abs(t.x) < this.bounds && Math.abs(t.z) < this.bounds).slice(0, 1500);
    if (!list.length) return;
    const kit = treeKit();
    const per = kit.variants.map(() => []);
    list.forEach((t, i) => per[i % per.length].push(t));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    kit.variants.forEach((v, vi) => {
      const pts = per[vi];
      if (!pts.length) return;
      const trunk = new THREE.InstancedMesh(v.trunk, kit.bark, pts.length);
      const crown = new THREE.InstancedMesh(v.leaves, kit.leaf, pts.length);
      pts.forEach((t, i) => {
        const k = 0.75 + rnd() * 0.6;
        q.setFromAxisAngle(up, rnd() * 6.28);
        m.compose(p.set(t.x, 0, t.z), q, sc.set(k, k * (0.9 + rnd() * 0.25), k));
        trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m);
        crown.setColorAt(i, c.setHSL(0.2 + rnd() * 0.1, 0.3 + rnd() * 0.25, 0.5 + rnd() * 0.2));
        const r = 0.35;
        this.addPoly([[t.x - r, t.z - r], [t.x + r, t.z - r], [t.x + r, t.z + r], [t.x - r, t.z + r]], 8, 'tree');
      });
      trunk.castShadow = crown.castShadow = true;
      crown.receiveShadow = true;
      this.group.add(trunk, crown);
    });
  }

  buildCover(rnd) {
    const tex = containerTexture();
    const colors = [0x8e3b26, 0x9a4a2c, 0x2f5d8a, 0x3f6e3a, 0xc46a1c, 0x6b6f73, 0x7a2e22];
    const geos = [];
    const box = (w, h, d, x, y, z, rot, color) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const c = new THREE.Color(color);
      const cols = [];
      for (let i = 0; i < g.attributes.position.count; i++) cols.push(c.r, c.g, c.b);
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      g.rotateY(rot); g.translate(x, y, z);
      geos.push(g);
    };
    const footprint = (x, z, w, d, rot) => {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => [x + a * cs + b * sn, z - a * sn + b * cs]);
    };
    const clusters = this.quality === 'low' ? 7 : 11;
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < clusters; tries++) {
      const ang = rnd() * Math.PI * 2, dist = 12 + rnd() * 90;
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
      if (!this.isFree(cx, cz, 9)) continue;
      placed++;
      const rot = rnd() * Math.PI;
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const long = rnd() < 0.4;
        const w = 2.44, d = long ? 12.19 : 6.06, h = 2.59;
        const off = (i - (n - 1) / 2) * 2.7;
        const x = cx + Math.cos(rot) * off, z = cz - Math.sin(rot) * off;
        const stack = rnd() < 0.35 ? 2 : 1;
        for (let s = 0; s < stack; s++) box(w, h, d, x, h / 2 + s * h, z, rot, colors[Math.floor(rnd() * colors.length)]);
        this.addPoly(footprint(x, z, w, d, rot), h * stack, 'cover');
      }
      // barreiras de concreto
      for (let i = 0; i < 3; i++) {
        const a = rnd() * 6.28, r = 7 + rnd() * 3;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (!this.isFree(x, z, 1.5)) continue;
        const br = rnd() * Math.PI;
        box(0.6, 1.1, 3, x, 0.55, z, br, 0x9a9a92);
        this.addPoly(footprint(x, z, 0.6, 3, br), 1.1, 'cover');
      }
    }
    if (!geos.length) return;
    const g = mergeGeometries(geos);
    g.computeBoundsTree();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.7, metalness: 0.3 }));
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh); this.solid.push(mesh);
  }

  isFree(x, z, r) {
    if (Math.abs(x) > this.bounds || Math.abs(z) > this.bounds) return false;
    for (const p of this.near(x, z, r)) {
      if (x + r < p.minX || x - r > p.maxX || z + r < p.minZ || z - r > p.maxZ) continue;
      if (pointInPoly(x, z, p.pts)) return false;
      for (let i = 0; i < p.pts.length; i++) {
        const a = p.pts[i], b = p.pts[(i + 1) % p.pts.length];
        const [qx, qz] = closestOnSeg(x, z, a[0], a[1], b[0], b[1]);
        if (Math.hypot(qx - x, qz - z) < r) return false;
      }
    }
    return true;
  }

  findFree(x, z, r) {
    if (this.isFree(x, z, r)) return new THREE.Vector3(x, 0, z);
    for (let d = 2; d < 200; d += 2)
      for (let a = 0; a < 16; a++) {
        const xx = x + Math.cos((a / 16) * 6.283) * d, zz = z + Math.sin((a / 16) * 6.283) * d;
        if (this.isFree(xx, zz, r)) return new THREE.Vector3(xx, 0, zz);
      }
    return new THREE.Vector3(x, 0, z);
  }

  randomPoint(near, minR, maxR) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, d = minR + Math.random() * (maxR - minR);
      const x = near.x + Math.cos(a) * d, z = near.z + Math.sin(a) * d;
      if (this.isFree(x, z, 0.8)) return new THREE.Vector3(x, 0, z);
    }
    return this.findFree(near.x + minR, near.z, 0.8);
  }

  groundY(x, z, feetY) {
    let g = 0;
    for (const p of this.near(x, z, 0.5)) {
      if (p.h <= feetY + 0.45 && p.h > g && x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && pointInPoly(x, z, p.pts)) g = p.h;
    }
    return g;
  }

  // Empurra a posição (pés) para fora dos obstáculos
  collide(pos, r) {
    for (let it = 0; it < 2; it++) {
      for (const p of this.near(pos.x, pos.z, r + 1)) {
        if (pos.y >= p.h - 0.45) continue;
        if (pos.x + r < p.minX || pos.x - r > p.maxX || pos.z + r < p.minZ || pos.z - r > p.maxZ) continue;
        let best = Infinity, bx = 0, bz = 0;
        for (let i = 0; i < p.pts.length; i++) {
          const a = p.pts[i], b = p.pts[(i + 1) % p.pts.length];
          const [qx, qz] = closestOnSeg(pos.x, pos.z, a[0], a[1], b[0], b[1]);
          const d = Math.hypot(qx - pos.x, qz - pos.z);
          if (d < best) { best = d; bx = qx; bz = qz; }
        }
        const inside = pointInPoly(pos.x, pos.z, p.pts);
        if (inside) {
          const dx = bx - pos.x, dz = bz - pos.z, l = Math.hypot(dx, dz) || 1;
          pos.x = bx + (dx / l) * r; pos.z = bz + (dz / l) * r;
        } else if (best < r) {
          const dx = pos.x - bx, dz = pos.z - bz, l = best || 1;
          pos.x = bx + (dx / l) * r; pos.z = bz + (dz / l) * r;
        }
      }
    }
    const b = this.bounds;
    pos.x = Math.max(-b, Math.min(b, pos.x));
    pos.z = Math.max(-b, Math.min(b, pos.z));
  }

  raycast(raycaster) {
    raycaster.firstHitOnly = true;
    const hits = raycaster.intersectObjects(this.solid, false);
    let best = hits[0] || null;
    // chão (plano y=0)
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    if (d.y < -1e-4) {
      const t = -o.y / d.y;
      if (t > 0 && t < raycaster.far && (!best || t < best.distance)) best = { distance: t, point: o.clone().addScaledVector(d, t), ground: true };
    }
    return best;
  }

  update() {}
  updateShadow(target) {
    if (!this.env) return;
    const d = this.env.dir;
    d.target.position.copy(target);
    d.position.copy(target).addScaledVector(this.env.sunDir, 250);
  }
}
