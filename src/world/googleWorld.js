import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { GLTFExtensionsPlugin, ReorientationPlugin, TileCompressionPlugin, UnloadTilesPlugin, TilesFadePlugin } from '3d-tiles-renderer/three/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { buildImageryCanvas, addSkyAndLights } from './common.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const DOWN = new THREE.Vector3(0, -1, 0);

// Cenário com Google Photorealistic 3D Tiles (precisa de chave da Map Tiles API).
export class GoogleWorld {
  constructor(scene, renderer, quality, apiKey) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.apiKey = apiKey;
    this.kind = 'google';
    this.ray = new THREE.Raycaster();
    this.bounds = 600;
    this.northAngle = 0;
    this.attribution = 'Google';
  }

  async load(lat, lon, progress, camera) {
    this.lat = lat; this.lon = lon;
    this.env = addSkyAndLights(this.scene, this.renderer, 'low');
    this.scene.fog = new THREE.Fog(0xc9d3dc, 300, 2500);

    progress(0.03, 'Conectando ao Google 3D...');
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: this.apiKey, autoRefreshToken: true }));
    const draco = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + 'draco/');
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UnloadTilesPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(new ReorientationPlugin({ lat: lat * THREE.MathUtils.DEG2RAD, lon: lon * THREE.MathUtils.DEG2RAD, height: 0, recenter: true }));
    tiles.errorTarget = this.quality === 'high' ? 6 : this.quality === 'low' ? 20 : 12;
    let failed = null;
    tiles.addEventListener('load-error', (e) => { failed = e.error || new Error('erro ao carregar tiles'); });
    tiles.addEventListener('load-model', ({ scene }) => {
      scene.traverse((c) => { if (c.isMesh) { c.geometry.computeBoundsTree(); c.receiveShadow = false; } });
    });
    tiles.addEventListener('dispose-model', ({ scene }) => {
      scene.traverse((c) => { if (c.isMesh && c.geometry.boundsTree) c.geometry.disposeBoundsTree(); });
    });
    this.tiles = tiles;
    this.scene.add(tiles.group);
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, this.renderer);
    this.camera = camera;

    // minimapa usa imagem de satélite
    const imgP = buildImageryCanvas(lat, lon, 17, 6).catch(() => null);

    // 1) visão de cima para achar o chão
    camera.position.set(0, 600, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const t0 = performance.now();
    let ground = null;
    while (performance.now() - t0 < 40000) {
      await this.tick();
      if (failed && !tiles.root) {
        const m = String(failed.message || failed);
        throw new Error(/404|403|not found|denied/i.test(m)
          ? 'O Google recusou a chave (faturamento do Google Cloud ainda não ativo ou Map Tiles API desligada).'
          : 'Falha ao conectar no Google 3D: ' + m);
      }
      const f = Math.min(1, (performance.now() - t0) / 15000);
      progress(0.05 + f * 0.45, 'Baixando a cidade em 3D...');
      ground = this.castDown(0, 0, 3000);
      if (ground != null && performance.now() - t0 > 2500) break;
    }
    if (ground == null) throw new Error('O Google 3D não tem dados para este local. Tente o modo Satélite.');

    // 2) desce a câmera até o chão para carregar o nível de detalhe máximo
    camera.position.set(0, ground + 40, 0);
    camera.lookAt(30, ground + 2, 0);
    camera.updateMatrixWorld();
    const t1 = performance.now();
    while (performance.now() - t1 < 9000) {
      await this.tick();
      progress(0.5 + ((performance.now() - t1) / 9000) * 0.4, 'Carregando detalhes das ruas...');
      if (tiles.stats && tiles.stats.queued === 0 && tiles.stats.downloading === 0 && tiles.stats.parsing === 0 && performance.now() - t1 > 2500) break;
    }
    ground = this.castDown(0, 0, ground + 200) ?? ground;
    this.spawn = new THREE.Vector3(0, ground, 0);

    // direção do norte no espaço local
    try {
      const v = new THREE.Vector3();
      tiles.ellipsoid.getCartographicToPosition((lat + 0.001) * THREE.MathUtils.DEG2RAD, lon * THREE.MathUtils.DEG2RAD, 0, v);
      v.applyMatrix4(tiles.group.matrixWorld);
      this.northAngle = Math.atan2(v.x, -v.z); // 0 se o norte for -Z
    } catch {}

    this.imagery = await imgP;
    progress(0.95, 'Posicionando tropas...');
  }

  tick() {
    // rAF não roda com a aba em segundo plano; o setTimeout garante que o carregamento continue
    return new Promise((res) => {
      let done = false;
      const step = () => {
        if (done) return;
        done = true;
        this.camera.updateMatrixWorld();
        this.tiles.update();
        this.renderer.render(this.scene, this.camera);
        res();
      };
      requestAnimationFrame(step);
      setTimeout(step, 100);
    });
  }

  castDown(x, z, fromY) {
    this.ray.set(new THREE.Vector3(x, fromY, z), DOWN);
    this.ray.far = fromY + 2000;
    this.ray.firstHitOnly = true;
    const h = this.ray.intersectObject(this.tiles.group, true)[0];
    return h ? h.point.y : null;
  }

  groundY(x, z, feetY) {
    const g = this.castDown(x, z, feetY + 0.6);
    return g == null ? (this._lastG ?? feetY) : (this._lastG = g);
  }

  collide(pos, r) {
    const o = new THREE.Vector3();
    for (const hgt of [0.55, 1.3]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        o.set(pos.x, pos.y + hgt, pos.z);
        this.ray.set(o, d); this.ray.far = r; this.ray.firstHitOnly = true;
        const h = this.ray.intersectObject(this.tiles.group, true)[0];
        if (h) pos.addScaledVector(d, -(r - h.distance));
      }
    }
    const b = this.bounds;
    pos.x = Math.max(-b, Math.min(b, pos.x));
    pos.z = Math.max(-b, Math.min(b, pos.z));
  }

  isFree(x, z, r) {
    const g = this.castDown(x, z, 400);
    return g != null && Math.abs(g - this.spawn.y) < 6;
  }

  randomPoint(near, minR, maxR) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, d = minR + Math.random() * (maxR - minR);
      const x = near.x + Math.cos(a) * d, z = near.z + Math.sin(a) * d;
      const g = this.castDown(x, z, (near.y || 0) + 60);
      if (g != null && Math.abs(g - this.spawn.y) < 8) return new THREE.Vector3(x, g, z);
    }
    return this.spawn.clone();
  }

  raycast(raycaster) {
    raycaster.firstHitOnly = true;
    return raycaster.intersectObject(this.tiles.group, true)[0] || null;
  }

  update(camera) {
    camera.updateMatrixWorld();
    this.tiles.update();
    if (!this._attrT || performance.now() - this._attrT > 3000) {
      this._attrT = performance.now();
      try {
        const a = this.tiles.getAttributions().map((x) => x.value).filter((v) => typeof v === 'string');
        this.attribution = 'Google · ' + [...new Set(a)].join(' · ').slice(0, 200);
      } catch {}
    }
  }
  updateShadow() {}
}
