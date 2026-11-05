// Login: Firebase Auth (Google + email/senha) quando configurado.
// Sem Firebase configurado, usa contas locais (salvas só neste aparelho) para o protótipo.
import { FIREBASE_CONFIG, firebaseEnabled } from './config.js';

let fb = null; // { auth, mod }
let current = null;
const listeners = [];

const LOCAL_USERS = 'wto.localUsers';
const LOCAL_SESSION = 'wto.session';

function emit() { listeners.forEach((f) => f(current)); }
export function onUser(f) { listeners.push(f); }
export function currentUser() { return current; }
export function authMode() { return fb ? 'firebase' : 'local'; }

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function readLocal(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } }
function writeLocal(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

export async function initAuth() {
  if (firebaseEnabled()) {
    try {
      const appMod = await import('firebase/app');
      const mod = await import('firebase/auth');
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      const auth = mod.getAuth(app);
      fb = { auth, mod };
      await new Promise((res) => {
        let first = true;
        mod.onAuthStateChanged(auth, (u) => {
          current = u ? { uid: u.uid, name: u.displayName || (u.email || 'Soldado').split('@')[0], email: u.email, provider: 'firebase' } : null;
          emit();
          if (first) { first = false; res(); }
        });
      });
      return;
    } catch (e) {
      console.warn('Firebase falhou, usando login local', e);
      fb = null;
    }
  }
  const sess = readLocal(LOCAL_SESSION, null);
  current = sess;
  emit();
}

function friendly(e) {
  const code = e && e.code ? e.code : String(e && e.message || e);
  const map = {
    'auth/invalid-credential': 'Email ou senha incorretos.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/user-not-found': 'Conta não encontrada. Clique em "Criar conta".',
    'auth/email-already-in-use': 'Esse email já tem conta. Clique em "Entrar".',
    'auth/weak-password': 'Senha fraca: use pelo menos 6 caracteres.',
    'auth/invalid-email': 'Email inválido.',
    'auth/popup-closed-by-user': 'Login cancelado.',
    'auth/unauthorized-domain': 'Domínio não autorizado no Firebase (Authentication > Settings > Authorized domains).',
  };
  return map[code] || code;
}

export async function loginGoogle() {
  if (!fb) throw new Error('Login com Google precisa do Firebase configurado (veja o README). Por enquanto use email/senha ou convidado.');
  const { auth, mod } = fb;
  const provider = new mod.GoogleAuthProvider();
  try {
    await mod.signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await mod.signInWithRedirect(auth, provider);
    } else throw new Error(friendly(e));
  }
}

export async function loginEmail(email, pass) {
  if (fb) {
    try { await fb.mod.signInWithEmailAndPassword(fb.auth, email, pass); return; }
    catch (e) { throw new Error(friendly(e)); }
  }
  const users = readLocal(LOCAL_USERS, {});
  const u = users[email.toLowerCase()];
  if (!u) throw new Error('Conta não encontrada. Clique em "Criar conta".');
  if (u.hash !== await sha(email.toLowerCase() + ':' + pass)) throw new Error('Senha incorreta.');
  current = { uid: u.uid, name: u.name, email, provider: 'local' };
  writeLocal(LOCAL_SESSION, current);
  emit();
}

export async function signupEmail(email, pass, name) {
  name = (name || email.split('@')[0]).slice(0, 18);
  if (fb) {
    try {
      const cred = await fb.mod.createUserWithEmailAndPassword(fb.auth, email, pass);
      await fb.mod.updateProfile(cred.user, { displayName: name });
      current = { ...current, name };
      emit();
      return;
    } catch (e) { throw new Error(friendly(e)); }
  }
  if (pass.length < 6) throw new Error('Senha fraca: use pelo menos 6 caracteres.');
  const users = readLocal(LOCAL_USERS, {});
  const key = email.toLowerCase();
  if (users[key]) throw new Error('Esse email já tem conta. Clique em "Entrar".');
  const uid = 'local_' + Math.random().toString(36).slice(2, 10);
  users[key] = { uid, name, hash: await sha(key + ':' + pass) };
  writeLocal(LOCAL_USERS, users);
  current = { uid, name, email, provider: 'local' };
  writeLocal(LOCAL_SESSION, current);
  emit();
}

export function loginGuest() {
  const n = Math.floor(1000 + Math.random() * 9000);
  current = { uid: 'guest_' + n, name: 'Recruta' + n, provider: 'guest' };
  writeLocal(LOCAL_SESSION, current);
  emit();
}

export async function logout() {
  if (fb) await fb.mod.signOut(fb.auth);
  current = null;
  try { localStorage.removeItem(LOCAL_SESSION); } catch {}
  emit();
}
