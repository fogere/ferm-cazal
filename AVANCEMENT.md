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
5. `useLocationCore()` unifié pour remplacer les 3 `watchPosition()` parallèles

---

*Dernière mise à jour : 21 mai 2026*
