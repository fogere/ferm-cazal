# Plan de refactorisation — autonomie déléguée

Document interne. Quand l'utilisateur me confie la consolidation du code, je travaille ici.
Règle absolue : **aucune modif qui change un comportement utilisateur**. Que de la consolidation, des extractions, des docs, des tests, du monitoring.

## Principes

1. **Behavior-preserving** : si un user faisait X avant et tape sur le bouton, X doit toujours arriver après.
2. **Petits commits atomiques** : chaque commit doit être trivialement reversible avec `git revert`.
3. **Build vert** : après chaque commit, `tsc --noEmit` + `npm run build` doivent rester à exit 0.
4. **Pas d'invention** : si je ne suis pas sûr à 100% qu'une refacto est neutre, je la commit pas.
5. **Pas de fichiers .md "plan" qui pourrissent** : ce document évolue mais reste court.

## Travail en cours / planifié

### ✅ Fait
- ARCHITECTURE.md (carte du projet)
- RUNBOOK.md (commandes de la vie quotidienne)
- Suppression `AnimalSheetModal.tsx` (orphelin confirmé)
- **Session S2 (modèle + script de migration)** :
  - Type `land_plot` ajouté à `PinType` + champs `holes`, `parentPlotId`, `migratedToPlotId` sur `MapPin`
  - `PIN_CFG.land_plot` ajouté à Map.tsx (visuel par défaut : ⛰ vert clair — sera affiné en S4)
  - `scripts/migrate-fence-to-landplot.cjs` créé :
    - Mode **dry-run par défaut**, **--execute** pour appliquer
    - Crée un land_plot jumeau pour chaque fence (closed + rôle d'enclos actif)
    - Redirige `animal.enclosureId` + `enclosure_movements.from/toEnclosureId`
    - Idempotent (skip les fences avec `migratedToPlotId` déjà présent)
    - Mode `writeBatch` par paquets de 450 writes max (limite Firestore)
  - Pas de modif des Firestore rules nécessaire (le script utilise un service account)
  - **Le script n'est PAS encore lancé** — S3 fera ça après backup manuel.

- **Session S1 (refacto Map.tsx avant refonte clôtures/espaces)** — 6 sous-extractions :
  - `pages/map/panels/shared.tsx` (DetailRow + BATTERY_STATUS_CFG)
  - `pages/map/panels/WaterManualPanel.tsx`
  - `pages/map/panels/WaterStreamPanel.tsx`
  - `pages/map/panels/BatteryPanel.tsx`
  - `pages/map/panels/FencePanel.tsx` (config — sans enclosure)
  - `pages/map/panels/EnclosurePlacementPanel.tsx` (placement + historique)
  - `services/map/water.ts` (isWaterOverdue)
  - `services/map/battery.ts` (isBatteryDue)
  - `services/map/polygon.ts` (pointInPolygonWithHoles + areaSquareMeters)
  - Map.tsx : 5347 → 4604 lignes (−743). Behavior-preserving strict.

### 🛠 À venir, par ordre de risque croissant

| Tâche | Risque | Gain | Statut |
|---|---|---|---|
| Extraction des helpers purs de Map.tsx (icon makers, geometry) vers `services/map/` | Faible | Lisibilité Map.tsx | À faire |
| Sentry free tier (5k events/mois) pour visibilité prod | Très faible | Visibilité erreurs runtime | À faire |
| Cloud Function backup Firestore hebdomadaire (gs://le-cazal-backup) | Très faible | Sécurité données | À faire |
| Extraction de sous-composants visuels Map.tsx (panneau enclos, historique, photos) | Modéré | Maintenabilité | À faire (plus tard) |
| Hook unifié `useLocationCore()` qui remplace les 3 watchPosition | Modéré | Batterie + clarté | À faire (plus tard) |
| Tests Playwright sur 3-4 flux critiques | Faible | Détection régression | À faire (plus tard) |
| Index Firestore audit complet (queries cachées) | Faible | Robustesse | À faire (plus tard) |

### ❌ NON FAIT volontairement (à laisser tel quel pour l'instant)
- Pas de migration React Router v7 (pas urgent, on est sur v6 stable)
- Pas de migration Tailwind v5 (v4 récente, pas de besoin)
- Pas d'introduction de tests unitaires Vitest (peu de valeur avant l'extraction des helpers purs)

## Format des commits

Préfixes utilisés :
- `docs:` — ajout/modif de fichiers .md
- `chore:` — nettoyage, suppression code mort, déps
- `refactor:` — restructuration sans changement de comportement
- `test:` — ajout de tests
- `ci:` — config GitHub Actions / hooks

Exemples valides :
- `docs: ajouter ARCHITECTURE.md et RUNBOOK.md`
- `chore: supprimer AnimalSheetModal.tsx orphelin`
- `refactor(map): extraire icon makers dans services/map/icons.ts`
- `test(e2e): smoke test du flow login → dashboard`
