import * as THREE from 'three';
import './style.css';
import { initAuth, onUser, loginGoogle, loginEmail, signupEmail, loginGuest, logout, authMode, currentUser } from './auth.js';
import { Profile } from './profile.js';
import { MapPicker } from './mapPicker.js';
import { loadSettings, saveSettings, getGoogleKey, firebaseEnabled } from './config.js';
import { initAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

let settings = loadSettings();
let profile = null;
let picker = null;
let chosen = null;
let game = null;
let renderer = null;

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 'screen-map' && picker) picker.invalidate();
}

// ---------- LOGIN ----------
function authMsg(t) { $('auth-msg').textContent = t || ''; }
$('btn-google').onclick = async () => { authMsg(''); try { await loginGoogle(); } catch (e) { authMsg(e.message); } };
$('btn-guest').onclick = () => loginGuest();
let submitMode = 'login';
document.querySelectorAll('#form-email button[type=submit]').forEach((b) => b.addEventListener('click', () => { submitMode = b.dataset.mode; }));
$('form-email').onsubmit = async (e) => {
  e.preventDefault();
  authMsg('');
  const email = $('in-email').value.trim(), pass = $('in-pass').value, name = $('in-name').value.trim();
  try {
    if (submitMode === 'signup') await signupEmail(email, pass, name);
    else await loginEmail(email, pass);
  } catch (err) { authMsg(err.message); }
};

onUser((u) => {
  if (!u) { profile = null; if (!game) show('screen-login'); return; }
  profile = new Profile(u);
  updateChip();
  if (!game) enterMap();
});

function updateChip() {
  if (!profile) return;
  $('chip-name').textContent = profile.user.name;
  $('chip-rank').textContent = profile.rank.icon;
  $('chip-level').textContent = `Nv ${profile.data.level} · ${profile.rank.name}`;
}

// ---------- MAPA ----------
function enterMap() {
  show('screen-map');
  if (!picker) {
    picker = new MapPicker($('picker-map'), (p) => {
      chosen = p;
      $('spawn-label').textContent = p.label;
      $('btn-deploy').disabled = false;
    });
    const last = profile.data.spawn;
    if (last) { picker.flyTo(last.lat, last.lon, 17); picker.pick(last.lat, last.lon, last.label); }
  }
  picker.invalidate();
  $('sel-mode').value = settings.mode || (getGoogleKey() ? 'google' : 'osm');
}
$('form-search').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('in-search').value.trim();
  if (!q) return;
  try { await picker.search(q); } catch (err) { $('spawn-label').textContent = err.message; }
};
$('btn-gps').onclick = () => {
  if (!navigator.geolocation) return;
  $('spawn-label').textContent = 'Obtendo sua localização...';
  navigator.geolocation.getCurrentPosition(
    (p) => { picker.flyTo(p.coords.latitude, p.coords.longitude, 18); picker.pick(p.coords.latitude, p.coords.longitude); },
    () => { $('spawn-label').textContent = 'Não foi possível obter sua localização.'; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};
$('btn-logout').onclick = () => logout();
$('sel-mode').onchange = () => { settings.mode = $('sel-mode').value; saveSettings(settings); };

// ---------- CONFIG ----------
$('btn-settings').onclick = () => {
  $('in-gkey').value = getGoogleKey();
  $('in-sens').value = settings.sens;
  $('sel-quality').value = settings.quality;
  $('modal-settings').classList.add('open');
};
$('btn-settings-close').onclick = () => {
  try { localStorage.setItem('wto.gkey', $('in-gkey').value.trim()); } catch {}
  settings.sens = parseFloat($('in-sens').value);
  settings.quality = $('sel-quality').value;
  saveSettings(settings);
  $('modal-settings').classList.remove('open');
};

// ---------- JOGO ----------
$('btn-deploy').onclick = async () => {
  if (!chosen) return;
  initAudio();
  let mode = $('sel-mode').value;
  const key = getGoogleKey();
  if (mode === 'google' && !key) {
    alert('O modo Google 3D precisa de uma chave da API Google Maps (Configurações ⚙). Vou usar o modo Satélite por enquanto.');
    mode = 'osm';
  }
  profile.data.spawn = chosen; profile.save();
  show('screen-loading');
  const progress = (f, msg) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; if (msg) $('load-msg').textContent = msg; };
  progress(0, 'Iniciando...');
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: $('game-canvas'), antialias: settings.quality !== 'low', powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }
  renderer.shadowMap.enabled = settings.quality !== 'low';
  renderer.setSize(innerWidth, innerHeight, false);
  const { Game } = await import('./game.js');
  game = new Game({ renderer, canvas: $('game-canvas'), profile, settings, mode, lat: chosen.lat, lon: chosen.lon, label: chosen.label, googleKey: key, onExit: exitGame });
  try {
    // o canvas precisa estar visível para o modo Google calcular a resolução
    $('screen-game').classList.add('active');
    $('screen-game').style.visibility = 'hidden';
    await game.init(progress);
    $('screen-game').style.visibility = '';
    show('screen-game');
    game.start();
    window.__game = game;
  } catch (e) {
    console.error(e);
    $('screen-game').style.visibility = '';
    try { game.stop(); } catch {}
    game = null;
    show('screen-map');
    alert('Não foi possível carregar o cenário: ' + (e.message || e));
  }
};

function exitGame() {
  if (game) { game.stop(); game = null; }
  updateChip();
  show('screen-map');
}
$('btn-resume').onclick = () => {
  if (!game) return;
  if (document.body.classList.contains('touch')) game.setPaused(false);
  else $('game-canvas').requestPointerLock();
};
$('btn-exit').onclick = () => exitGame();
$('btn-pause').onclick = () => {
  if (!game) return;
  if (document.pointerLockElement) document.exitPointerLock();
  game.setPaused(true);
};

// ---------- INÍCIO ----------
$('auth-mode').textContent = firebaseEnabled()
  ? 'Login seguro com Firebase.'
  : 'Modo protótipo: contas ficam salvas neste aparelho. Login Google é ativado quando o Firebase for configurado.';
initAuth().then(() => {
  if (!currentUser()) show('screen-login');
  $('auth-mode').textContent = authMode() === 'firebase' ? 'Login seguro com Firebase.' : $('auth-mode').textContent;
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
}
