import * as THREE from 'three';
import { WEAPONS, buildWeaponModel } from './weapons.js';
import { loadSoldierModel, makeSoldier, blendSoldier } from './soldier.js';
import { createPipeline } from './render.js';
import { sfx, initAudio } from './audio.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OsmWorld } from './world/osmWorld.js';
import { GoogleWorld } from './world/googleWorld.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const ENEMY_NAMES = ['Lobo Cinzento', 'Sombra 7', 'Corvo', 'Víbora', 'Falcão Negro', 'Trovoada', 'Escorpião', 'Fantasma', 'Martelo', 'Cobra Real', 'Nômade', 'Ferrugem'];

const MISSIONS = [
  { text: 'Elimine 5 inimigos', type: 'kill', n: 5, xp: 300 },
  { text: 'Faça 3 abates na cabeça', type: 'head', n: 3, xp: 400 },
  { text: 'Elimine 3 inimigos a mais de 40 m', type: 'long', n: 3, xp: 450 },
  { text: 'Elimine 2 inimigos com granada', type: 'grenade', n: 2, xp: 500 },
  { text: 'Elimine 10 inimigos sem morrer', type: 'streak', n: 10, xp: 800 },
];

export class Game {
  constructor({ renderer, canvas, profile, settings, mode, lat, lon, label, googleKey, onExit }) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.profile = profile;
    this.settings = settings;
    this.mode = mode;
    this.lat = lat; this.lon = lon; this.label = label;
    this.googleKey = googleKey;
    this.onExit = onExit;
    this.touch = document.body.classList.contains('touch');

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, mode === 'google' ? 20000 : 8000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.weaponScene = new THREE.Scene();
    this.weaponCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 10);
    this.weaponScene.add(new THREE.HemisphereLight(0xffffff, 0x444433, 1.6));
    const wl = new THREE.DirectionalLight(0xfff1dc, 2.2); wl.position.set(1, 2, 1); this.weaponScene.add(wl);
    const pm = new THREE.PMREMGenerator(renderer);
    this.weaponScene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.weaponScene.environmentIntensity = 0.6;
    pm.dispose();

    this.raycaster = new THREE.Raycaster();
    this.keys = {};
    this.bots = [];
    this.effects = [];
    this.grenades = [];
    this.time = 0;
    this.paused = false;
    this.running = false;
  }

  async init(progress) {
    const q = this.settings.quality;
    if (this.mode === 'google') {
      this.world = new GoogleWorld(this.scene, this.renderer, q, this.googleKey);
      await this.world.load(this.lat, this.lon, progress, this.camera);
    } else {
      this.world = new OsmWorld(this.scene, this.renderer, q);
      await this.world.load(this.lat, this.lon, progress);
    }
    progress(0.96, 'Equipando soldados...');
    await loadSoldierModel();
    this.setupPlayer();
    this.setupWeapons();
    this.pipeline = createPipeline(this.renderer, this.scene, this.camera, this.weaponScene, this.weaponCam, q);
    this.setupEffects();
    this.mission = { i: 0, count: 0 };
    this.streak = 0;
    this.sessionKills = 0;
    this.maxBots = q === 'low' ? 4 : q === 'high' ? 8 : 6;
    for (let i = 0; i < this.maxBots; i++) this.spawnBot(true);
    progress(1, 'Pronto!');
  }

  // ---------- JOGADOR ----------
  setupPlayer() {
    const s = this.world.spawn.clone();
    this.spawnPoint = s;
    this.player = { pos: s.clone(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, crouch: false, hp: 100, lastHurt: -99, dead: false, med: 2, gren: 2, eye: 1.65 };
    this.recoil = { pitch: 0, yaw: 0 };
    this.bob = 0;
  }

  setupWeapons() {
    this.guns = WEAPONS.map((def) => {
      const m = buildWeaponModel(def);
      m.group.visible = false;
      this.weaponScene.add(m.group);
      return { def, model: m, ammo: def.mag, reserve: def.reserve };
    });
    this.gunIndex = 0;
    this.guns[0].model.group.visible = true;
    this.ads = 0; this.adsHeld = false;
    this.nextShot = 0; this.reloading = 0; this.trigger = false; this.triggerUsed = false;
    this.kick = 0; this.swayX = 0; this.swayY = 0; this.switchT = 0;
    // clarão do cano
    const flashTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,220,1)'); r.addColorStop(0.3, 'rgba(255,190,60,.9)'); r.addColorStop(1, 'rgba(255,120,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.flashTex = flashTex;
    this.muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.muzzleFlash.scale.set(0.18, 0.18, 1);
    this.muzzleFlash.visible = false;
    this.weaponScene.add(this.muzzleFlash);
    this.muzzleLight = new THREE.PointLight(0xffb040, 0, 12, 2);
    this.scene.add(this.muzzleLight);
  }

  get gun() { return this.guns[this.gunIndex]; }

  // ---------- EFEITOS ----------
  setupEffects() {
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
    this.enemyTracerMat = new THREE.LineBasicMaterial({ color: 0xff6040, transparent: true, opacity: 0.8 });
    this.sparkTex = this.flashTex;
    this.dustMat = new THREE.SpriteMaterial({ color: 0xb8ad98, transparent: true, opacity: 0.7, depthWrite: false });
    this.bloodMat = new THREE.SpriteMaterial({ color: 0x8a0a0a, transparent: true, opacity: 0.85, depthWrite: false });
    this.sparkMat = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.decalGeo = new THREE.CircleGeometry(0.06, 8);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
    this.decals = [];
  }

  tracer(from, to, mat) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const l = new THREE.Line(g, mat.clone());
    this.scene.add(l);
    this.effects.push({ obj: l, life: 0.06, max: 0.06, fade: true });
  }

  puff(point, mat, n, size, speed, life) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.position.copy(point);
      s.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      this.scene.add(s);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(speed);
      this.effects.push({ obj: s, vel: v, life, max: life, fade: true, grow: 1.5 });
    }
  }

  decal(hit) {
    if (!hit.face && !hit.ground) return;
    const n = hit.ground ? new THREE.Vector3(0, 1, 0) : hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const d = new THREE.Mesh(this.decalGeo, this.decalMat);
    d.position.copy(hit.point).addScaledVector(n, 0.02);
    d.lookAt(d.position.clone().add(n));
    this.scene.add(d);
    this.decals.push(d);
    if (this.decals.length > 60) this.scene.remove(this.decals.shift());
  }

  // ---------- INIMIGOS ----------
  spawnBot(initial) {
    const p = this.player.pos;
    const pos = this.world.randomPoint(p, initial ? 35 : 45, initial ? 110 : 120);
    if (this.world.kind === 'osm') pos.y = this.world.groundY(pos.x, pos.z, 0);
    const sold = makeSoldier(Math.floor(Math.random() * 3));
    const g = sold.root;
    g.position.copy(pos);
    this.scene.add(g);
    const bot = {
      sold, hit: sold.hitboxes,
      group: g, pos: g.position, hp: 100, dead: false, deadT: 0, yaw: Math.random() * 6.28,
      name: ENEMY_NAMES[Math.floor(Math.random() * ENEMY_NAMES.length)],
      target: null, state: 'patrol', seeT: 0, losT: Math.random() * 0.4, hasLos: false,
      burst: 0, nextShot: 0, pause: 1 + Math.random(), walk: 0, stuckT: 0, lastPos: pos.clone(), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0,
      accuracy: 0.85 + Math.random() * 0.3,
    };
    sold.hitboxes.forEach((h) => { h.userData.bot = bot; });
    this.bots.push(bot);
  }

  hasLineOfSight(from, to) {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    this.raycaster.set(from, dir);
    this.raycaster.far = dist;
    const h = this.world.raycast(this.raycaster);
    return !h || h.distance > dist - 0.6;
  }

  updateBots(dt) {
    const P = this.player;
    const eye = P.pos.clone(); eye.y += P.eye;
    for (const b of this.bots) {
      if (b.dead) {
        b.deadT += dt;
        const k = Math.min(1, b.deadT / 0.45);
        b.group.rotation.x = -k * Math.PI / 2 * 0.95;
        b.group.position.y = b.baseY - k * 0.1;
        if (b.deadT < 0.5) b.sold.mixer.update(dt * 0.3);
        if (b.deadT > 5) { this.scene.remove(b.group); b.remove = true; }
        continue;
      }
      const toP = P.pos.clone().sub(b.pos); toP.y = 0;
      const dist = toP.length();
      // linha de visão (a cada 0.35s)
      b.losT -= dt;
      if (b.losT <= 0) {
        b.losT = 0.35;
        const head = b.pos.clone(); head.y += 1.7;
        b.hasLos = !P.dead && dist < 110 && this.hasLineOfSight(head, eye);
      }
      if (b.hasLos) { b.seeT += dt; b.state = 'engage'; b.lastSeen = P.pos.clone(); } else b.seeT = Math.max(0, b.seeT - dt);

      let move = new THREE.Vector3();
      let speed = 0;
      if (b.state === 'engage') {
        const want = Math.atan2(-toP.x, -toP.z);
        b.yaw = lerpAngle(b.yaw, want, Math.min(1, dt * 6));
        if (b.hasLos) {
          b.strafeT -= dt;
          if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = 1 + Math.random() * 2; }
          const fwd = toP.clone().normalize();
          const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(b.strafe);
          move.copy(side).multiplyScalar(0.6);
          if (dist > 30) move.add(fwd);
          if (dist < 10) move.addScaledVector(fwd, -0.6);
          speed = dist > 30 ? 3.4 : 1.8;
          // tiro
          if (b.seeT > 0.6) this.botShoot(b, dist, dt);
        } else if (b.lastSeen) {
          move.copy(b.lastSeen).sub(b.pos); move.y = 0;
          if (move.length() < 2) { b.lastSeen = null; b.state = 'patrol'; }
          speed = 3.8;
        } else b.state = 'patrol';
      } else {
        if (!b.target || b.target.distanceTo(b.pos) < 2) {
          // patrulha em direção à área do jogador
          b.target = this.world.randomPoint(dist > 60 ? P.pos : b.pos, 10, 40);
        }
        move.copy(b.target).sub(b.pos); move.y = 0;
        speed = 2.2;
        if (move.lengthSq() > 0.01) b.yaw = lerpAngle(b.yaw, Math.atan2(-move.x, -move.z), Math.min(1, dt * 4));
      }
      if (move.lengthSq() > 0.001) {
        move.normalize().multiplyScalar(speed * dt);
        b.pos.add(move);
        this.world.collide(b.pos, 0.4);
        b.walk += dt * speed * 2.2;
      }
      b.pos.y = this.world.groundY(b.pos.x, b.pos.z, b.pos.y);
      b.baseY = b.pos.y;
      // preso?
      b.stuckT += dt;
      if (b.stuckT > 1.2) {
        if (b.pos.distanceTo(b.lastPos) < 0.3 && speed > 0) b.target = this.world.randomPoint(b.pos, 5, 25);
        b.lastPos.copy(b.pos); b.stuckT = 0;
      }
      b.group.rotation.y = b.yaw;
      blendSoldier(b.sold, move.lengthSq() > 0.000001 ? speed : 0, dt);
    }
    const before = this.bots.length;
    this.bots = this.bots.filter((b) => !b.remove);
    for (let i = this.bots.filter((b) => !b.dead).length; i < this.maxBots; i++) {
      if (!this.pendingSpawn) {
        this.pendingSpawn = true;
        setTimeout(() => { this.pendingSpawn = false; if (this.running) this.spawnBot(false); }, 2500 + Math.random() * 2500);
      }
      break;
    }
    return before;
  }

  botShoot(b, dist, dt) {
    if (this.time < b.nextShot) return;
    if (b.burst <= 0) { b.burst = 3 + Math.floor(Math.random() * 4); b.nextShot = this.time + b.pause; b.pause = 0.7 + Math.random() * 1.2; return; }
    b.burst--;
    b.nextShot = this.time + 0.11;
    const P = this.player;
    const moving = P.vel.length() > 2;
    let chance = (0.42 - dist / 260 - (moving ? 0.12 : 0) - (P.crouch ? 0.08 : 0)) * b.accuracy;
    chance = Math.max(0.04, Math.min(0.5, chance));
    const from = b.pos.clone(); from.y += 1.4;
    from.add(new THREE.Vector3(-Math.sin(b.yaw), 0, -Math.cos(b.yaw)).multiplyScalar(0.7));
    const to = P.pos.clone(); to.y += P.eye - 0.3;
    const hit = Math.random() < chance;
    if (!hit) to.add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 3));
    this.tracer(from, to, this.enemyTracerMat);
    sfx.enemyShot(dist);
    if (hit) this.hurtPlayer(7 + Math.random() * 4, b);
  }

  hurtPlayer(d, src) {
    const P = this.player;
    if (P.dead) return;
    P.hp -= d;
    P.lastHurt = this.time;
    sfx.hurt();
    $('damage-vignette').style.opacity = Math.min(1, 0.35 + (1 - P.hp / 100) * 0.7);
    if (P.hp <= 0) this.die(src);
  }

  die(src) {
    const P = this.player;
    P.dead = true; P.hp = 0;
    this.profile.data.deaths++; this.profile.save();
    this.streak = 0;
    if (MISSIONS[this.mission.i].type === 'streak') this.mission.count = 0;
    this.centerMsg('ABATIDO', src && src.name ? `por ${src.name}` : 'Renascendo...', 3);
    setTimeout(() => this.respawn(), 3500);
  }

  respawn() {
    const P = this.player;
    P.pos.copy(this.spawnPoint);
    P.vel.set(0, 0, 0);
    P.hp = 100; P.dead = false; P.med = 2; P.gren = 2;
    this.guns.forEach((g) => { g.ammo = g.def.mag; g.reserve = g.def.reserve; });
    $('damage-vignette').style.opacity = 0;
  }

  // ---------- TIRO ----------
  fire() {
    const G = this.gun, D = G.def, P = this.player;
    G.ammo--;
    sfx.shot(D.id);
    this.kick = 1;
    const adsK = this.ads;
    this.recoil.pitch += D.recoil * DEG * (1 - adsK * 0.45);
    this.recoil.yaw += (Math.random() - 0.5) * D.recoil * 0.6 * DEG;
    this.muzzleFlash.visible = !(D.optic === 'sniper' && adsK > 0.9);
    this.muzzleFlash.material.rotation = Math.random() * 6.28;
    this.flashT = 0.045;
    // dispersão
    const moving = Math.hypot(P.vel.x, P.vel.z) > 1;
    let spread = THREE.MathUtils.lerp(D.hip, D.ads, adsK) * (moving ? 1.5 : 1) * (P.crouch ? 0.7 : 1) * (P.onGround ? 1 : 2);
    spread *= DEG;
    const dir = new THREE.Vector3(0, 0, -1);
    const r = Math.sqrt(Math.random()) * spread, a = Math.random() * 6.28;
    dir.x = Math.tan(r) * Math.cos(a); dir.y = Math.tan(r) * Math.sin(a);
    dir.normalize().applyQuaternion(this.camera.quaternion);
    const origin = this.camera.position.clone();
    this.raycaster.set(origin, dir);
    this.raycaster.far = D.range;
    this.raycaster.firstHitOnly = false;
    const live = this.bots.filter((b) => !b.dead).flatMap((b) => b.hit);
    const bh = this.raycaster.intersectObjects(live, false)[0];
    const wh = this.world.raycast(this.raycaster);
    const muzzle = this.camera.localToWorld(new THREE.Vector3(THREE.MathUtils.lerp(0.13, 0, adsK), THREE.MathUtils.lerp(-0.11, -0.05, adsK), -0.9));
    this.muzzleLight.position.copy(muzzle);
    this.muzzleLight.intensity = 6;
    let end;
    if (bh && (!wh || bh.distance < wh.distance)) {
      end = bh.point;
      const bot = bh.object.userData.bot;
      const head = bh.object.userData.part === 'head';
      const fall = D.id === 'lr' ? 1 : Math.max(0.55, 1 - Math.max(0, bh.distance - 40) / 200);
      this.damageBot(bot, D.dmg * (head ? D.head : 1) * fall, head, bh.distance, 'gun');
      this.puff(bh.point, this.bloodMat, 5, 0.25, 2, 0.4);
    } else if (wh) {
      end = wh.point;
      this.puff(wh.point, this.dustMat, 4, 0.35, 1.5, 0.6);
      this.puff(wh.point, this.sparkMat, 3, 0.12, 4, 0.12);
      this.decal(wh);
    } else end = origin.clone().addScaledVector(dir, D.range);
    if (Math.random() < 0.6) this.tracer(muzzle, end, this.tracerMat);
  }

  damageBot(bot, dmg, head, dist, how) {
    if (bot.dead) return;
    bot.hp -= dmg;
    bot.state = 'engage'; bot.lastSeen = this.player.pos.clone();
    const hm = $('hitmarker');
    hm.classList.remove('show', 'kill'); void hm.offsetWidth;
    hm.classList.add('show');
    sfx.hit();
    if (bot.hp <= 0) {
      bot.dead = true;
      hm.classList.add('kill');
      sfx.kill();
      let xp = 100;
      let label = `+${xp} XP`;
      if (head) xp += 50;
      if (dist > 40) xp += 25;
      if (how === 'grenade') xp += 30;
      label = `+${xp} XP`;
      this.xpPop(label);
      this.sessionKills++;
      this.streak++;
      this.profile.data.kills++;
      if (head) this.profile.data.headshots++;
      this.killfeed(`<b>${this.profile.user.name}</b> ${how === 'grenade' ? '💣' : head ? '⌖' : '➶'} ${bot.name}${head ? ' (cabeça)' : ''}`);
      this.grantXP(xp);
      this.progressMission({ head, long: dist > 40, grenade: how === 'grenade' });
    }
  }

  grantXP(xp) {
    if (this.profile.addXP(xp)) {
      sfx.levelUp();
      this.centerMsg('PROMOVIDO!', `Nível ${this.profile.data.level} · ${this.profile.rank.name}`, 2.5);
    }
  }

  progressMission(k) {
    const m = MISSIONS[this.mission.i];
    const ok = m.type === 'kill' || m.type === 'streak' || (m.type === 'head' && k.head) || (m.type === 'long' && k.long) || (m.type === 'grenade' && k.grenade);
    if (!ok) return;
    this.mission.count++;
    if (this.mission.count >= m.n) {
      this.grantXP(m.xp);
      this.centerMsg('MISSÃO CUMPRIDA', `${m.text} · +${m.xp} XP`, 2.5);
      setTimeout(() => this.xpPop(`+${m.xp} XP`), 300);
      this.mission.i = (this.mission.i + 1) % MISSIONS.length;
      this.mission.count = 0;
    }
  }

  // ---------- GRANADA ----------
  throwGrenade() {
    const P = this.player;
    if (P.gren <= 0 || P.dead) return;
    P.gren--;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3d4a2c, roughness: 0.6 }));
    m.castShadow = true;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    m.position.copy(this.camera.position).addScaledVector(dir, 0.5);
    this.scene.add(m);
    const vel = dir.multiplyScalar(17); vel.y += 4;
    this.grenades.push({ mesh: m, vel, t: 0 });
  }

  updateGrenades(dt) {
    for (const g of this.grenades) {
      g.t += dt;
      g.vel.y -= 20 * dt;
      const p = g.mesh.position;
      const prev = p.clone();
      p.addScaledVector(g.vel, dt);
      // paredes
      const fx = p.clone(); fx.y = Math.max(0, p.y - 0.07);
      const before = fx.clone();
      this.world.collide(fx, 0.12);
      if (fx.distanceToSquared(before) > 1e-6) { p.x = fx.x; p.z = fx.z; g.vel.x *= -0.4; g.vel.z *= -0.4; }
      const gy = this.world.groundY(p.x, p.z, prev.y) + 0.07;
      if (p.y < gy) { p.y = gy; g.vel.y *= -0.35; g.vel.x *= 0.6; g.vel.z *= 0.6; }
      if (g.t > 2.3) { this.explode(p.clone()); g.done = true; this.scene.remove(g.mesh); }
    }
    this.grenades = this.grenades.filter((g) => !g.done);
  }

  explode(at) {
    const dPlayer = at.distanceTo(this.player.pos.clone().setY(this.player.pos.y + 1));
    sfx.explode(dPlayer);
    const flash = new THREE.Sprite(this.sparkMat.clone());
    flash.position.copy(at); flash.scale.setScalar(3);
    this.scene.add(flash);
    this.effects.push({ obj: flash, life: 0.35, max: 0.35, fade: true, grow: 12 });
    const smoke = new THREE.SpriteMaterial({ color: 0x5c5850, transparent: true, opacity: 0.6, depthWrite: false });
    this.puff(at.clone().setY(at.y + 0.5), smoke, 10, 2.2, 3, 2.2);
    this.muzzleLight.position.copy(at); this.muzzleLight.intensity = 60; this.flashT = 0.12;
    for (const b of this.bots) {
      if (b.dead) continue;
      const d = b.pos.clone().setY(b.pos.y + 1).distanceTo(at);
      if (d < 7) this.damageBot(b, 160 * (1 - d / 7) + 20, false, b.pos.distanceTo(this.player.pos), 'grenade');
    }
    if (dPlayer < 6) this.hurtPlayer(90 * (1 - dPlayer / 6), { name: 'sua própria granada' });
    this.shake = Math.max(this.shake || 0, Math.max(0, 1 - dPlayer / 30));
  }

  useMed() {
    const P = this.player;
    if (P.med <= 0 || P.hp >= 100 || P.dead) return;
    P.med--; P.hp = Math.min(100, P.hp + 60);
    sfx.heal();
    $('damage-vignette').style.opacity = 0;
  }

  reload() {
    const G = this.gun;
    if (this.reloading > 0 || G.ammo >= G.def.mag || G.reserve <= 0) return;
    this.reloading = G.def.reload;
    sfx.reload();
  }

  switchGun(i) {
    if (i === this.gunIndex || i < 0 || i >= this.guns.length) return;
    this.gun.model.group.visible = false;
    this.gunIndex = i;
    this.gun.model.group.visible = true;
    this.reloading = 0;
    this.switchT = 0.35;
  }

  // ---------- UPDATE ----------
  update(dt) {
    this.time += dt;
    const P = this.player, G = this.gun, D = G.def;

    // mira (ADS)
    const wantAds = this.adsHeld && !P.dead && this.reloading <= 0 && this.switchT <= 0;
    this.ads = THREE.MathUtils.damp(this.ads, wantAds ? 1 : 0, 14, dt);
    const sprint = this.keys.ShiftLeft && !this.adsHeld && !P.crouch && (this.keys.KeyW || this.joy?.y < -0.7);

    // movimento
    let ix = 0, iz = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) iz -= 1;
    if (this.keys.KeyS || this.keys.ArrowDown) iz += 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) ix -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) ix += 1;
    if (this.joy) { ix += this.joy.x; iz += this.joy.y; }
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    const joySprint = this.joy && Math.hypot(this.joy.x, this.joy.y) > 0.95 && this.joy.y < -0.7 && !this.adsHeld;
    const speed = P.dead ? 0 : (sprint || joySprint) ? 7.4 : P.crouch ? 2.4 : this.ads > 0.5 ? 2.9 : 4.7;
    const sin = Math.sin(P.yaw), cos = Math.cos(P.yaw);
    const wx = (ix * cos + iz * sin) * speed, wz = (-ix * sin + iz * cos) * speed;
    const accel = P.onGround ? 14 : 3;
    P.vel.x = THREE.MathUtils.damp(P.vel.x, wx, accel, dt);
    P.vel.z = THREE.MathUtils.damp(P.vel.z, wz, accel, dt);
    if (this.keys.Space && P.onGround && !P.dead) { P.vel.y = 6.8; P.onGround = false; }
    P.vel.y -= 22 * dt;
    P.pos.addScaledVector(P.vel, dt);
    this.world.collide(P.pos, 0.42);
    const gy = this.world.groundY(P.pos.x, P.pos.z, P.pos.y);
    if (P.pos.y <= gy) { P.pos.y = gy; P.vel.y = 0; P.onGround = true; } else if (P.pos.y - gy > 0.05) P.onGround = false;
    if (this.world.kind === 'osm' && P.onGround && gy < P.pos.y - 0.01) P.pos.y = gy;
    if (P.pos.y < (this.spawnPoint.y - 300)) P.pos.copy(this.spawnPoint);
    P.eye = THREE.MathUtils.damp(P.eye, P.crouch ? 1.1 : 1.65, 12, dt);

    // regeneração
    if (!P.dead && this.time - P.lastHurt > 5 && P.hp < 100) {
      P.hp = Math.min(100, P.hp + 14 * dt);
      $('damage-vignette').style.opacity = Math.max(0, (1 - P.hp / 100) * 0.6);
    }

    // câmera
    const hv = Math.hypot(P.vel.x, P.vel.z);
    if (P.onGround && hv > 0.5) {
      const prevStep = Math.floor(this.bob / Math.PI);
      this.bob += dt * hv * 1.9;
      if (Math.floor(this.bob / Math.PI) !== prevStep) sfx.step();
    }
    const bobY = Math.sin(this.bob * 2) * 0.035 * Math.min(1, hv / 4) * (1 - this.ads * 0.8);
    this.recoil.pitch = THREE.MathUtils.damp(this.recoil.pitch, 0, 7, dt);
    this.recoil.yaw = THREE.MathUtils.damp(this.recoil.yaw, 0, 7, dt);
    this.camera.position.set(P.pos.x, P.pos.y + P.eye + bobY, P.pos.z);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
    this.camera.rotation.set(THREE.MathUtils.clamp(P.pitch + this.recoil.pitch, -1.5, 1.5), P.yaw + this.recoil.yaw, 0);
    const baseFov = 75;
    this.camera.fov = THREE.MathUtils.lerp(sprint ? 80 : baseFov, D.adsFov, this.ads);
    this.camera.updateProjectionMatrix();

    // tiro
    if (this.switchT > 0) this.switchT -= dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = D.mag - G.ammo, take = Math.min(need, G.reserve);
        G.ammo += take; G.reserve -= take; this.reloading = 0;
      }
    }
    if (this.trigger && !P.dead && this.reloading <= 0 && this.switchT <= 0 && this.time >= this.nextShot && !(sprint && this.ads < 0.2 && false)) {
      if (G.ammo > 0) {
        if (D.auto || !this.triggerUsed) {
          this.fire();
          this.nextShot = this.time + 60 / D.rpm;
          this.triggerUsed = true;
        }
      } else if (!this.triggerUsed) {
        sfx.empty(); this.triggerUsed = true;
        this.reload();
      }
    }
    if (G.ammo === 0 && G.reserve > 0 && this.reloading <= 0 && !this.trigger) this.reload();

    // arma (posição na tela)
    this.updateWeaponView(dt, hv, sprint || joySprint);

    // efeitos
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.muzzleFlash.visible = false; this.muzzleLight.intensity = 0; } }
    for (const e of this.effects) {
      e.life -= dt;
      if (e.vel) { e.obj.position.addScaledVector(e.vel, dt); e.vel.y -= 2 * dt; }
      if (e.grow) e.obj.scale.multiplyScalar(1 + e.grow * dt * 0.5);
      if (e.fade && e.obj.material) e.obj.material.opacity = Math.max(0, e.life / e.max) * (e.obj.isLine ? 0.9 : 0.8);
      if (e.life <= 0) { this.scene.remove(e.obj); e.obj.geometry && e.obj.isLine && e.obj.geometry.dispose(); e.obj.material.dispose(); e.done = true; }
    }
    this.effects = this.effects.filter((e) => !e.done);

    this.updateBots(dt);
    this.updateGrenades(dt);
    this.world.update(this.camera);
    const snap = new THREE.Vector3(Math.round(P.pos.x / 8) * 8, 0, Math.round(P.pos.z / 8) * 8);
    this.world.updateShadow(snap);
    this.updateHUD();
  }

  updateWeaponView(dt, hv, sprinting) {
    const G = this.gun, M = G.model, D = G.def;
    const a = this.ads;
    this.kick = THREE.MathUtils.damp(this.kick, 0, 18, dt);
    this.swayX = THREE.MathUtils.damp(this.swayX, 0, 8, dt);
    this.swayY = THREE.MathUtils.damp(this.swayY, 0, 8, dt);
    const hip = new THREE.Vector3(0.13, -0.155, -0.33);
    const adsZ = M.adsZ ?? -0.24;
    const adsP = new THREE.Vector3(0, -M.sightY, adsZ);
    const p = hip.lerp(adsP, a);
    const bobK = (1 - a * 0.85) * Math.min(1, hv / 4);
    p.x += Math.cos(this.bob) * 0.012 * bobK + this.swayX * (1 - a * 0.7);
    p.y += Math.abs(Math.sin(this.bob)) * 0.012 * bobK + this.swayY * (1 - a * 0.7);
    p.z += this.kick * (D.id === 'lr' ? 0.12 : 0.05);
    let rx = this.kick * (D.id === 'lr' ? 0.18 : 0.06), ry = 0, rz = 0;
    if (sprinting && a < 0.1) { p.x -= 0.05; p.y -= 0.05; ry = 0.55; rz = 0.25; rx -= 0.15; }
    if (this.reloading > 0) { const k = Math.sin(Math.min(1, 1 - this.reloading / D.reload) * Math.PI); p.y -= 0.12 * k; rx -= 0.5 * k; rz += 0.4 * k; }
    if (this.switchT > 0) p.y -= this.switchT * 0.8;
    M.group.position.copy(p);
    M.group.rotation.set(rx, ry, rz);
    // clarão no cano
    const mz = M.muzzle.clone();
    M.group.localToWorld(mz);
    this.muzzleFlash.position.copy(mz);
    // luneta de sniper
    const scoped = D.optic === 'sniper' && a > 0.88;
    M.group.visible = !scoped;
    $('scope-overlay').classList.toggle('on', scoped);
    const ch = $('crosshair');
    ch.style.opacity = a > 0.6 ? 0 : 1;
    $('reticle').style.opacity = 0;
    if (M.reticle) M.reticle.visible = a > 0.55;
    const moving = Math.hypot(this.player.vel.x, this.player.vel.z) > 1;
    ch.style.setProperty('--spread', `${4 + D.hip * (moving ? 4 : 2.5) + this.kick * 8}px`);
  }

  // ---------- HUD ----------
  updateHUD() {
    const P = this.player, G = this.gun, prof = this.profile;
    $('hud-hp').style.width = `${Math.max(0, P.hp)}%`;
    $('hud-ammo').textContent = this.reloading > 0 ? '...' : G.ammo;
    $('hud-reserve').textContent = `/ ${G.reserve}`;
    $('hud-weapon').textContent = G.def.name;
    $('hud-med').textContent = P.med;
    $('hud-gren').textContent = P.gren;
    $('hud-level').textContent = prof.data.level;
    $('hud-rank-icon').textContent = prof.rank.icon;
    $('hud-name').textContent = `${prof.user.name} · ${prof.rank.name}`;
    $('hud-xpbar').style.width = `${Math.min(100, prof.levelProgress * 100)}%`;
    const m = MISSIONS[this.mission.i];
    const mt = `<b>MISSÃO</b>${m.text} (${this.mission.count}/${m.n})`;
    if (this._mt !== mt) { $('mission').innerHTML = mt; this._mt = mt; }
    if (this._attr !== this.world.attribution) { $('attrib').textContent = this.world.attribution; this._attr = this.world.attribution; }
    // bússola
    const heading = this.mapHeading();
    const deg = ((-heading / DEG) % 360 + 360) % 360;
    const strip = $('compass-strip');
    if (!strip.dataset.built) {
      const labels = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
      let html = '';
      for (let d = -360; d <= 720; d += 15) {
        const n = ((d % 360) + 360) % 360;
        html += `<span style="position:absolute;left:${(d + 360) * 2.5}px;transform:translateX(-50%);color:${labels[n] ? (n === 0 ? '#f5c518' : '#fff') : '#8896a3'}">${labels[n] || '|'}</span>`;
      }
      strip.innerHTML = html;
      strip.dataset.built = '1';
    }
    strip.style.transform = `translateX(${$('compass').clientWidth / 2 - (deg + 360) * 2.5}px)`;
    this.drawMinimap(heading);
  }

  // heading no referencial do mapa (norte = 0, sentido anti-horário em rad, igual ao yaw)
  mapHeading() {
    const a = this.world.northAngle || 0;
    return this.player.yaw + a;
  }
  toMap(x, z) {
    const a = this.world.northAngle || 0;
    return { x: x * Math.cos(a) + z * Math.sin(a), z: -x * Math.sin(a) + z * Math.cos(a) };
  }

  drawMinimap(heading) {
    const c = $('minimap');
    const ctx = c.getContext('2d');
    const W = c.width, R = W / 2;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.arc(R, R, R, 0, 7); ctx.clip();
    ctx.fillStyle = '#20251d'; ctx.fillRect(0, 0, W, W);
    const img = this.world.imagery;
    const range = 110; // metros mostrados no raio
    const k = R / range;
    ctx.translate(R, R);
    ctx.rotate(heading);
    if (img) {
      const pm = this.toMap(this.player.pos.x, this.player.pos.z);
      const px = img.toPx(pm.x, pm.z);
      const s = k * img.mpp;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(img.canvas, -px.x * s, -px.y * s, img.canvas.width * s, img.canvas.height * s);
      ctx.globalAlpha = 1;
    }
    // inimigos visíveis ou que atiraram recentemente
    for (const b of this.bots) {
      if (b.dead) continue;
      if (!(b.hasLos || this.time - (b.nextShot || 0) < 1.5)) continue;
      const bm = this.toMap(b.pos.x - this.player.pos.x, b.pos.z - this.player.pos.z);
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath(); ctx.arc(bm.x * k, bm.z * k, 4, 0, 7); ctx.fill();
    }
    const sp = this.toMap(this.spawnPoint.x - this.player.pos.x, this.spawnPoint.z - this.player.pos.z);
    ctx.fillStyle = '#f5c518'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⚡', sp.x * k, sp.z * k);
    ctx.restore();
    // jogador
    ctx.fillStyle = '#f5c518';
    ctx.beginPath(); ctx.moveTo(R, R - 9); ctx.lineTo(R + 6, R + 6); ctx.lineTo(R, R + 3); ctx.lineTo(R - 6, R + 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, 7); ctx.stroke();
    // N
    ctx.save(); ctx.translate(R, R); ctx.rotate(heading);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', 0, -R + 12);
    ctx.restore();
  }

  xpPop(text) {
    const e = $('xp-pop');
    e.textContent = text;
    e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  }
  killfeed(html) {
    const kf = $('killfeed');
    const d = document.createElement('div');
    d.innerHTML = html;
    kf.prepend(d);
    setTimeout(() => d.remove(), 5000);
    while (kf.children.length > 5) kf.lastChild.remove();
  }
  centerMsg(title, sub = '', secs = 2) {
    const e = $('center-msg');
    e.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    clearTimeout(this._cm);
    if (secs > 0) this._cm = setTimeout(() => { e.innerHTML = ''; }, secs * 1000);
  }

  // ---------- CONTROLES ----------
  bindInput() {
    const sens = () => 0.0022 * (this.settings.sens || 1) * (1 - this.ads * 0.55) * (this.gun.def.optic === 'sniper' && this.ads > 0.8 ? 0.35 : 1);
    this.h = {
      keydown: (e) => {
        if (this.paused) return;
        this.keys[e.code] = true;
        if (e.code === 'KeyR') this.reload();
        if (e.code === 'Digit1') this.switchGun(0);
        if (e.code === 'Digit2') this.switchGun(1);
        if (e.code === 'Digit3') this.switchGun(2);
        if (e.code === 'KeyQ') this.useMed();
        if (e.code === 'KeyG') this.throwGrenade();
        if (e.code === 'KeyC' || e.code === 'ControlLeft') this.player.crouch = !this.player.crouch;
        if (e.code === 'Space') e.preventDefault();
      },
      keyup: (e) => { this.keys[e.code] = false; },
      mousemove: (e) => {
        if (document.pointerLockElement !== this.canvas || this.paused) return;
        const s = sens();
        this.player.yaw -= e.movementX * s;
        this.player.pitch = THREE.MathUtils.clamp(this.player.pitch - e.movementY * s, -1.5, 1.5);
        this.swayX = THREE.MathUtils.clamp(this.swayX - e.movementX * 0.00015, -0.03, 0.03);
        this.swayY = THREE.MathUtils.clamp(this.swayY + e.movementY * 0.00015, -0.03, 0.03);
      },
      mousedown: (e) => {
        if (this.touch) return;
        initAudio();
        if (document.pointerLockElement !== this.canvas) { this.canvas.requestPointerLock(); return; }
        if (e.button === 0) { this.trigger = true; this.triggerUsed = false; }
        if (e.button === 2) this.adsHeld = true;
      },
      mouseup: (e) => {
        if (e.button === 0) { this.trigger = false; this.triggerUsed = false; }
        if (e.button === 2) this.adsHeld = false;
      },
      wheel: (e) => { if (!this.paused) this.switchGun((this.gunIndex + (e.deltaY > 0 ? 1 : -1) + this.guns.length) % this.guns.length); },
      contextmenu: (e) => e.preventDefault(),
      plc: () => {
        if (this.touch) return;
        if (document.pointerLockElement === this.canvas) { this.setPaused(false); this.centerMsg(''); }
        else if (this.running) { this.trigger = false; this.adsHeld = false; this.setPaused(true); }
      },
      resize: () => this.resize(),
      blur: () => { this.keys = {}; this.trigger = false; },
    };
    addEventListener('keydown', this.h.keydown);
    addEventListener('keyup', this.h.keyup);
    addEventListener('mousemove', this.h.mousemove);
    this.canvas.addEventListener('mousedown', this.h.mousedown);
    addEventListener('mouseup', this.h.mouseup);
    this.canvas.addEventListener('wheel', this.h.wheel, { passive: true });
    addEventListener('contextmenu', this.h.contextmenu);
    document.addEventListener('pointerlockchange', this.h.plc);
    addEventListener('resize', this.h.resize);
    addEventListener('blur', this.h.blur);
    if (this.touch) this.bindTouch(sens);
  }

  bindTouch(sens) {
    const joy = $('joy'), knob = $('joy-knob');
    let joyId = null, cx = 0, cy = 0;
    const look = new Map(); // touchId -> {x,y}
    this.t = {
      joyStart: (e) => {
        e.preventDefault(); initAudio();
        const t = e.changedTouches[0]; joyId = t.identifier;
        const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        this.t.joyMove(e);
      },
      joyMove: (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) if (t.identifier === joyId) {
          let dx = (t.clientX - cx) / 55, dy = (t.clientY - cy) / 55;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.joy = { x: dx, y: dy };
          knob.style.transform = `translate(${dx * 42}px, ${dy * 42}px)`;
        }
      },
      joyEnd: (e) => {
        for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; this.joy = null; knob.style.transform = ''; }
      },
      lookStart: (e) => {
        initAudio();
        for (const t of e.changedTouches) if (t.clientX > innerWidth * 0.35 && t.target.id !== 'joy') look.set(t.identifier, { x: t.clientX, y: t.clientY });
      },
      lookMove: (e) => {
        for (const t of e.changedTouches) {
          const l = look.get(t.identifier);
          if (!l) continue;
          const s = sens() * 2.2;
          this.player.yaw -= (t.clientX - l.x) * s;
          this.player.pitch = THREE.MathUtils.clamp(this.player.pitch - (t.clientY - l.y) * s, -1.5, 1.5);
          l.x = t.clientX; l.y = t.clientY;
        }
      },
      lookEnd: (e) => { for (const t of e.changedTouches) look.delete(t.identifier); },
    };
    joy.addEventListener('touchstart', this.t.joyStart, { passive: false });
    joy.addEventListener('touchmove', this.t.joyMove, { passive: false });
    joy.addEventListener('touchend', this.t.joyEnd);
    joy.addEventListener('touchcancel', this.t.joyEnd);
    const hud = $('screen-game');
    hud.addEventListener('touchstart', this.t.lookStart, { passive: true });
    hud.addEventListener('touchmove', this.t.lookMove, { passive: true });
    hud.addEventListener('touchend', this.t.lookEnd);
    hud.addEventListener('touchcancel', this.t.lookEnd);
    const btn = (id, down, up) => {
      const el = $(id);
      el.ontouchstart = (e) => { e.stopPropagation(); initAudio(); down && down(); el.classList.add('on'); };
      el.ontouchend = el.ontouchcancel = (e) => { e.stopPropagation(); up && up(); el.classList.remove('on'); };
    };
    // botão de tiro também permite mirar arrastando
    const fire = $('t-fire');
    fire.ontouchstart = (e) => { initAudio(); this.trigger = true; this.triggerUsed = false; fire.classList.add('on'); for (const t of e.changedTouches) look.set(t.identifier, { x: t.clientX, y: t.clientY }); };
    fire.ontouchend = fire.ontouchcancel = (e) => { this.trigger = false; this.triggerUsed = false; fire.classList.remove('on'); for (const t of e.changedTouches) look.delete(t.identifier); };
    btn('t-ads', () => { this.adsHeld = !this.adsHeld; $('t-ads').dataset.on = this.adsHeld; });
    btn('t-jump', () => { this.keys.Space = true; }, () => { this.keys.Space = false; });
    btn('t-reload', () => this.reload());
    btn('t-swap', () => this.switchGun((this.gunIndex + 1) % this.guns.length));
    btn('t-med', () => this.useMed());
    btn('t-gren', () => this.throwGrenade());
    btn('t-crouch', () => { this.player.crouch = !this.player.crouch; });
  }

  unbindInput() {
    const h = this.h;
    removeEventListener('keydown', h.keydown);
    removeEventListener('keyup', h.keyup);
    removeEventListener('mousemove', h.mousemove);
    this.canvas.removeEventListener('mousedown', h.mousedown);
    removeEventListener('mouseup', h.mouseup);
    this.canvas.removeEventListener('wheel', h.wheel);
    removeEventListener('contextmenu', h.contextmenu);
    document.removeEventListener('pointerlockchange', h.plc);
    removeEventListener('resize', h.resize);
    removeEventListener('blur', h.blur);
    if (this.t) {
      const joy = $('joy'), hud = $('screen-game');
      joy.removeEventListener('touchstart', this.t.joyStart);
      joy.removeEventListener('touchmove', this.t.joyMove);
      joy.removeEventListener('touchend', this.t.joyEnd);
      hud.removeEventListener('touchstart', this.t.lookStart);
      hud.removeEventListener('touchmove', this.t.lookMove);
      hud.removeEventListener('touchend', this.t.lookEnd);
    }
  }

  setPaused(p) {
    this.paused = p;
    $('pause-menu').classList.toggle('open', p);
    if (p) {
      const d = this.profile.data;
      $('pause-stats').innerHTML = `${this.label}<br>Abates nesta partida: <b>${this.sessionKills}</b> · Total: ${d.kills} · Mortes: ${d.deaths} · Na cabeça: ${d.headshots}`;
    }
  }

  resize() {
    const q = this.settings.quality;
    const pr = q === 'low' ? Math.min(devicePixelRatio, 1) * 0.8 : q === 'high' ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.35);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    if (this.pipeline) this.pipeline.setSize(innerWidth, innerHeight);
    this.camera.aspect = this.weaponCam.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.weaponCam.updateProjectionMatrix();
    if (this.world && this.world.tiles) this.world.tiles.setResolutionFromRenderer(this.camera, this.renderer);
  }

  start() {
    this.running = true;
    this.resize();
    this.bindInput();
    this.centerMsg(this.touch ? 'EM COMBATE' : 'CLIQUE PARA LUTAR', this.label.split(',').slice(0, 2).join(','), this.touch ? 2.5 : 0);
    if (!this.touch) this.paused = false;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const active = !this.paused && (this.touch || document.pointerLockElement === this.canvas);
      if (active) this.update(dt);
      else { this.world.update(this.camera); this.updateHUD(); }
      this.pipeline.render(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unbindInput();
    if (document.pointerLockElement) document.exitPointerLock();
    $('pause-menu').classList.remove('open');
    $('scope-overlay').classList.remove('on');
    $('center-msg').innerHTML = '';
    $('damage-vignette').style.opacity = 0;
    if (this.world && this.world.tiles) this.world.tiles.dispose();
    if (this.pipeline) this.pipeline.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map && m.map.dispose(); m.dispose(); });
    });
    this.renderer.renderLists.dispose();
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
