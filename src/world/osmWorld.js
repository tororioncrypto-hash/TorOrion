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

function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d4cb'; g.fillRect(0, 0, 128, 128);
  // sujeira/ruído
  for (let i = 0; i < 900; i++) {
    const v = 180 + Math.random() * 60;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  // laje
  g.fillStyle = '#b9b3a8'; g.fillRect(0, 118, 128, 10);
  // janela
  g.fillStyle = '#5a5f66'; g.fillRect(30, 28, 68, 62);
  const grad = g.createLinearGradient(0, 30, 0, 88);
  grad.addColorStop(0, '#9fb6c9'); grad.addColorStop(1, '#2c3e50');
  g.fillStyle = grad; g.fillRect(34, 32, 60, 54);
  g.fillStyle = '#5a5f66'; g.fillRect(62, 32, 4, 54);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(36, 34, 20, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
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

// Prédios do OpenStreetMap via tiles vetoriais do OpenFreeMap (rápido, CDN, sem chave)
let ofmTemplate = null;
async function openFreeMapBuildings(lat, lon, R) {
  if (!ofmTemplate) {
    const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
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
    const r = await fetch(ofmTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y));
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
    const wallPos = [], wallUv = [], wallCol = [], roofGeos = [];
    const trees = [];
    const col = new THREE.Color();
    const palette = [0xe8e2d6, 0xd9cbb5, 0xcfd4d8, 0xe0c9a6, 0xbfb6a8, 0xf0ece4, 0xc9b8a0, 0xd6d0c4, 0xa9b4bf];

    const addBuilding = (ring, tags) => {
      if (ring.length < 4) return;
      const pts = ring.map((g) => { const p = proj.toLocal(g.lat, g.lon); return [p.x, p.z]; });
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      if (pts.length < 3) return;
      const h = parseHeight(tags, rnd);
      const minH = Math.max(0, parseFloat(tags.min_height) || 0);
      if (minH > 0) return; // partes suspensas: ignoradas no protótipo
      this.addPoly(pts, h, 'building');
      col.setHex(palette[Math.floor(rnd() * palette.length)]);
      if (tags.colour && /^#[0-9a-f]{6}$/i.test(tags.colour)) col.lerp(new THREE.Color(tags.colour), 0.5);
      // paredes
      let u = 0;
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
        const len = Math.hypot(bx - ax, bz - az);
        const u0 = u / 4, u1 = (u + len) / 4, v1 = h / 3.1;
        u += len;
        wallPos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, 0, az, bx, h, bz, ax, h, az);
        wallUv.push(u0, 0, u1, 0, u1, v1, u0, 0, u1, v1, u0, v1);
        for (let k = 0; k < 6; k++) wallCol.push(col.r, col.g, col.b);
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

    if (wallPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3));
      g.computeVertexNormals();
      g.computeBoundsTree();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: facadeTexture(), vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
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
    const trunkG = new THREE.CylinderGeometry(0.15, 0.25, 3, 6); trunkG.translate(0, 1.5, 0);
    const crownG = new THREE.IcosahedronGeometry(2.2, 1); crownG.translate(0, 4.4, 0);
    const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1 }), list.length);
    const crown = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.95, flatShading: true }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    list.forEach((t, i) => {
      const k = 0.8 + rnd() * 0.6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m.compose(p.set(t.x, 0, t.z), q, s.set(k, k, k));
      trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m);
      crown.setColorAt(i, c.setHSL(0.25 + rnd() * 0.08, 0.4, 0.25 + rnd() * 0.12));
      const r = 0.35;
      this.addPoly([[t.x - r, t.z - r], [t.x + r, t.z - r], [t.x + r, t.z + r], [t.x - r, t.z + r]], 8, 'tree');
    });
    trunk.castShadow = crown.castShadow = true;
    this.group.add(trunk, crown);
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
