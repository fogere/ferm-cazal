# FERME NILSLAMBER — Journal d'avancement

---

## CONTEXTE PROJET (résumé)

- **Ferme** : 14 Cazals, 09300 Roquefixade, Ariège — GPS 42.9375 / 1.7452
- **Famille** : Stinglhamber (orthographe phonétique "Nilslamber" dans les premières notes)
- **Utilisateurs** : Mathieu (admin/PAC), Nils (terrain), Eugénie (admin/PAC)
- **Animaux** : 24 ânes + 13 chevaux — pas de moutons
- **Contrainte** : 0€/mois, tout Android, 5G Bouygues, pas de wifi box
- **Stack** : React + TypeScript + Tailwind v4 + Firebase + Leaflet IGN

---

## CE QUI EST FAIT — 15 mai 2026

### Infrastructure & configuration
- Node.js 24 installé via winget
- Projet Vite + React + TypeScript scaffoldé dans `app/`
- Tailwind v4 configuré avec plugin `@tailwindcss/vite` (plus rapide que PostCSS)
- Thème custom complet : couleurs forêt, prairie, crème, alertes
- PWA configurée via `vite-plugin-pwa` — installable sur Android, service worker auto
- Build de production fonctionnel (2.38s, chunks séparés firebase/map)
- `.gitignore` mis à jour (`.env` exclu du git)

### Firebase
- Projet Firebase : `farm-ed787` (projet TEST temporaire — pas le final)
- Firebase Authentication activé (Email/Mot de passe)
- 3 comptes utilisateurs créés avec emails personnels réels de la famille
- Firestore en mode production — règles de sécurité déployées manuellement
- Règles : accès complet aux utilisateurs authentifiés, tout refusé sinon
- Fichier `firestore.rules` versionné dans le projet
- Service worker Firebase Cloud Messaging prêt (`public/firebase-messaging-sw.js`)

### Authentification
- `useAuth.tsx` : contexte React complet (login, logout, profil Firestore)
- Connexion par **email complet** (les comptes utilisent les emails personnels)
- Création automatique du profil Firestore au premier login
- Fallback robuste : si Firestore refuse (permissions), profil minimal créé depuis Firebase Auth → plus de spinner infini
- Routes protégées : redirige vers `/login` si non connecté, vers `/dashboard` si déjà connecté

### Pages construites
| Page | Statut | Contenu |
|------|--------|---------|
| Login | ✅ Complet | Design vert, email + mdp, animation shake erreur, gestion erreurs Firebase |
| Dashboard | ✅ Fonctionnel | Météo Open-Meteo, disponibilité du jour, tâches temps réel, alertes actives |
| Tasks | 🔲 Placeholder | Structure vide — Phase 2 |
| Map | 🔲 Placeholder | Structure vide — Phase 3 |
| Alerts | 🔲 Placeholder | Structure vide — Phase 3 |
| Settings | ✅ Basique | Affiche profil + bouton déconnexion fonctionnel |

### Navigation
- Bottom bar 5 onglets (Accueil / Tâches / Carte / Alertes / Réglages)
- Icônes Lucide React, onglet actif mis en évidence
- Layout responsive mobile-first, scroll interne, bottom nav fixe

### Météo
- API Open-Meteo intégrée (gratuite, sans clé, coordonnées GPS exactes de la ferme)
- Affichage : température, vent, précipitations, emoji condition, min/max du jour
- Codes WMO → libellé français + emoji (28 conditions couvertes)
- Rafraîchissement au chargement, bouton retry si échec réseau

