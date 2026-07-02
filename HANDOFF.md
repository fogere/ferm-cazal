# HANDOFF — pour la prochaine session Claude

> Écrit le **2 juillet 2026** en fin de session (limite d'usage atteinte). Ce
> document résume TOUT ce qui a été fait, ce qui reste, et comment travailler ici.
> Lis-le en entier avant de coder.

---

## ⭐⭐ SESSION DU 2 JUILLET (SOIR) — ENQUÊTE PERF CARTE — À LIRE EN PREMIER

> Cette section est plus récente que tout le reste du fichier. Le reste (§0→§5)
> vient de la session du matin (proxy tuiles, refacto, V8) et reste valable.

### Le sujet (non résolu, c'est LA priorité)
Nils : **la carte est "horrible à déplacer"** sur son PC (grand écran ~2558px, Brave).
Formulation la plus précise qu'il a donnée : **« les tuiles apparaissent et
disparaissent dès qu'elles quittent la fenêtre »**. Objectif = déplacement fluide
comme Google Maps.

### ✅ CE QUI EST PROUVÉ — NE PAS RE-ENQUÊTER
1. **Le cache des tuiles est PARFAIT de bout en bout.** Worker Cloudflare (edge HIT),
   cache HTTP navigateur, ET le **vrai `sw.js` workbox de prod** : revisite = **1 ms**.
   Prouvé par des tests navigateur autonomes (Brave headless) → voir §RESSOURCES.
   **Ne JAMAIS re-chasser le cache/réseau pour la lenteur de la carte.**
2. **La cause du "ça recharge à chaque passage" = BRAVE SHIELDS.** Shields ON empêchait
   la persistance du cache du SW → chaque passage re-téléchargeait. **Shields OFF pour
   le-cazal.web.app** → Network tab de Nils : toutes tuiles `200`, `(ServiceWorker)`,
   **2-4 ms**. C'est un réglage NAVIGATEUR, pas un bug app. ⚠️ **La famille est aussi sur
   Brave (Android)** → même réglage Shields OFF à faire pour elles (Nils les prévient).
3. **MAIS même Shields OFF + tuiles à 2-4 ms, le déplacement reste "horrible".**
   → Le problème n'est PAS les données, c'est le **RENDU / PEINTURE**.
4. **React ne re-render PAS pendant un pan** (`moveend`/`zoomend` seulement, pas pendant ;
   le marqueur GPS est isolé dans `SelfLocationMarker`, Map.tsx:819). React n'est pas le goulot.
5. **Google Maps et le site de l'IGN tournent nickel sur SA machine** → ce n'est ni son
   GPU ni Brave. C'est **NOTRE implémentation Leaflet**, commune à tout le monde.

### 🎯 SYMPTÔME = le comportement DOM de Leaflet
Leaflet rend les tuiles comme des `<img>` DOM et les **retire** hors d'un anneau autour
de l'écran (`keepBuffer`) → le "disparaît", puis les **recrée** au retour → le "réapparaît".
Google Maps/IGN ne font pas ça car ils rendent en **GPU/WebGL**. C'est probablement
**architectural** (Leaflet DOM + très grand écran = churn de tuiles + décodage/peinture lourds).

### ❌ TENTÉ ET ÉCHOUÉ — NE PAS RE-TENTER (tout reverté)
| Essai | Résultat |
|---|---|
| `fadeAnimation={false}` | supprime le **fallback LOD** (tuiles floues de secours) → **carrés NOIRS**. Reverté. |
| `updateWhenIdle={true}` | diffère le chargement à l'arrêt du geste → **écran noir 2-3× plus longtemps**. Reverté. |
| `keepBuffer={8}` | ~600 tuiles/écran → **thread principal noyé** (tuiles à 36-267 ms, 493 req/60s). Reverté à 4. |

### ✅ GARDÉ (vrai gain, mais ne règle PAS le pan de Nils)
**Pause de l'animation des clôtures pendant les déplacements.** `ZoomTracker` (Map.tsx:803)
pose la classe `map-moving` sur le conteneur pendant pan/zoom ; le CSS (`index.css`, cherche
`.map-moving .fence-electric-flow`) coupe alors l'animation. Pourquoi : l'effet "courant
circule" des clôtures électriques (`@keyframes fenceCurrentFlow`, anime `stroke-dashoffset`)
**repeint le SVG à 60 fps en continu** = c'est ce qui faisait **CHAUFFER le tél d'Eugénie**
(bug 23/05 ; ralentir 1.6s→4s n'avait rien changé, le repaint a lieu à chaque frame). Gain
réel batterie/chaleur. **Piste ouverte** : couper aussi le coût AU REPOS (n'animer que la
clôture sélectionnée, ou style statique "sous tension").

### 👉 LE PROCHAIN PAS EXACT (là où on s'est arrêté)
**Obtenir un profil Performance depuis la machine de Nils.** Je le lui ai demandé, il a
préféré clore la session ici. Au prochain démarrage, lui faire faire :
- F12 → **Performance** → ● Record → **panne la carte ~4 s** → Stop → screenshot.
- Lire le **résumé** (Scripting jaune / Rendering violet / **Painting vert** / System gris).
  La couleur dominante = la nature du goulot.
- **Mon pari : Painting dominant** (compositing + décodage de centaines de tuiles DOM +
  couches sur grand écran) → confirmerait la limite Leaflet-DOM.

### 🔧 LES 2 VRAIES PISTES DE FIX (après le profil)
1. **Réduire le coût de rendu Leaflet** sans changer de moteur : couper les couches
   vectorielles/fade pendant le mouvement, réduire le nombre de tuiles, ré-évaluer
   `preferCanvas` (rejeté le 03/06 quand les tuiles IGN étaient lentes — plus le cas).
2. **Changer de moteur de rendu (le vrai "comme Google Maps")** : passer la carte en
   rendu **GPU** — **MapLibre GL JS** (peut afficher les tuiles raster WMTS IGN via une
   source raster, rendu WebGL fluide même sur grand écran) ou un plugin Leaflet.GL.
   GROS chantier (réécrire la couche carte + toutes les couches vectorielles/marqueurs),
   mais **seul moyen d'égaler Google Maps**. À présenter à Nils comme une décision.

### 📁 RESSOURCES — où sont les trucs importants
- **Tests navigateur autonomes** (LE truc à réutiliser) : `tile-proxy/browser-tests/`
  (copiés depuis le scratchpad éphémère). `cd tile-proxy/browser-tests && npm install`
  (installe `puppeteer-core`, pas de download de navigateur ; utilise le Brave installé).
  Voir son `README.md`. Scripts : `run.mjs` (cache 1 ms), `real-sw.mjs` (vrai SW prod,
  ~90 s), `leaflet.mjs`, `pan-perf.mjs`. **⚠️ Le headless ne mesure PAS la peinture** (frames
  bidon à 4 ms) → d'où le besoin du profil sur la vraie machine.
- `tile-proxy/scan-tiles.mjs` (pas de puppeteer) — prouve qu'aucune tuile worker n'échoue
  (6615 testées, 100% `200`). `tile-proxy/test-tiles.mjs` — test worker existant.
- **Mémoire persistante** (hors repo) : `…\memory\feature_tile_perf.md` (⭐ résumé enquête),
  `feature_tile_proxy.md`.
- **Code clé** : `app/src/pages/Map.tsx` (MapContainer + `<TileLayer>` ~L2890-2965 : c'est là
  que se règlent fade/keepBuffer/updateWhenIdle/crossOrigin), `app/src/sw.ts` (routes cache
  workbox), `app/src/index.css` (`.fence-electric-flow` ~L311), `app/src/services/map/
  precacheTiles.ts` + `app/src/components/OfflineMapButton.tsx` (précache MANUEL : aérien,
  rayon 1.2 km, z15-19 — le seul pré-cache existant).

### ⚠️ LEÇON MÉTHODO de cette session (importante)
J'ai fait **3 paris code qui ont empiré** avant de comprendre. Le pattern gagnant a été :
**mesurer/prouver avant de déployer** (tests autonomes) et **demander UNE donnée précise à
Nils** (Network tab → a révélé Shields) plutôt que déployer des hypothèses. Pour le rendu,
le headless ne suffit pas : **il faut le profil de sa machine**. Ne redéploie pas de pari
sans preuve — Nils déteste ça (à juste titre) et son app a une valeur émotionnelle.

---

## 0. Par où commencer (ordre de lecture)

1. **Ce fichier (HANDOFF.md)** — l'état le plus à jour.
2. **ONBOARDING.md** — comment travailler sur ce projet (règles, pièges, workflow). Incontournable.
3. **ARCHITECTURE.md** — carte du code (⚠️ un peu périmé : dit Map.tsx = 4400, en réalité ~6131).
4. **AVANCEMENT.md** — journal chronologique détaillé (les dernières entrées = cette session).
5. **RUNBOOK.md** — commandes deploy / debug.
6. **REFACTOR_PLAN.md** — chantiers de consolidation.
7. **projet.md** — spec fonctionnelle de fondation (surtout historique).

### D'où vient « ma mémoire »
Deux sources, à ne pas confondre :
- **Mémoire persistante auto** (hors repo) : `C:\Users\Administrator\.claude\projects\c--Users-Administrator-Downloads-projet-farm\memory\`. Un fichier `MEMORY.md` (index) + des fichiers `.md` (1 fait chacun). Se charge automatiquement au début de chaque session. **C'est là que vivent les faits durables sur Nils, ses préférences, les pièges.** J'y ai ajouté cette session : le proxy de tuiles, le mécanisme de maj forcée, le chantier refacto Map.tsx.
- **Docs du repo** (ce dossier) : ONBOARDING / ARCHITECTURE / AVANCEMENT / etc. — le savoir technique versionné.

---

## 1. Qui / quoi (rappel express)

- **App** : PWA de gestion de ferme, `https://le-cazal.web.app`. Firebase Spark **gratuit, 0 €/mois absolu** (Blaze refusé, jamais de carte bancaire).
- **Utilisateur = Nils** (toi qui lis = son IA). Côté git `fogere`, côté Firestore uid `BBvnm324tcOPkexqM38Hf8diRFl1`. 4 utilisatrices : Eugénie, Benoît, Chacha, Nils. Tous Android sauf Nils qui teste aussi sur PC (Brave).
- Stack : React 19 + TS + Tailwind v4 + Vite + Leaflet (tuiles IGN) + Firebase (Auth/Firestore/Messaging) + Workbox PWA. Cron FCM via GitHub Actions (PAS Cloud Functions).

---

## 2. Ce qui a été fait CETTE session (6 commits, tous locaux)

⚠️ **Les 6 commits sont sur `main` LOCAL uniquement — PAS poussés sur GitHub.** Le token
fourni (compte `shazamifius`) n'a **pas** le droit d'écriture sur `fogere/ferm-cazal`
(403). Tout est en revanche **déployé en prod** (Firebase Hosting). Git est donc « en
retard » sur la prod, mais rien n'est perdu (commits locaux). Ne PAS `reset --hard`.

| Commit | Sujet |
|---|---|
| `68f17c7` | **feat(tasks)** — V8.json : timeline « historique des jours » (style Genshin) + tri alpha |
| `18a9339` | **refactor(map)** — découpe Map.tsx lot 1 (PinMarkersLayer + pinIcons.ts) |
| `dc21f3b` | **refactor(map)** — découpe Map.tsx lot 2 (StreamLayer + OtherMembersLayer) |
| `f1449d6` | **feat(map)** — proxy de tuiles IGN via Cloudflare Worker (le gros morceau) |
| `a880825` | **fix(pwa)** — mise à jour forcée du service worker |
| `9083f38` | **fix(map)** — retry auto des tuiles + test autonome `tile-proxy/test-tiles.mjs` |

### 2a. V8.json — refonte page Tâches (`/tasks`)
- Nouveau composant **`app/src/components/tasks/TaskDayTimeline.tsx`** : rangée de 6 ronds
  datés reliés, anneau rempli selon le nb de tâches cochées ce jour-là. Clic sur un jour →
  liste des tâches faites ce jour-là, en typo classique (fini le texte rayé gris).
- **Rétention 6 jours** (avant : `doneRecent.slice(0,20)` = 20 dernières). Constante
  `historyDays` du composant (mise à 6 ; Nils avait dit « 5 » pour le visuel, « 6 » pour
  l'effacement — j'ai aligné sur 6 ; à changer si tu veux 5 ronds).
- **Tri alphabétique** des tâches dans chaque groupe (avant : ordre d'échéance).
- Dashboard (« catégorie home ») **non touché** (demande explicite de Nils).

### 2b. Chantier fluidité + hygiène (découpe de Map.tsx)
Diagnostic chiffré : Map.tsx faisait **6349 lignes, 94 `useState`, 0 `React.memo`** → c'est
LA cause de la carte « pas fluide » ET du dépassement de la règle « aucun fichier > 5K ».
Approche : extraire les couches lourdes en composants `React.memo` (ne re-render que si
leurs props changent, pas à chaque render de MapPage). Behavior-preserving strict.
- **Créés** : `app/src/services/map/pinIcons.ts` (config + icônes pures), et sous
  `app/src/pages/map/layers/` : `PinMarkersLayer.tsx`, `StreamLayer.tsx`, `OtherMembersLayer.tsx`.
- **Map.tsx : 6349 → 6131 lignes.** Toujours > 5K → **le chantier continue** (voir §3).

### 2c. Proxy de tuiles IGN (Cloudflare Worker) — LE fix des carrés noirs
- **Problème** : les clients tapaient `data.geopf.fr` en direct → l'IGN rate-limite (fair-use
  public) → tuiles en erreur = **carrés noirs** + rechargement en boucle.
- **Solution** : un Cloudflare Worker (`tile-proxy/`) qui proxifie + cache les tuiles au bord
  du réseau (gratuit, 100k req/j). Déployé par Nils sur son compte Cloudflare.
  **URL du worker : `https://ferme-tiles.ferme-nilslamber.workers.dev`**
- Client rebranché sur le worker : `app/src/pages/Map.tsx` (aérien/plan/parcelles),
  `app/src/components/MapPicker.tsx`, `app/src/services/map/precacheTiles.ts`,
  routes cache `app/src/sw.ts` (hostname), et **CSP `firebase.json`** (img-src + connect-src).
- **Test autonome** : `node tile-proxy/test-tiles.mjs` → vérifie le worker sur z13-20 + 3
  couches. Résultat : **z13-19 OK partout**, z20 = 404 (l'IGN n'a pas de tuiles z20, jamais
  demandées car `maxNativeZoom=19`). **Sers-toi de ce script pour tester sans embêter Nils.**

### 2d. Mise à jour FORCÉE de la PWA (`app/src/sw.ts`)
- **Bug trouvé** : `skipWaiting` installait la nouvelle version mais la page ne se rechargeait
  jamais → utilisatrices **bloquées sur l'ancienne build** (donc l'ancien CSP qui bloquait le
  worker → carrés noirs), même après Ctrl+R.
- **Fix** : le handler `activate` du SW fait `client.navigate(client.url)` sur chaque fenêtre
  → rechargement auto dès qu'un nouveau SW prend la main. Bascule au prochain check (30 min /
  retour au premier plan via `UpdatePrompt.tsx`) ou au prochain lancement.

