# BACKLOG — Ferme Le Cazal

Fichier **unique**. Remplace `V4→V9.json`, `bug*.json`, `ferme-bugs-*.json`.
Source : **59 demandes uniques** dédupliquées depuis 9 exports (18/05 → 21/07/2026),
statut vérifié dans le code (commit ou `fichier:ligne`), pas déduit.
**53 livrées · 6 restantes.**

> **Vision** (Nils, 21/07/2026) : « identifier le travail à faire, voir **concrètement**
> ce qu'il y a à faire, **ne pas être découragé**, avoir une **vision ensemble** sur la ferme. »
> Mobile-first assumé. C'est le critère de tri de toute décision UX.

**Prod au 21/07/2026** (mesuré, service account) : `tasks` **291** (287 faites, **290 échéance passée**) ·
`animals` 41 · `map_pins` 126 · `enclosure_movements` 131 · `pin_photos` 64 · `alerts` 2 ·
`users` 7 (3 avec token FCM) · `bugReports` **0**.

---

## À FAIRE

### Décidé le 21/07/2026 — les 3 prochains chantiers
1. **Notifications** (validé par Nils). Widget d'écran d'accueil **impossible en PWA** —
   vérifié : manifest `widgets` = Windows 11 uniquement, `setAppBadge` non supporté sur
   Android. Le substitut est une **notification riche actionnable** : le cron calcule
   **déjà** la bonne donnée (`notify.cjs:459-504` → tâches du jour, les miennes, les
   libres), il manque les titres et un bouton « Fait ». Sur Android une notif web reste
   dans le tiroir jusqu'au tap et accepte 2 actions → c'est un widget à 90 %.
   ⚠️ Bug à confirmer d'abord : **notifications probablement en double** (le SDK FCM
   affiche, puis `sw.ts:62` réaffiche ; aucun `tag` des deux côtés).
2. **GPS h24** (validé par Nils). À réconcilier avec l'incident « téléphone qui chauffe »
   d'Eugénie (23/05) qui a justifié la coupure sur `document.hidden`. Pistes : Wake Lock
   pendant une session terrain explicite, précision réduite plutôt que fréquence.
   Vérifier d'abord **ce qui chauffait vraiment** : le GPS, ou le repaint des 23 clôtures ?
3. **Touch targets globaux** (« click box »). Généraliser le principe *hitbox large + le
   plus proche gagne*, aujourd'hui présent **uniquement** dans l'édition carte
   (`SNAP_RADIUS_PX=44`). Piège : deux marges qui se chevauchent → c'est l'ordre du DOM
   qui gagne, pas le plus proche. Solution : n'étendre que jusqu'à mi-chemin du voisin.

### ❌ Abandonné — ne pas y revenir
- **Fluidité de la carte.** Nils, 21/07/2026 : « ça sert à rien, c'est impossible,
  crois-moi, ne teste même pas. » Après 3 essais revertés (voir Règles), le sujet est
  **clos**. Ne plus proposer `updateWhenIdle` / `keepBuffer` / `preferCanvas` / MapLibre.
- **Capacitor / APK natif.** Tue le Service Worker → plus de cache de tuiles ni de mise à
  jour automatique. Il faudrait réinstaller un APK à la main sur 4 téléphones à chaque
  correctif. Gelé tant qu'on livre par hosting.

### Fond de tiroir (anciens, partiels)
- **Tâches récurrentes** : perdent l'espace et le point d'eau à l'occurrence suivante →
  recopier les champs liés dans `cron/notify.cjs` (`processRecurringTasks`).
- **Notifications KO** : réparation auto active **seulement** sur Réglages ;
  `useMessaging.ts:85` (`tokenAttempted`) bloque tout nouvel essai après un échec.
- **`permission-denied`** sur les listeners de la carte quand la session expire
  (seul `useUsers.tsx:47` rattrape proprement).
- **Cron trop gourmand** : **891 lectures Firestore par exécution**, dont 868 pour 3 requêtes
  non bornées sur `tasks`. Borner → ~25. Coût croît avec l'historique (34 docs en mai → 291).
  ⚠️ Créer les index composites **avant** de pousser, sinon `notify.cjs:605` fait `exit(1)`.
- **Double notification** : le SDK FCM affiche la notif **puis** appelle `onBackgroundMessage`
  qui en affiche une 2ᵉ. Aucun `tag` des deux côtés (`sw.ts:62`, `notify.cjs:118`). À confirmer sur téléphone.

---

## ACQUIS — 118 commits, 18/05 → 21/07/2026

