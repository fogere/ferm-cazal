# Runbook — Projet Ferme Stinglhamber

Commandes courantes pour deploy, debug, dépannage. À utiliser depuis la racine du repo (`projet farm/`).

---

## ⚠️ Si tu te perds

1. **Quelle branche, quel état ?** → `git status` + `git log --oneline -10`
2. **Tu es au bon endroit ?** → tu dois être dans `c:\Users\Administrator\Downloads\projet farm` pour les commandes Firebase
3. **Quel projet Firebase ?** → `firebase use` (doit afficher `le-cazal`)

---

## Déploiement

### Tout déployer
```cmd
cd /d "C:\Users\Administrator\Downloads\projet farm"
cd app && npm run build && cd ..
firebase deploy
```

### Déployer juste l'app web
```cmd
cd /d "C:\Users\Administrator\Downloads\projet farm\app"
npm run build
cd ..
firebase deploy --only hosting
```

Les utilisateurs verront la bannière "Mise à jour disponible" automatiquement à leur prochain chargement.

### Déployer juste les rules
```cmd
cd /d "C:\Users\Administrator\Downloads\projet farm"
firebase deploy --only firestore:rules
```

### Déployer juste les Cloud Functions
```cmd
cd /d "C:\Users\Administrator\Downloads\projet farm"
firebase deploy --only functions
```

---

## Dev local

### Lancer l'app en mode dev
```cmd
cd /d "C:\Users\Administrator\Downloads\projet farm\app"
npm run dev
```
Vite ouvre `http://localhost:5173`. Hot reload actif. Le service worker n'est PAS actif en dev (pour ne pas cacher les modifs).

### Vérifier que TypeScript compile sans erreur
```cmd
cd /d "C:\Users\Administrator\Downloads\projet farm\app"
npx tsc --noEmit -p tsconfig.app.json
```
Si exit code 0 → tout est OK.

### Vérifier que le build production passe
```cmd
cd /d "C:\Users\Administrator\Downloads\projet farm\app"
npm run build
```

---

## Debug d'un bug remonté par un utilisateur

### Les bugs sont stockés où ?
- Dans Firestore, collection `bugReports`
- Visibles dans l'app sur la page **`/bugs`** (visible par tous les regulars)

### Reproduire un bug
Le rapport contient :
- `userActions` : navigation entre pages, derniers clics
- `consoleEntries` : 10 derniers logs/warnings/errors avec timestamps
- `description` : ce que l'utilisateur a tapé
- `url`, `viewport`, `userAgent` : contexte technique

### Exporter tous les bugs en JSON pour analyse
Dans Firebase Console → Firestore → bugReports → export collection.

### Erreur "Missing or insufficient permissions"
- Vérifier les rules dans `app/firestore.rules`
- Identifier qui a fait l'action (regular ou aide temp)
- Souvent : une aide tente une opération réservée aux regulars (delete pin, write reserve, etc.)
- Fix : guardrail `if (isTemp) return` côté client + message clair

### Erreur "failed-precondition" sur une query Firestore
Cause : combinaison `where + orderBy` sur champs différents → exige un index composite.
Fix : supprimer le `orderBy` et trier côté client (cf [ARCHITECTURE.md — pièges](./ARCHITECTURE.md)).

### Erreur FCM "AbortError: Registration failed"
- Sur ce device, push service Google a refusé la souscription
- Solution utilisateur : aller dans Settings → "Réactiver les notifications push"
- Le code fait déjà un unsubscribe + retry automatique au mount, mais ça suffit pas toujours
- En dernier recours : désinstaller la PWA puis réinstaller

---

## Cron job (rappels)

### Configurer cron-job.org
URL à appeler toutes les 30 min :
```
https://europe-west1-le-cazal.cloudfunctions.net/checkReminders?key=SECRET_CRON_KEY
```
Le secret doit matcher la variable d'environnement `CRON_SECRET` côté Functions.

### Configurer le secret côté Functions
```cmd
cd /d "C:\Users\Administrator\Downloads\projet farm"
firebase functions:secrets:set CRON_SECRET
```
(Puis re-deploy les functions.)

### Tester le cron manuellement
Ouvre dans le navigateur :
```
https://europe-west1-le-cazal.cloudfunctions.net/checkReminders?key=TON_SECRET
```
Tu dois voir un JSON `{"ok":true,"waterReminders":0,"errors":0,...}`.

### Logs des Cloud Functions
```cmd
firebase functions:log --only checkReminders
```
Ou dans Firebase Console → Functions → checkReminders → Logs.

---

## Données Firestore

### Voir les données en live
Firebase Console → Firestore Database → onglet "Data".

### Lire/écrire en CLI (besoin de gcloud)
```cmd
gcloud firestore export gs://le-cazal-backup/$(date +%Y%m%d)
```
(Pour le backup — pas encore configuré, à mettre en place.)

### Reset un user FCM token
Firebase Console → Firestore → users → {uid} → effacer le champ `fcmToken`.
L'utilisateur devra cliquer "Réactiver les notifications push" dans Settings.

### Voir les utilisateurs temporaires actifs
Collection `tempSessions` : 1 doc par session. `expiresAt` indique la fin.
Collection `tempCodes` : les codes générés depuis Admin.
Collection `tempUsers` : profils des aides.

---

## Gotchas connus

### Le service worker garde une vieille version
Si après deploy les utilisateurs ne voient pas la nouvelle UI :
1. Le composant `UpdatePrompt.tsx` doit s'afficher automatiquement
2. Si bloqué, demander à l'utilisateur de fermer/rouvrir l'app
3. En dernier recours : DevTools → Application → Service Workers → Unregister

### Les tuiles IGN ne chargent pas
- Vérifier que `data.geopf.fr` est dans `connect-src` du CSP (firebase.json)
- Si le cache est saturé (5 Go) le quotaPlugin refuse les nouvelles → utilisateur en mode "déjà vu"
- Reset cache : DevTools → Application → Storage → Clear site data

### Variables d'env Vite vs SW
`import.meta.env.VITE_*` ne passe PAS dans `sw.ts` (généré séparément).
Donc les clés Firebase sont hard-codées dans `sw.ts:26-33`. Si on change de projet Firebase il FAUT modifier ce fichier aussi.

---

## Sécurité

### Rotation des clés
Si une clé Firebase fuite (rare car limitée par les rules Firestore) :
1. Régénérer dans Firebase Console → Project Settings → General
2. Mettre à jour `.env` ET `app/src/sw.ts`
3. Re-build + re-deploy

### Comptes super-admin
Définis en dur dans `app/src/pages/Tasks.tsx` (`SUPER_ADMIN_NAMES`). Modifier la liste là.

---

## Commandes de la vie quotidienne

| Action | Commande |
|---|---|
| Voir l'app en local | `cd app && npm run dev` |
| Voir les logs cron | `firebase functions:log --only checkReminders` |
| Build + deploy tout | `cd app && npm run build && cd .. && firebase deploy` |
| Voir les bugs reportés | Ouvre `/bugs` dans l'app |
| Forcer un user à re-FCM | Settings → Réactiver les notifications push |
| Rules ne s'appliquent pas | `firebase deploy --only firestore:rules` |