### 2e. Retry auto des tuiles (`app/src/pages/Map.tsx`, handler `tileerror`)
- Une tuile en échec est re-demandée jusqu'à 2× (600ms, 1200ms) avant d'abandonner → un raté
  ponctuel IGN se répare tout seul au lieu de laisser un carré noir.

---

## 3. Ce qui RESTE à faire / tester

### À tester (Nils, en prod)
- **Carte** : après un simple reload (la maj s'applique seule maintenant), déplacer/zoomer →
  les tuiles doivent charger et les ratés se réparer seuls. Si un carré reste noir > 3-4 s sur
  **Brave PC** → c'est le **Bouclier Brave (lion 🦁)** qui bloque `*.workers.dev` : le
  désactiver pour le site. Sur Android (la famille) ce souci n'existe pas.
- **Tâches** : timeline en haut de `/tasks`, clic sur un jour, tri alpha. Valider le « 6 ronds »
  (ou demander 5).

### À coder (prochains chantiers, par ordre de valeur)
1. **Zoom progressif** (« problème 1 » de Nils) : le zoom saute par paliers (`zoomSnap=1`),
   « moche pour se déplacer ». Maintenant que les tuiles sont rapides/cachées, un zoom lisse
   redevient viable. Options : `zoomSnap`/`zoomDelta` fractionnels (avaient été retirés le 03/06
   à cause de l'IGN lent — plus le cas maintenant) OU un handler smooth-wheel-zoom.
   **⚠️ maxNativeZoom doit rester 19** (l'IGN n'a pas z20).
2. **Fluidité — LE gros levier restant** : les **94 `useState`** de Map.tsx font re-render
   toute la carte à chaque frappe/ouverture de panneau. Regrouper les états de « mode UI »
   (panneau ouvert, mode édition…) pour qu'ils ne secouent plus le rendu. Plus délicat/risqué →
   petits pas prudents, behavior-preserving, deploy+test à chaque étape.
3. **Hygiène** : continuer à sortir les couches de Map.tsx en fichiers `React.memo`
   (`pages/map/layers/`) → passer sous 5K lignes. Candidats : labels enclos, aperçu édition
   clôture, et migrer les `useMemo` de couches (landPlotLayers/fenceLayers/landPlotLabels).
4. **Doc** : rafraîchir ARCHITECTURE.md (dit Map = 4400).

### Git — à faire dès qu'un token avec droit d'écriture est dispo
`git push` les 6 commits locaux sur `fogere/ferm-cazal` main. Le token `shazamifius` est
**lecture seule** dessus. Il faut soit un PAT **classique scope `repo`** du compte qui a le
push (shazamifius EST collaborateur avec push, mais son fine-grained token n'avait pas
« Contents: write »), soit un token du compte `fogere`.

---

## 4. Organisation actuelle du code (l'essentiel)

```
projet farm/
├── app/                         ← l'app React (build → app/dist déployé)
│   ├── src/
│   │   ├── pages/               Login, Dashboard, Tasks, Map (⚠️6131 l), Admin (~2044),
│   │   │   │                    AnimalDetail, Grazing, Alerts, Bugs, Settings, Products, Messages
│   │   │   └── map/
│   │   │       ├── layers/      ← NOUVEAU : couches React.memo (PinMarkersLayer, StreamLayer,
│   │   │       │                  OtherMembersLayer). LE pattern à étendre pour dégraisser Map.tsx.
│   │   │       └── panels/      panneaux extraits (Water*, Battery, Fence, Enclosure, LandPlot…)
│   │   ├── components/          Layout, BugReportButton, UpdatePrompt, TaskDoneFlash,
│   │   │   │                    MapPicker, EmojiPicker, animal/ (CareJournal…), tasks/ (TaskDayTimeline)
│   │   ├── services/
│   │   │   └── map/             geometry, time, health, pinIcons (NOUVEAU : icônes+config),
│   │   │                        precacheTiles, stream-visual, fence-visual, polygon*, water, battery…
│   │   ├── hooks/               useAuth, useUsers, useMessaging, useLocationCore, useGeofenceAlert…
│   │   ├── sw.ts                ← service worker Workbox (cache tuiles, FCM, MAJ FORCÉE)
│   │   └── firebase.ts          init Firebase (ignoreUndefinedProperties: true)
│   └── firestore.rules          règles (source de vérité)
├── tile-proxy/                  ← NOUVEAU : le Worker Cloudflare (proxy tuiles) + DEPLOY.md + test-tiles.mjs
├── worker/                      ← ANCIEN worker cron FCM (projet test farm-ed787) — NE PAS confondre, inchangé
├── cron/notify.cjs              cron FCM réel (exécuté par GitHub Actions */5 min)
├── firebase.json                hosting + headers (CSP contient maintenant ferme-tiles.workers.dev)
├── HANDOFF.md ARCHITECTURE.md ONBOARDING.md AVANCEMENT.md RUNBOOK.md REFACTOR_PLAN.md projet.md
└── V4..V8.json / bug*.json      exports de bug reports (V8 = cette session, traité)
```

---

## 5. TIPS pour la prochaine session (le plus important)

### Déploiement (le flow qui marche)
```bash
cd app && npm run build          # tsc auto dans le build ; sinon: npx tsc --noEmit -p tsconfig.app.json
cd .. && firebase deploy --only hosting
curl -s -o /dev/null -w "%{http_code}" https://le-cazal.web.app   # doit = 200
```
- **JAMAIS** `firebase deploy --only functions` (plante — Blaze requis).
- Demander l'OK de Nils avant de déployer, sauf s'il a déjà dit « déploie ». Cette session il a
  validé chaque déploiement. Il **teste en prod** (pas de dev local : il n'a pas de compte pour
  se connecter en localhost — cf. plus bas).

### Nils ne peut PAS tester en local
Il n'a pas de moyen simple de se logguer sur `localhost:5173` (Firebase Auth). **Il teste
uniquement sur `le-cazal.web.app`.** Donc : déployer pour qu'il teste. Corollaire crucial ↓

### ⭐ Construis des tests AUTONOMES — ne fais pas de Nils ton testeur manuel
C'est LE feedback fort de cette session. Il en a marre des allers-retours « teste ça / envoie
un screen ». Dès que possible, écris un script qui vérifie toi-même (ex : `tile-proxy/test-tiles.mjs`
qui teste le worker sans navigateur). Le harnais a `node`, `curl`, `bash`. Pour la carte
authentifiée, un headless browser bute sur le login (pas de creds) — mais tout ce qui est
infra/API/worker/pur se teste en autonomie.

### Le piège PWA « bloqué sur l'ancienne version »
Symptôme : tu déploies, mais Nils voit toujours l'ancien comportement même après Ctrl+R.
Cause : le service worker sert l'ancien bundle depuis le précache. Fix DÉFINITIF déjà en place
(`sw.ts` activate → `client.navigate`). Si ça résiste encore pour lui : **DevTools (F12) →
Application → Storage → « Clear site data »** (désenregistre le SW + vide les caches), puis
Ctrl+Shift+R. (Il a dû se relogguer après — ses codes étaient enregistrés.)

### Le proxy de tuiles
- URL : `https://ferme-tiles.ferme-nilslamber.workers.dev`. Compte Cloudflare de Nils
  (shazamifius), déployé via le **dashboard web** (le CLI wrangler plantait `libuv` sur son
  Windows). Code source : `tile-proxy/index.js`. Pour le modifier → dashboard Cloudflare →
  worker `ferme-tiles` → « Modifier le code » → coller → Deploy.
- Il cache 30 j au edge, ne cache jamais une erreur, allowlist 3 couches IGN.
- **Si l'URL du worker change** : mettre à jour les 5 endroits (Map.tsx, MapPicker.tsx,
  precacheTiles.ts, sw.ts ×2, firebase.json CSP).

### Préférences de Nils (confirmées cette session)
- Tutoiement, direct, **pas de flatterie**. Récap factuel. **Mockups ASCII** appréciés pour les
  choix UI. **`AskUserQuestion`** avec 2-4 options claires pour les choix structurants — il choisit
  volontiers.
- **Autonomie déléguée + anti-casse strict.** « Ne casse rien » est non-négociable (attachement
  émotionnel à l'app). Préférer **ajouter un fichier** plutôt que modifier un fichier lourd.
- Commits atomiques, message factuel, co-author `Claude Opus 4.8 <noreply@anthropic.com>`.
- **Ne PAS** lui faire de commentaire sur la sécurité des tokens (il l'a demandé explicitement) —
  juste faire ce qu'il demande. (Note interne : un token GitHub a fuité dans le chat, à révoquer.)
- Pas de monitoring payant (Sentry refusé même free). Pas de modale d'onboarding/tuto.

### Pièges techniques (voir aussi ONBOARDING §5 + mémoire auto)
- Firestore : `where()` seul + tri client (pas d'`orderBy` après `where` → index composite).
- ESLint React Compiler = 48 faux positifs, ignorer.
- `isTemp` : garder `if (isTemp) return` avant tout write (aides temporaires anonymes).
- Helpers déjà extraits (geometry/time/health/pinIcons) — ne pas redupliquer.
- `import.meta.env.VITE_*` ne passe PAS dans `sw.ts` (clés Firebase hard-codées dedans).
- Map.tsx : `maxNativeZoom=19` (l'IGN n'a pas z20). Ne pas remonter.
- `git checkout HEAD --` / `reset --hard` = DANGER (Nils accumule des modifs non commitées ;
  cette fois le tree est propre, mais vérifier toujours `git status` avant).

### État final de la session
Tout est **déployé** et **committé en local** (non poussé). Working tree propre à part des
untracked inoffensifs (`bug8.json`, `graphify-out/`, `package-lock.json`). Le dernier point
ouvert : confirmer avec Nils que les carrés noirs ont disparu (reload + éventuellement lion
Brave), puis attaquer le **zoom progressif**.

Bonne route. 🌿
