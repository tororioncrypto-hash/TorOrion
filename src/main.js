import * as THREE from 'three';
import './style.css';
import { initAuth, onUser, loginGoogle, loginEmail, signupEmail, loginGuest, logout, authMode, currentUser } from './auth.js';
import { Profile } from './profile.js';
import { MapPicker } from './mapPicker.js';
import { loadSettings, saveSettings, getGoogleKey, firebaseEnabled } from './config.js';
import { initAudio } from './audio.js';
import { Game } from './game.js';

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
// Cria o renderizador 3D tentando configurações cada vez mais leves (placas de vídeo antigas/Edge)
function webglInfo() {
  const info = { webgl2: false, webgl1: false, gpu: '?' };
  try { info.webgl2 = !!document.createElement('canvas').getContext('webgl2'); } catch {}
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      info.webgl1 = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      info.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }
  } catch {}
  return info;
}
function createRenderer() {
  const attempts = [
    { antialias: settings.quality !== 'low', powerPreference: 'high-performance' },
    { antialias: false, powerPreference: 'default' },
    { antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false, precision: 'mediump' },
  ];
  let lastErr;
  for (const opt of attempts) {
    const old = $('game-canvas');
    const c = document.createElement('canvas');
    c.id = 'game-canvas';
    old.replaceWith(c);
    try {
      const r = new THREE.WebGLRenderer({ canvas: c, ...opt });
      c.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        if (game) alert('O 3D do navegador travou (a placa de vídeo reiniciou). Recarregue a página para continuar.');
      });
      return r;
    } catch (e) { lastErr = e; console.warn('WebGL falhou com', opt, e); }
  }
  const i = webglInfo();
  const why = !i.webgl1 && !i.webgl2
    ? 'O navegador está com o 3D (WebGL) bloqueado.'
    : !i.webgl2 ? `Sua placa de vídeo (${i.gpu}) só tem WebGL 1, e o jogo precisa de WebGL 2.` : 'O 3D (WebGL 2) não iniciou.';
  throw new Error(`${why}\n\nComo resolver:\n1) Reinicie o notebook (o Edge fica aberto em segundo plano e só reativa o 3D depois de reiniciar).\n2) Se continuar, teste no Google Chrome.\n\nDetalhes: WebGL2=${i.webgl2 ? 'sim' : 'não'} · WebGL1=${i.webgl1 ? 'sim' : 'não'} · GPU=${i.gpu} · ${lastErr && lastErr.message}`);
}

$('btn-rotate-skip').onclick = () => document.body.classList.add('rot-skip');

let loadToken = 0;
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
  // celular: tela cheia e deitado (paisagem), quando o navegador permitir
  if (document.body.classList.contains('touch')) {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
    } catch {}
  }
  show('screen-loading');
  const token = ++loadToken;
  let lastChange = performance.now();
  const progress = (f, msg) => {
    if (token !== loadToken) return;
    lastChange = performance.now();
    $('load-bar').style.width = `${Math.round(f * 100)}%`;
    if (msg) $('load-msg').textContent = msg;
  };
  progress(0, 'Iniciando...');
  // vigia: se nada mudar por 60s, avisa e volta ao mapa
  const watchdog = setInterval(() => {
    if (token !== loadToken) return clearInterval(watchdog);
    if (performance.now() - lastChange > 60000) {
      clearInterval(watchdog);
      failLoad(new Error('A conexão com os servidores de mapa demorou demais. Tente de novo ou escolha outro local.'));
    }
  }, 2000);
  const failLoad = (e) => {
    if (token !== loadToken) return;
    loadToken++;
    clearInterval(watchdog);
    console.error(e);
    $('screen-game').style.visibility = '';
    if (game) { try { game.stop(); } catch {} game = null; }
    show('screen-map');
    alert('Não foi possível carregar o cenário: ' + (e.message || e));
  };
  try {
    if (!renderer) {
      renderer = createRenderer();
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    renderer.shadowMap.enabled = settings.quality !== 'low';
    renderer.setSize(innerWidth, innerHeight, false);
    progress(0.01, 'Preparando o motor 3D...');
    const g = new Game({ renderer, canvas: $('game-canvas'), profile, settings, mode, lat: chosen.lat, lon: chosen.lon, label: chosen.label, googleKey: key, onExit: exitGame });
    game = g;
    // o canvas precisa estar visível para o modo Google calcular a resolução
    $('screen-game').classList.add('active');
    $('screen-game').style.visibility = 'hidden';
    await g.init(progress);
    if (token !== loadToken) { try { g.stop(); } catch {} return; }
    clearInterval(watchdog);
    $('screen-game').style.visibility = '';
    show('screen-game');
    g.start();
    window.__game = g;
  } catch (e) {
    if (mode === 'google' && token === loadToken) {
      // Google 3D falhou: avisa e entra no modo satélite automaticamente
      console.warn('Google 3D falhou, usando satélite', e);
      if (game) { try { game.stop(); } catch {} game = null; }
      loadToken++;
      clearInterval(watchdog);
      $('screen-game').style.visibility = '';
      alert((e.message || e) + '\n\nVou abrir no modo Satélite + prédios enquanto isso.');
      $('sel-mode').value = 'osm';
      $('btn-deploy').onclick();
      $('sel-mode').value = 'google';
      return;
    }
    failLoad(e);
  }
};
$('btn-cancel-load').onclick = () => {
  loadToken++;
  if (game) { try { game.stop(); } catch {} game = null; }
  $('screen-game').style.visibility = '';
  show('screen-map');
};

// se um arquivo novo do jogo não carregar (versão antiga aberta), recarrega a página
addEventListener('vite:preloadError', () => location.reload());

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
