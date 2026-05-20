# Onboarding IA — Projet Ferme Stinglhamber

**Tu viens d'arriver sur ce projet. Lis ce fichier en entier avant d'écrire la moindre ligne de code.** Il contient tout ce qu'il faut pour ne pas casser ce qui marche.

---

## 1. Ce que tu dois lire dans cet ordre

| Ordre | Fichier | Pourquoi |
|---|---|---|
| 1 | **ONBOARDING.md** | Ce fichier — comment travailler ici |
| 2 | **ARCHITECTURE.md** | Carte du codebase (5 min de lecture) |
| 3 | **RUNBOOK.md** | Commandes pratiques (deploy, debug, backup) |
| 4 | **REFACTOR_PLAN.md** | Chantiers de consolidation en cours |
| 5 | **AVANCEMENT.md** | Journal chronologique des features (historique riche) |

Ne saute pas l'étape 2. Map.tsx fait 4400 lignes — sans la carte tu vas te perdre.

---

## 2. Le contexte business qui change tout

### Qui
- **3 utilisatrices Android** : Eugénie, Benoît, Chacha (ferme familiale Stinglhamber, Ariège).
- Plus 1-2 aides temporaires occasionnelles via codes d'accès.
- 24 ânes + 13 chevaux. Pas de moutons, pas de bovins.
- L'app remplit aujourd'hui leurs attentes — ne casse pas.

### Contraintes inviolables
- **Budget : 0 €/mois absolu.** Aucune carte bancaire n'est entrée nulle part.
- **Plan Firebase : Spark gratuit.** Le user a EXPLICITEMENT refusé Blaze. Ne le suggère pas.
- **Cloud Functions v2 : IMPOSSIBLE à redéployer.** Cloud Build nécessite Blaze. Le code dans `functions/src/index.ts` existe mais le scan FCM réel est fait ailleurs (cf. §4).
- **Tout en français** dans l'UI et les messages d'erreur. Code en anglais.
- **Tout en mode offline-first.** Workbox + Firestore IndexedDB. Casse rien là-dessus.

### Tech stack rappel
React 19 + TypeScript + Tailwind v4 + Vite + Leaflet IGN + Firebase (Auth / Firestore / Messaging) + Workbox PWA. Hébergement Firebase Hosting (`le-cazal.web.app`). Cron via GitHub Actions Free tier.

---

## 3. Comment l'utilisateur travaille avec toi

### Préférences observées
- **Tutoiement systématique**, ton direct, pas de flatterie creuse.
- **Autonomie déléguée** : il dit souvent "pleine autonomie, fais-toi confiance", mais avec un garde-fou strict "ne casse rien". Prends-le au sérieux.
- **Rapport en fin de session** : récap clair de ce qui a été fait, ce qui reste, ce qui est risqué.
- **Mockups ASCII** appréciés pour visualiser des changements UI avant implémentation.
- **AskUserQuestion** avec previews et options multiples : il choisit volontiers quand on lui propose une liste structurée.

### Fréquence des commits côté utilisateur
**Il commit rarement.** Il accumule souvent 1+ semaine de modifications dans le working tree avant de tout commit en bloc. Tu vas donc régulièrement arriver avec :
- 15-20 fichiers en `M` (modifiés)
- 5-10 fichiers en `??` (untracked, nouvelles features)
- Plusieurs `bug.json` / `ferme-bugs-*.json` (exports debug, à laisser tels quels — ils sont gitignored)

**Ne fais JAMAIS de revert global sans avoir vérifié ce qu'il y a dedans.** Voir §5 piège n°1.

### Quand il dit "fais en autonomie"
Tu peux :
- Créer de nouveaux fichiers librement
- Faire des commits atomiques avec ton co-author
- Push sur main directement
- Déployer (avec son OK explicite avant)

Tu ne dois jamais :
- Toucher les Firestore rules sans qu'il valide la version
- Inclure ses modifs non commitées dans un commit "consolidation" sans avoir DIT que tu le fais
- Renvoyer des liens vers Blaze, Sentry payant, ou autre service payant
- Faire des `--force`, `git push -f`, `git reset --hard`, `firebase deploy --force`
- Spawner des sous-agents pour des tâches que tu peux faire toi-même (coûteux et peu utile)

