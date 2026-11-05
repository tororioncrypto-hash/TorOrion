# ⚡ WAR Thor Orion

FPS militar online **original**, jogado nas ruas reais do planeta. O jogador escolhe qualquer lugar do mapa-múndi e nasce ali: o chão é a imagem de satélite real do local e os prédios vêm do OpenStreetMap (ou do Google 3D fotorrealista, se você tiver uma chave).

> Inspirado no gênero dos grandes FPS militares, sem usar nome, arte, armas ou qualquer conteúdo de outro jogo.

## Fase 1 (este protótipo)

- Login com **email/senha**, **Google** (via Firebase) ou **convidado**
- Mapa-múndi com busca de endereço, GPS e escolha do ponto de nascimento
- Cenário real: satélite Esri + prédios e árvores do OpenStreetMap, com colisão
- Modo opcional **Google Photorealistic 3D Tiles** (precisa de chave)
- 1ª pessoa: andar, correr, pular, agachar, mirar (ADS), recuo, recarga
- 3 armas originais: **TO-R7 Trovão** (fuzil com luneta), **V9 Relâmpago** (SMG com red dot), **Orion LR-50** (sniper)
- Kit médico, granadas, inimigos com IA, XP por abate (**+100 XP**, bônus na cabeça e longa distância), níveis e patentes
- Missões em sequência, minimapa com satélite, bússola, killfeed
- Controles de toque para celular e instalação como app (PWA)

## Controles (PC)

WASD mover · Mouse mirar · Clique atirar · Botão direito mirar · Shift correr · Espaço pular · C agachar · R recarregar · 1/2/3 ou rodinha trocar arma · Q kit médico · G granada · Esc pausa

## Rodar no computador

```bash
npm install
npm run dev
```

## Publicação

Todo push na branch `main` publica automaticamente no GitHub Pages (`.github/workflows/deploy.yml`).
Na primeira vez: **Settings → Pages → Source: GitHub Actions**.

## Chaves opcionais

Crie em **Settings → Secrets and variables → Actions → Variables** (ou num arquivo `.env.local`, veja `.env.example`):

| Variável | Para quê |
|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Login real com Google e email/senha (Firebase Authentication). Sem isso, as contas ficam salvas só no aparelho. |
| `VITE_GOOGLE_MAPS_KEY` | Modo **Google 3D fotorrealista**. Ative a **Map Tiles API** no Google Cloud. O jogador também pode colar a chave em ⚙ Configurações. |

### Firebase em 5 passos
1. [console.firebase.google.com](https://console.firebase.google.com) → Adicionar projeto
2. Authentication → Começar → ative **Google** e **E-mail/senha**
3. Authentication → Settings → Domínios autorizados → adicione `SEU-USUARIO.github.io`
4. Configurações do projeto → Seus apps → Web (`</>`) → copie `apiKey`, `authDomain`, `projectId`, `appId`
5. Cadastre como Variables no GitHub (tabela acima) e rode o deploy de novo

## Arquitetura

```
src/
  main.js            telas: login → mapa → carregamento → jogo
  auth.js            Firebase Auth ou contas locais
  profile.js         XP, níveis, patentes, estatísticas
  mapPicker.js       mapa-múndi (Leaflet + satélite Esri + busca Nominatim)
  game.js            loop do jogo, jogador, tiro, IA, HUD, toque
  weapons.js         armas e soldados (modelos 3D procedurais originais)
  audio.js           sons sintetizados
  world/osmWorld.js  cenário satélite + OpenStreetMap
  world/googleWorld.js cenário Google 3D Tiles
  economy/torOrion.js  (futuro) moeda Tor Orion, compra via Pix, skins
```

## Próximas fases

2. Multiplayer em tempo real (servidor autoritativo, salas por região)
3. Mais armas, acessórios, itens e progressão de armas
4. Missões diárias e eventos por tempo limitado
5. App Android/iOS (Capacitor → Play Store) e melhorias gráficas
6. Loja: moeda **Tor Orion** comprada via Pix, para skins de armas e roupas (saldo sempre controlado pelo servidor)

## Créditos dos dados

Imagens de satélite © Esri, Maxar, Earthstar Geographics · Prédios © colaboradores do OpenStreetMap (ODbL) · Google 3D Tiles © Google. Verifique os termos de uso de cada serviço antes de lançar comercialmente.
