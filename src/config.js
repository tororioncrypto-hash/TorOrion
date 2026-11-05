// Configuração do WAR Thor Orion.
// Preencha FIREBASE_CONFIG para ativar login real com Google e email/senha.
// Você pode também definir as variáveis de ambiente VITE_FIREBASE_* no GitHub (Settings > Secrets and variables > Actions > Variables).

const env = import.meta.env || {};

export const FIREBASE_CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
};

export const firebaseEnabled = () => !!FIREBASE_CONFIG.apiKey && !!FIREBASE_CONFIG.authDomain;

// Chave Google Maps Platform (Map Tiles API) para o modo 3D fotorrealista.
// Pode vir do build (VITE_GOOGLE_MAPS_KEY) ou ser colada pelo jogador em Configurações.
export function getGoogleKey() {
  try {
    return localStorage.getItem('wto.gkey') || env.VITE_GOOGLE_MAPS_KEY || '';
  } catch {
    return env.VITE_GOOGLE_MAPS_KEY || '';
  }
}

export const SETTINGS_KEY = 'wto.settings';
export function loadSettings() {
  try {
    return { sens: 1, quality: 'med', ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
  } catch {
    return { sens: 1, quality: 'med' };
  }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

// Fontes de dados do mundo real (gratuitas, sem chave).
export const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const IMAGERY_ATTRIB = 'Imagens © Esri, Maxar, Earthstar Geographics · Prédios © colaboradores do OpenStreetMap';
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