---

## 4. Architecture FCM actuelle (important — différente de ce que disent les Cloud Functions)

```
GitHub Actions (free tier 2000 min/mois)
       │
       │ */5 min via cron natif
       ▼
cron/notify.cjs (firebase-admin + service account dans GitHub Secrets)
       │
       ├── Lecture Firestore (tasks, map_pins, users…)
       └── Envoi FCM via messaging.send()
```

- **Secret GitHub : `FIREBASE_SERVICE_ACCOUNT`** (JSON service account complet).
- **Workflow : `.github/workflows/notify.yml`**.
- Logs visibles sur https://github.com/fogere/ferm-cazal/actions

### La Cloud Function `checkReminders` (legacy)
- Existe encore dans `functions/src/index.ts`.
- Déployée à un moment où le projet était sur Blaze, **on ne peut plus la redéployer aujourd'hui**.
- Tourne peut-être encore (si cron-job.org la frappe), mais avec son code obsolète (ancien, sans le mode broadcast).
- **Pas dangereuse** : les anti-doublons `reminderSentAt` / `broadcastNotifiedAt` évitent les doubles notifs.
- **Pour ajouter une nouvelle notif récurrente, c'est dans `cron/notify.cjs`, pas dans la Cloud Function.**

---

## 5. Les 5 pièges majeurs où je suis tombé (ne refais pas la même erreur)

### Piège n°1 — `git checkout HEAD -- file` destructeur
**Je l'ai fait, j'ai écrasé ~1 semaine de modifs utilisateur sur 3 fichiers.** Récupéré in extremis avec `git fsck --lost-found` qui contenait les blobs perdus.

**Règle** : avant `git checkout HEAD --`, `git stash`, `git reset --hard`, vérifier :
```sh
git diff HEAD -- <file>      # ce qui va disparaître
git status --short            # vue d'ensemble
```
Si tu vois des modifs `M` ou des fichiers `??` que tu ne reconnais pas → STOP. Demande à l'utilisateur. Ne pars JAMAIS du principe qu'il a commité.

### Piège n°2 — Index Firestore composites manquants
Toute query `where(X).orderBy(Y)` avec X ≠ Y exige un index composite Firestore. Sinon `failed-precondition` au runtime, et la query plante silencieusement côté client (juste un warning console).

**Règle adoptée dans tout le projet** : `where()` seul, tri côté client (`.sort()`). Pas d'`orderBy()` après `where()`.

Cas réel rencontré : `query(collection(db, 'animal_care'), where('animalId', '==', id), orderBy('date', 'desc'))` cassait la fiche animal d'Eugénie. Fix : retirer l'`orderBy`, trier après.

### Piège n°3 — React Compiler ESLint (48 warnings)
`npx eslint` retourne 48 "errors" stricts du React Compiler : "Cannot call impure function during render", "Calling setState synchronously within an effect", etc.