### Données temps réel (Dashboard)
- Tâches du jour via `onSnapshot` Firestore (filtrées côté client — pas d'index composite requis)
- Alertes actives via `onSnapshot` (triées par sévérité : urgent → warning → info)
- Cocher une tâche = 1 tap → `updateDoc` Firestore immédiat
- Résoudre une alerte = 1 tap → `resolved: true` dans Firestore

---

## PROBLÈMES RENCONTRÉS ET RÉSOLUS

| Problème | Cause | Solution |
|----------|-------|----------|
| `auth/invalid-email` | Code générait `prenom@ferme-nilslamber.fr` mais comptes Firebase = emails perso | Login changé pour accepter email complet |
| Spinner infini | `loadOrCreateProfile` plantait sans try/catch → `setLoading(false)` jamais atteint | Try/catch ajouté, profil fallback si Firestore inaccessible |
| `Missing or insufficient permissions` | Firestore en mode production, règles non déployées | Règles déployées manuellement dans Firebase Console |
| `The query requires an index` | Requête Firestore sur 2 champs sans index composite | Filtre `dueDate` déplacé côté client |
| `ERR_BLOCKED_BY_CLIENT` | Bloqueur de pub bloque Firestore sur localhost | Désactiver l'extension sur localhost |
| Build TypeScript erreur `manualChunks` | Type incompatible dans rollup options | Changé en fonction `(id) => ...` |

---

## FIREBASE — ÉTAT ACTUEL

- **Projet test** : `farm-ed787` — à jeter quand on passe au projet final
- **Projet final** : sera sous l'email d'Eugénie Stinglhamber (pas encore accessible)
- **Migration** : quand on change de projet → copier `.env` avec nouvelles clés, recréer les 3 comptes Auth, redéployer les règles Firestore

---

## PROCHAINES ÉTAPES (dans l'ordre)

### Phase 2 — Carnet de tâches complet
- Créer une tâche (formulaire minimal)
- Assigner à une personne
- Récurrence quotidienne / hebdomadaire
- Vue de la charge par personne (graphique simple)
- Disponibilité quotidienne → impact sur la répartition

### Phase 3 — Carte interactive
- Intégration Leaflet + tuiles IGN (aérien + cadastre)
- Système d'épingles (points d'eau, batteries, zones animaux)
- Fiches points d'eau naturels (saisonniers, permanents, problème)
- Fiches points d'eau manuels (intervalles, notifications, escalade)
- Fiches batteries clôture électrique (statut manuel)
- Zones animaux + historique de rotation

### Phase 4 — Notifications push
- Firebase Cloud Messaging sur Android
- Rappels eau manuels (proactifs, heures silencieuses)
- Alertes escalade si tâche non confirmée
- Vigilance Météo-France (orange/rouge → push à tous)
- Risque incendie Géorisques

### Phase 5 — Production
- Créer le projet Firebase final sous email Eugénie
- Déployer sur Firebase Hosting
- Configurer domaine si souhaité
- Tester sur les 3 téléphones Android réels
- Installer comme PWA sur chaque téléphone

---

## FICHIERS CLÉS DU PROJET

```
projet farm/
├── AVANCEMENT.md          ← ce fichier
├── projet.md              ← document de fondation complet (specs détaillées)
└── app/
    ├── .env               ← clés Firebase (ne pas commiter)
    ├── .env.example       ← template
    ├── firestore.rules    ← règles de sécurité Firestore
    ├── vite.config.ts     ← Vite + Tailwind + PWA
    └── src/
        ├── firebase.ts           → config + init Firebase
        ├── types/index.ts        → tous les types TypeScript
        ├── hooks/useAuth.tsx     → auth context (login/logout/profil)
        ├── services/weather.ts   → Open-Meteo API
        ├── pages/
        │   ├── Login.tsx         → connexion (email + mdp)
        │   ├── Dashboard.tsx     → tableau de bord principal
        │   ├── Tasks.tsx         → placeholder Phase 2
        │   ├── Map.tsx           → placeholder Phase 3
        │   ├── Alerts.tsx        → placeholder Phase 3
        │   └── Settings.tsx      → déconnexion
        └── components/layout/
            ├── Layout.tsx        → wrapper + scroll
            └── BottomNav.tsx     → navigation 5 onglets
```

---

*Dernière mise à jour : 15 mai 2026*

---

## SESSION DU 21 MAI 2026 — features bugs Nils + Eugénie

### Carte — clôtures électriques (bug Nils 21/05)
- **Atténuation visuelle du motif électrique** : sélecteur 3 niveaux (Plein / Atténué / Coupé) dans le panneau d'édition d'une clôture électrique. Plein = ligne continue opacité 0.9. Atténué = pointillé 6/6 opacité 0.55. Coupé = pointillé 3/8 opacité 0.35 couleur grise.
- **Lien clôture → batterie** : champ `connectedBatteryId`. Si la batterie pointée a `powerOn=false`, toutes les clôtures qui lui sont reliées passent automatiquement en visuel "coupé" (override de leur `electricityIntensity`).
- **Toggle ON/OFF sur les batteries** (`powerOn`) : un bouton dans le panneau batterie. Quand OFF, le pin batterie affiche un voyant rouge ⊘, et les clôtures connectées passent toutes en visuel "coupé" en temps réel.

