// Perfil do jogador: XP, nível, patente, local de nascimento, estatísticas.
// Fase 1 salva no aparelho. Fase 2 vai sincronizar com o servidor (Firestore/backend).

export const RANKS = [
  { name: 'Recruta', icon: '▪' },
  { name: 'Soldado', icon: '▲' },
  { name: 'Cabo', icon: '◆' },
  { name: 'Sargento', icon: '✦' },
  { name: 'Subtenente', icon: '✧' },
  { name: 'Tenente', icon: '★' },
  { name: 'Capitão', icon: '✪' },
  { name: 'Major', icon: '✯' },
  { name: 'Coronel', icon: '✵' },
  { name: 'General Thor', icon: '⚡' },
];

export const xpForLevel = (lvl) => 400 + (lvl - 1) * 250; // XP para passar do nível lvl

export class Profile {
  constructor(user) {
    this.user = user;
    this.key = 'wto.profile.' + user.uid;
    const def = { xp: 0, level: 1, kills: 0, deaths: 0, headshots: 0, spawn: null, torOrion: 0, skins: [] };
    try { this.data = { ...def, ...(JSON.parse(localStorage.getItem(this.key)) || {}) }; } catch { this.data = def; }
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch {} }
  get rank() { return RANKS[Math.min(RANKS.length - 1, Math.floor((this.data.level - 1) / 5))]; }
  get levelProgress() { return this.data.xp / xpForLevel(this.data.level); }
  addXP(n) {
    this.data.xp += n;
    let leveled = false;
    while (this.data.xp >= xpForLevel(this.data.level)) {
      this.data.xp -= xpForLevel(this.data.level);
      this.data.level++;
      leveled = true;
    }
    this.save();
    return leveled;
  }
}