**Ce sont des FAUX POSITIFS pour le code actuel.** L'app marche. Ces règles existent pour préparer le React Compiler quand on l'activera (jamais aujourd'hui). Si tu touches les composants pour "fixer" ces warnings, tu vas casser des fonctionnalités. Ignore-les sauf demande explicite.

### Piège n°4 — Helpers déjà extraits, ne pas dupliquer
Tu vas être tenté de réécrire :
- `pointInPolygon` → existe dans `app/src/services/map/geometry.ts`
- `dateInputToTs`, `tsToDateInput`, `formatAgo`, `timeAgo`, `timeUntil` → `services/map/time.ts`
- `healthFreshness`, `healthDotClass` → `services/map/health.ts`

Import depuis là. Ne crée pas une copie locale.

### Piège n°5 — Permissions Firestore pour les aides temp (`isTemp`)
Une aide temporaire (auth anonyme + `tempSessions` valide) ne peut PAS :
- Supprimer des pins (`map_pins`)
- Créer/modifier des tâches
- Saisir des soins ou des mesures
- Écrire dans `reserves` (à part `updatedAt`)

**Chaque flow d'écriture doit guardrail avec `if (isTemp) return` AVANT le batch.** Sinon l'utilisateur tombe sur un `Missing or insufficient permissions` remonté en `unhandledrejection` (vu plusieurs fois dans les bug reports).

---

## 6. Workflow de modification — checklist

### Avant de modifier
```sh
git status                                      # état du working tree
git log --oneline -10                            # contexte récent
cd app && npx tsc --noEmit -p tsconfig.app.json # baseline verte ?
```

### Pendant la modif
1. Edits ciblés. Pas de `replace_all` sur des chaînes vagues.
2. Préférer **ajouter** un nouveau fichier plutôt que modifier un existant lourd (Map.tsx, Admin.tsx).
3. Si tu modifies un fichier en `M` : sache que tu te superposes aux modifs utilisateur. Vérifie le diff avant.
4. Refacto ? Lis [REFACTOR_PLAN.md](REFACTOR_PLAN.md) — règle d'or : **behavior-preserving**.

### Avant un commit
```sh
cd app && npx tsc --noEmit -p tsconfig.app.json   # exit 0
cd app && npm run build                            # exit 0
firebase deploy --only firestore:rules --dry-run   # exit 0
```

### Format du commit
```
type(scope): résumé impératif court

Description détaillée si nécessaire — 1-3 paragraphes.
Liste à puces pour les changements multiples.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```
Types utilisés : `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`.

### Avant un déploiement
**Demander explicitement OK** à l'utilisateur. Les commandes safe :
```sh
firebase deploy --only firestore:rules,hosting
git push origin main
```
**Ne JAMAIS lancer** `firebase deploy --only functions` — ça plante avec une erreur Blaze.

---

## 7. Ce qui n'est PAS dans le projet (et qui ne doit pas l'être)

- ❌ Sentry, LogRocket, Datadog, et autres outils de monitoring payants
- ❌ Bibliothèques de tests (Jest, Vitest, Playwright) — pas installées, sujet à reprendre quand un vrai besoin émerge
- ❌ State manager (Redux, Zustand) — useState + Context suffisent
- ❌ CSS-in-JS — tout est Tailwind utility
- ❌ TypeScript `strict: true` — actuellement seulement `noUnusedLocals`. Si tu actives strict, prévois 2-3 j de cleanup

---

## 8. Ce sur quoi un user va te demander de travailler en priorité

D'après l'historique récent, les demandes typiques :
1. **Traiter des bug reports** (collection Firestore `bugReports` + fichiers `bug.json` / `ferme-bugs-*.json` exportés à la racine).
2. **Ajouter des features de gestion animalière** (santé, croissance, généalogie, pâturage, reproduction).
3. **Corriger des bugs reportés en français approximatif** (le user laisse les utilisatrices écrire sans corriger l'orthographe).
4. **Optimiser** (réduire les écritures Firestore, fluidifier l'UI).

Le user décode lui-même les bugs et te dit "voilà ce qu'il faut faire". Pose-lui des questions précises s'il y a ambiguïté.

---

## 9. Snapshot — au moment où j'ai écrit ce fichier (20/05/2026)

- **Branche `main`** à jour sur GitHub.
- **App live** : https://le-cazal.web.app (déployée avec les features de la semaine).
- **Firestore rules** : à jour (`app/firestore.rules`).
- **Cloud Function `checkReminders`** : version obsolète déployée, inoffensive.
- **Cron GitHub Actions** : opérationnel, scanne toutes les 5 min via `cron/notify.cjs`.
- **Backup Firestore** : script prêt (`scripts/backup-firestore.cjs`), à activer manuellement par l'utilisateur.
- **Working tree** : propre (à part les exports de bug reports gitignored).

---

## 10. Comment tu finis ta session

1. Récap clair en 3-5 bullets : ce que tu as fait, ce qui est bloqué, ce qui reste.
2. Tag tes commits avec `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
3. Si tu as changé l'architecture ou découvert un nouveau piège : **édite ce fichier** pour la prochaine IA. C'est le seul moyen que le savoir ne se perde pas.
4. N'oublie pas que la prochaine IA arrivera **froide**, sans contexte de cette session. Tout ce qui n'est pas dans un .md sera perdu.

Bonne route.