### Carte — cours d'eau polyline (bug Eugénie 21/05, Phase 1)
- **Nouveau type `water_stream`** : tracé polyline (comme une clôture) au lieu d'un pin ponctuel. Outil dédié dans la barre d'actions.
- **Saisonnalité** : permanent ou saisonnier avec sélection des mois actifs (`streamMode`, `streamActiveMonths`).
- Les anciens points `water_natural` restent affichés pour migration manuelle (delete + re-create).
- **Phase 2 prévue (pas faite)** : atténuation manuelle par segment ("à partir de ce point, −90% de débit").

### Carte — refonte clôtures / espaces (bug Eugénie 21/05) — NON FAIT
- Demande : séparer "définition d'espace" (terrain qui nous appartient) du "tracé de clôture" (physique, amovible). Inclure snap auto et zones vides intérieures.
- Statut : à arbitrer avec le user — gros chantier impactant placement animaux, geofence, pâturage, historique mouvements.

### Tâches — broadcast pour tous (bug Nils 21/05)
- Le mode broadcast `'📣 Pour tous'` (existant) est ouvert à tous les regular users (avant : super-admin uniquement). Tout regular peut désormais créer une tâche partagée à tous.

### Refacto + robustesse (session)
- `getFenceVisualState()` extrait dans `services/map/fence-visual.ts` (helper pur testable, encapsule la logique électricité + batterie). Map.tsx -30 lignes.
- Logs `geoloc: Timeout expired` throttlés à 1× par session par hook (`useLiveLocation`, `useOnDemandLocationPublish`, `useGeofenceAlert`) — évite la pollution du buffer ring du `bugReporter`.

### Restant prioritaire
1. Phase 2 cours d'eau (atténuation par segment) — Eugénie
2. Refonte clôtures/espaces — Eugénie (gros chantier à arbitrer)
3. Migration des `water_natural` ponctuels existants → `water_stream` polyline
4. Découpe de Map.tsx (5153 lignes) en sous-composants visuels
5. ~~`useLocationCore()` unifié pour remplacer les 3 `watchPosition()` parallèles~~ ✅ FAIT (services/location/locationCore.ts)

---

## SESSION DU 22 MAI 2026 — fixes UX mode édition tracé (P1-P7 Nils)

### Carte — détection de clic en mode édition (P1+P2)
- Nouveau composant `FenceEditHitDetector` qui calcule la distance pixel du clic à chaque cible (poteau réel + "+" ghost) et la plus proche gagne (priorité Blender). Avant : priorité statique par z-index qui masquait systématiquement les "+" dans la zone de chevauchement des hitbox.
- `EDIT_HITBOX_PX` bumpé de 44 → 60 px (cible plus confortable au doigt, sans conflit grâce au détecteur).
- Ghosts "+" passent en `interactive={false}` → leurs clics traversent au map-level handler.

### Carte — guard mode édition sur water_stream (P3)
- Les segments `Polyline` water_stream gardés par `if (!anyModeActive)` (aligné avec landPlotPins). Avant : clic sur cours d'eau en mode édition → `setSelected(stream)` → l'utilisateur sortait du mode édition contre son gré.

### Carte — diagnostic explicite quand le scindage espace échoue (P4)
- Nouvelle fonction `diagnoseSplitFailure()` dans `services/map/polygon-split.ts` : retourne le land_plot avec le near-miss le plus informatif (priorité degenerate → same-edge → too-many → single).
- Branchée dans `saveFence()` : si la clôture touche un espace mais ne le scinde pas, `confirm()` explique pourquoi et propose de créer la clôture par-dessus quand même. Avant : refus silencieux → "j'ai tout essayé, ça veut pas, je sais pas pourquoi".

### Carte — fermeture explicite des clôtures en mode manuel (P5)
- Nouveau `FENCE_CLOSE_RADIUS_PX = 24` (vs SNAP_RADIUS_PX = 44) : l'auto-fermeture exige désormais un tap franc sur le 1ᵉʳ poteau. Plus de fermeture accidentelle des petits parcs.
- Nouveau bouton explicite **🔒 Fermer** dans le toolbar manuel quand ≥ 3 points (mirror du mode auto).
- Tooltip "Terminer →" clarifié : *"clôture ouverte, en ligne"*.