- **21/07/2026 — les 4 demandes du rapport V9** (déployées) :
  bulle 🐞 flottante **supprimée** (elle recouvrait le bouton « + » de la carte sur
  36 px en `z-[9000]` — bug d'interaction, pas de la cosmétique) → remplacée par
  Réglages → « Signaler un bug » ; header `/alerts` **coloré selon la gravité**
  (vert forêt quand il n'y a rien) ; **groupes d'animaux supprimés** (UI Admin + UI
  carte + champ `config/farm.animalGroups`, sauvegardé dans
  `backups/animalGroups-supprime-2026-07-21.json`) ; **AbortError filtrés** du patch
  fetch. Le type de pin `zone`, déjà mort (absent de `PICKABLE_TYPES`, 0 en prod),
  est parti avec les groupes.

- **Carte · clôtures & espaces** — refonte complète : scission auto d'un espace par une clôture
  (S7, `polygon-split.ts` + `ScindageModal`), **refusion auto à la suppression** (S8),
  affectation des animaux à une moitié, herbe calculée par sous-espace, clôture ouverte
  vs refermée, enclaves, mode édition tracé (7 améliorations), snap 44 px « style Blender ».
- **Carte · tuiles** — proxy Cloudflare `ferme-tiles` (cache edge gratuit), cache SW workbox
  (revisite **1 ms**, prouvé), pré-cache hors-ligne manuel, retry auto des tuiles.
- **Carte · pins** — points d'eau, batteries + voyant ON/OFF, cours d'eau (2 phases),
  photos, atténuation visuelle du fil électrique, priorité au pin sur le parc au clic.
- **Tâches** — timeline « historique des jours », tri alpha, assignation à « tous »,
  heure précise, récurrences.
- **Animaux** — carnet de santé unifié (`CareJournal` + `careConfig`), SIRE/transpondeur,
  mouvements d'enclos (immuables).
- **Notifications** — FCM + cron GitHub Actions (matin + soir), pas de Cloud Function.
- **PWA** — mise à jour forcée (`sw.ts` activate → `client.navigate`), invite d'installation.
- **Bug reports** — capture auto console/navigation/viewport, page `/bugs`, système d'annonces.
- **Admin** — monitoring Firestore **maison** (compteurs reads/writes + jauges quota Spark).
- **Abandonné** — import fiches terrain (retiré le 04/06, commit `3375f3c`). **Ne pas reconstruire.**

---

## RÈGLES À NE JAMAIS OUBLIER

**Argent / infra**
- Firebase **Spark gratuit, 0 € absolu**. Blaze refusé. **Jamais** de Cloud Functions.
- ⚠️ **Jamais `firebase deploy` nu** : `firebase.json` déclare encore `functions` → ça plante.
  Toujours `--only hosting`. **`RUNBOOK.md` documente le contraire — à corriger.**
- Quota : 50 000 lectures/jour. Toute nouvelle feature se chiffre en lectures.

**Carte — pièges payés cher**
- `fadeAnimation={false}` → casse le fallback LOD → **carrés noirs**. Reverté.
- `keepBuffer={8}` → ~600 tuiles → thread principal noyé. Reverté.
- `updateWhenIdle={true}` sur PC → écran noir plus long. Reverté.
  **Mais sur Android c'est DÉJÀ la valeur par défaut** (`Browser.mobile`) : les 3 essais ont
  été jugés sur PC, aucun n'a jamais rien testé sur téléphone.
- `maxNativeZoom = 19` : l'IGN n'a pas de z20. Ne pas remonter.
- Le cache des tuiles est **parfait, prouvé de bout en bout**. Ne jamais le re-chasser :
  le goulot est la **peinture** Leaflet-DOM.

**Données**
- `config/farm` contient aussi `customSpecies` → **jamais** `set`/`delete` sur le doc,
  uniquement `FieldValue.delete()` sur le champ visé. Backup frais avant toute écriture.
- Firestore : `where()` seul + tri client (sinon index composite).
- `le-cazal-service-account.json` (gitignoré) donne un accès Admin réel → **mesurer, pas supposer**.

**Process**
- Nils teste **uniquement en prod**. Construire des tests autonomes, ne pas en faire un testeur manuel.
- **1 changement perf = 1 déploiement = 1 retour** (mieux/pareil/pire). Sinon on reverte à l'aveugle.
- Git : Nils accumule des modifs non commitées. **Jamais** `reset --hard` ni `checkout HEAD --`.
- La page `/bugs` a un bouton « exporter **puis tout supprimer** » → l'export JSON est souvent
  la **seule copie** d'un rapport. Lire avant de purger.
- Pas de monitoring payant (Sentry refusé). Pas de modale d'onboarding/tuto.
