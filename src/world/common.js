import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { IMAGERY_URL } from '../config.js';

export const R_EARTH = 6378137;

export function lonLatToPixel(lon, lat, z) {
  const s = 256 * 2 ** z;
  const x = ((lon + 180) / 360) * s;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return { x, y };
}
export const metersPerPixel = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

// Converte lat/lon para coordenadas locais em metros (x = leste, z = sul), origem no ponto escolhido.
export function makeProjection(lat0, lon0) {
  const kx = (Math.PI / 180) * R_EARTH * Math.cos((lat0 * Math.PI) / 180);
  const kz = (Math.PI / 180) * R_EARTH;
  return {
    toLocal: (lat, lon) => ({ x: (lon - lon0) * kx, z: -(lat - lat0) * kz }),
    toLatLon: (x, z) => ({ lat: lat0 - z / kz, lon: lon0 + x / kx }),
  };
}

async function loadTile(z, x, y) {
  const url = IMAGERY_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  const r = await fetch(url, { mode: 'cors', signal: ctrl.signal }).finally(() => clearTimeout(to));
  if (!r.ok) throw new Error('tile ' + r.status);
  return createImageBitmap(await r.blob());
}

/**
 * Monta uma imagem de satélite (mosaico de tiles) centrada em lat/lon.
 * Retorna canvas + informações para posicionar no mundo local.
 */
export async function buildImageryCanvas(lat, lon, z, n, onTile) {
  const p = lonLatToPixel(lon, lat, z);
  const ctx0 = Math.floor(p.x / 256) - Math.floor(n / 2);
  const cty0 = Math.floor(p.y / 256) - Math.floor(n / 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n * 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#5b6150';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let done = 0, ok = 0;
  const jobs = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      jobs.push(
        loadTile(z, ctx0 + i, cty0 + j)
          .then((img) => { ctx.drawImage(img, i * 256, j * 256); ok++; })
          .catch(() => {})
          .finally(() => { done++; onTile && onTile(done / (n * n)); })
      );
    }
  }
  await Promise.all(jobs);
  const mpp = metersPerPixel(lat, z);
  // pixel do ponto de origem dentro do canvas
  const ox = p.x - ctx0 * 256;
  const oy = p.y - cty0 * 256;
  return {
    canvas, mpp, ox, oy, ok,
    sizeM: n * 256 * mpp,
    // centro do canvas em coordenadas locais
    centerX: (n * 128 - ox) * mpp,
    centerZ: (n * 128 - oy) * mpp,
    // local (x,z) -> pixel do canvas
    toPx: (x, zz) => ({ x: ox + x / mpp, y: oy + zz / mpp }),
  };
}

export function imageryPlane(img, renderer, y = 0, order = 0) {
  const tex = new THREE.CanvasTexture(img.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const geo = new THREE.PlaneGeometry(img.sizeM, img.sizeM);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: order, polygonOffsetUnits: order });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(img.centerX, y, img.centerZ);
  mesh.receiveShadow = true;
  return mesh;
}

export function addSkyAndLights(scene, renderer, quality) {
  const sky = new Sky();
  sky.scale.setScalar(45000);
  const u = sky.material.uniforms;
  u.turbidity.value = 8;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.85;
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(140));
  u.sunPosition.value.copy(sun);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xdfe8f5, 0x5a5a48, 1.4);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff1dc, 2.6);
  dir.position.copy(sun).multiplyScalar(200);
  if (quality !== 'low') {
    dir.castShadow = true;
    const s = quality === 'high' ? 4096 : 2048;
    dir.shadow.mapSize.set(s, s);
    const c = dir.shadow.camera;
    c.left = c.bottom = -90; c.right = c.top = 90; c.near = 1; c.far = 600;
    dir.shadow.bias = -0.0005;
    dir.shadow.normalBias = 0.04;
  }
  scene.add(dir);
  scene.add(dir.target);
  scene.fog = new THREE.Fog(0xc9d3dc, 120, quality === 'low' ? 600 : 1100);
  return { sky, hemi, dir, sunDir: sun.clone() };
}

// Ponto dentro de polígono (array de [x,z])
export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return [ax + t * dx, az + t * dz];
}

export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