### Carte — rayon de sélection des fils plus serré (P6)
- Nouveau `FENCE_SELECT_RADIUS_PX = 22` (vs 44) pour la proximité segment d'une clôture. Avant : cliquer en plein centre d'un enclos fermé tombait sur le fil. Les pins (eau, batterie, todo…) gardent leur rayon généreux de 44 px.

### Carte — changer le fil sur une portion en mode édition (P7) — FEATURE
- Nouvelle UX : en mode édition d'une clôture, tap sur 2 poteaux → portion sélectionnée (anneaux violets), bouton **🎨 Changer le fil**.
- Modal de choix de preset → `applyPresetToRange()` écrit Firestore avec la même mécanique que `splitFence` (parent → `fillOnly` ou supprimé selon fermé/ouvert).
- Remplace fonctionnellement le ciseau pour le cas le plus fréquent ("de ce poteau-ci à ce poteau-là, utilise tel fil"). Le ciseau reste accessible si on veut couper à un endroit précis (entre 2 poteaux).
- Détails techniques :
  - State : `editRangeStart`, `editRangeEnd`, `editRangePresetVisible`, `editRangeApplying`
  - Visuel : `SELECTED_POST_RING_ICON` rendu par-dessus les poteaux sélectionnés (`interactive=false`, `zIndexOffset=150`)
  - Indices auto-recalibrés quand un "+" est inséré (shift +1 sur les bornes > afterIdx). Invalidés (clear) quand un poteau est supprimé via dblclick.

### Communication
- 1 annonce broadcast publiée (id `2026-05-22-edition-trace-fixes`) résumant les 7 améliorations pour les utilisatrices.

### Déploiement
- 3 commits poussés sur main : `dc10580` (fixes P1-P7), `7998b20` (annonce). Pré-existant non poussé : `d294db2`.
- Hosting déployé 2× (le-cazal.web.app). HTTP 200 confirmé post-deploy.

### Restant prioritaire (inchangé)
1. ~~Phase 2 cours d'eau (atténuation par segment)~~ — fait dans une session précédente
2. ~~Refonte clôtures/espaces~~ — fait dans une session précédente (S2-S9)
3. Migration des `water_natural` ponctuels existants → `water_stream` polyline (le user le fait à la main)
4. Découpe de Map.tsx (5500+ lignes désormais) en sous-composants visuels
5. ~~`useLocationCore()` unifié pour remplacer les 3 `watchPosition()` parallèles~~ ✅ FAIT (services/location/locationCore.ts)

---

## SESSION DU 23 MAI 2026 — traitement BUGV2 (11 bugs) + quick wins + top 3

### Lot 1 : 11 bugs du rapport BUGV2.json (commit `e33cbe2`)
- **#9** Erreur "Nested arrays" zone vide : holes wrappés en `{ points: LatLng[] }[]` côté stockage (types + Map.tsx + helpers).
- **#8** Modif emoji animal : sélecteur race ajouté dans l'onglet Identité Admin (l'emoji est dérivé de l'espèce). Save aussi sur Enter pour le nom.
- **#13** Visuel "tâche faite" : bandeau vert + liseré meadow + ligne "Fait il y a X min · Nils" dans Tasks.tsx.
- **#3** Section "Aide occasionnelle" Admin masquée (doublon avec codes d'accès). Bouton "Date custom" ajouté au form de code temporaire (date d'expiration libre).
- **#11** Historique mouvements : date+heure exactes, chips parc source/dest, note libre.
- **#6** Densité emojis par zoom : 3 paliers (≥17 noms, ≥15 compteurs, ≥13 chiffre, <13 rien).
- **#10** Cours d'eau : épingle 🏞️ supprimée pour les streams tracés, hitbox invisible weight 22, bouton "Tout effacer" sur atténuations (refonte UX complète à faire plus tard).
- **#12** Clôture électrique : animation CSS "marching ants" (`.fence-electric-flow`) sur fences sous tension, conditionnelle au zoom ≥15 + bandeau ⚡ au form de création.
- **#2** Snap bidirectionnel : le mode "Définir un espace" snappe désormais sur fence vertices + autres land_plots (avant uniquement le mode clôture snappait sur les espaces).
- **#4** + **#7** Refonte mode édition : toolbar avec 4 modes explicites (✋ Déplacer / ➕ Ajouter / ✖ Supprimer / ✂ Découper). Un seul comportement par tap. Bouton "Couper" global masqué — intégré comme sous-mode "Découper".
- **#1** + **#5** (perf/écran qui saute) : hypothèse — résolus par #9 (state corrompu après save raté du hole). À confirmer en live.

