# Tests navigateur autonomes — perf/cache des tuiles

Écrits pendant l'enquête perf carte du **2 juillet 2026** (Claude). Ils pilotent
le **Brave installé** en headless (via `puppeteer-core`, qui ne télécharge PAS de
navigateur) pour tester la vraie chaîne de tuiles **sans avoir à se connecter à
l'app** (les tuiles du worker sont publiques). But : ne plus faire de Nils le
testeur manuel.

## Setup (une fois)
```bash
cd tile-proxy/browser-tests
npm install            # installe puppeteer-core (pas de download de navigateur)
```
Chemin Brave en dur dans chaque script : `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`
(à adapter si Brave est ailleurs). `real-sw.mjs` pointe aussi vers `app/dist` en absolu.

## Les scripts
| Script | Ce qu'il prouve | Note |
|---|---|---|
| `node run.mjs` | Cache HTTP navigateur + Service Worker CacheFirst : **revisite = 1 ms**, 0 réseau | rapide |
| `node leaflet.mjs` | Vraie carte Leaflet : **0 tuile re-téléchargée** en revenant sur une zone vue | rapide |
| `node real-sw.mjs` | Charge la **VRAIE app `app/dist/` + son vrai SW workbox** → prouve qu'il cache (2-4 ms) | ⚠️ ~90 s (boot app+firebase) ; fais `npm run build` avant |
| `node pan-perf.mjs` | Compare des options Leaflet au pan (updateWhenIdle, fade, keepBuffer) | ⚠️ **LIMITE** : le headless rend dans le vide → frames bidon à 4 ms. **Ne mesure PAS la peinture réelle.** |

## ⚠️ Limite fondamentale (à retenir)
Ces tests mesurent parfaitement **réseau / cache / logique**, mais **PAS la
performance de peinture/GPU** : en headless, il n'y a pas de vraie composition
d'écran, donc les temps de frame sont irréalistes (~4 ms partout). Pour tout ce
qui touche la **fluidité de rendu** (le vrai problème restant de la carte), il
FAUT un **profil Performance depuis la vraie machine de Nils** (F12 → Performance
→ Record → pan → Stop). Ne pas essayer de "prouver" la peinture en headless.

## Voir aussi
- `../scan-tiles.mjs` — scanne une grille de tuiles (pas besoin de puppeteer),
  prouve qu'aucune tuile du worker n'est en échec.
- `../test-tiles.mjs` — test worker existant (z13-20, 3 couches).
- `../../HANDOFF.md` §"SESSION DU 2 JUILLET (SOIR)" — le récap complet de l'enquête.
