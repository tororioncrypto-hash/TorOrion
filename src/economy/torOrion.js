// Moeda do jogo: Tor Orion (TOR).
// FUTURO: o jogador compra TOR via Pix; o pagamento é confirmado por um backend
// (webhook do provedor de Pix), que credita o saldo de TOR na conta do jogador.
// Skins de armas e roupas são compradas com TOR. Nada disso roda no cliente:
// o saldo é sempre decidido pelo servidor para evitar fraude.
//
// Este módulo é só a interface que o jogo vai usar. Fase 1: desativado.

export const ECONOMY_ENABLED = false;

export const CATALOG = [
  { id: 'skin_r7_raio', type: 'weapon_skin', weapon: 'r7', name: 'TO-R7 Raio Dourado', price: 500 },
  { id: 'skin_s2_noite', type: 'weapon_skin', weapon: 'v9', name: 'V9 Noite Polar', price: 350 },
  { id: 'outfit_valquiria', type: 'outfit', name: 'Traje Valquíria', price: 900 },
];

export async function getBalance(profile) {
  return profile?.data?.torOrion ?? 0; // futuro: GET /api/wallet
}

export async function buyWithPix(/* amountBRL */) {
  throw new Error('Compra com Pix chega em uma fase futura.');
}

export async function purchaseItem(/* profile, itemId */) {
  throw new Error('Loja de skins chega em uma fase futura.');
}