### Lot 2 : 5 quick wins (commits `3010b69`, `16be780`, `17df4d4`, `a6e19ac`)
- **Favicon** : cache-bust `?v=2` + balises shortcut/Edge ajoutées (bug Eugénie 19/05 jamais traité — Chrome cachait l'ancien favicon Vite).
- **FCM AbortError silencieux** : 15/18 bug reports en moins polluent les logs. Helper `isExpectedFcmUnavailable()` dans `useMessaging.ts`, console.warn supprimés pour les cas attendus.
- **MONTHS_FR off-by-one** : streamActiveMonths stocke 1-12, fix `MONTHS_FR[m - 1]` dans WaterStreamPanel.tsx (commentaire d'origine "à fixer hors S1" enfin traité).
- **Audit where + orderBy** : 2 occurrences trouvées, toutes saines (Bugs.tsx orderBy sans where + commentaire AnimalDetail.tsx).
- **Cleanup tempUsers** : section "Aide occasionnelle" supprimée définitivement, state + useEffect + handlers + type TempUser + entrée backup retirés (~130 lignes en moins). `scissorMode` reste masqué derrière `{false && (...)}` — à supprimer dans 1 semaine après validation prod refonte édition.

### Lot 3 : Top 3 moyen terme (commits `9e4da90`, `182a991`, `9be3175`)
- **Pastilles santé sur la map** (demande Chacha 19/05 jamais traitée, bug.json #3). 3 niveaux selon zoom : ≥17 pastille par animal à côté du nom, ≥15 badge "⚠N" dans le compteur, ≥13 point coloré à côté du chiffre. Utilise les seuils existants de `services/map/health.ts`.
- **Audit isTemp défense en profondeur** : 30 fonctions guardées (20 Map.tsx via helper `assertRegularUser()`, 10 réparties Tasks/AnimalDetail/Bugs/AnimalPhotos). Admin.tsx skip (protégé par AdminRoute), Grazing sous-composants skip (UI parent gardée). Si bug UI futur expose une action regular-only à un temp, plus de unhandledrejection en console.
- **Perf Map.tsx useMemo** : `overduePins`, `fencePins`, `landPlotPins`, `nonFencePins` ne recomputent plus à chaque render — uniquement quand `pins` change. Découverte annexe : la consolidation watchPosition (piège n°10 ONBOARDING) est déjà faite via `useLocationCore` — ONBOARDING + ARCHITECTURE + REFACTOR_PLAN mis à jour.

### Lot 4 : Backup Firestore automatique (pas de commit nouveau)
- Workflow `.github/workflows/backup-firestore.yml` + script `scripts/backup-firestore.cjs` déjà en place depuis le 21/05 mais jamais exécuté (premier dimanche programmé = demain 24/05 04:00 UTC).
- Test local validé : **216 documents, 11.73 MB** sauvegardés. 39 animaux, 19 tâches, 74 pins, 6 users, 5 bug reports.
- Pour déclencher un test manuel : GitHub → Actions → backup-firestore → "Run workflow".
- Backups stockés en artifacts GitHub (rétention 90 jours, gratuit).

### Métriques de la session
- **8 commits** poussés sur main, déployés sur https://le-cazal.web.app
- **+560 / −250** lignes nettes en code applicatif
- **0 régression tsc/build** sur tous les commits intermédiaires
- BUGV2 traité à 100% (11/11 bugs codés, hypothèses #1+#5 pendantes)

### Restant prioritaire pour la prochaine session
1. **Cleanup `scissorMode`** (~150 lignes Map.tsx) — après ~1 semaine de prod sur la nouvelle UX édition sans bug
2. **Vraie refonte UX atténuation streams** (tap sur ruisseau → menu plutôt que sélection par index)
3. **Mobile-first audit** des 8 pages en 432×865 (boutons <44px, ellipses, scroll clavier)
4. **Tests Playwright** sur 3-4 flows critiques (REFACTOR_PLAN.md TODO existant)
5. Découpe Map.tsx (5500+ lignes) en sous-composants visuels (panel enclos, historique, photos…)
6. Migration `water_natural` ponctuels → `water_stream` (Nils le fait à la main)

---

*Dernière mise à jour : 23 mai 2026*
