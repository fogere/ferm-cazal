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
- **Session S3 (migration --execute en prod)** :
  - Backup manuel `backups/firestore-backup-2026-05-21.json` (7.92 MB)
  - Dry-run + audit OK puis `--execute` : 85 writes appliquées
  - 8 land_plots créés, 39 animaux redirigés, 30 mouvements redirigés
  - 8 fences marqués `migratedToPlotId` (audit + idempotence)
  - Fix critique S2.5+ (commit 68611af) : 3 sites de rendu (label animaux,
    computeGrazingStatus, formulaire placement) utilisent maintenant
    effectiveEnclosureId — sans ça les enclos migrés s'affichaient vides

- **Session S5 (finitions refonte clôtures/espaces)** :
  - S5.1 : `useGeofenceAlert` détecte maintenant sur les `land_plot` (avec
    exclusion des holes via `pointInPolygonWithHoles`). Fallback rétrocompat
    pour les fences fermés non migrés.
  - S5.2 : snap auto du tracé clôture sur les contours land_plot (tip n°1
    Eugénie). Le `mousemove` et le `click` snappent sur les points outer ET
    les holes. Rayon SNAP_RADIUS_PX = 44 px.
  - S5.3 : Grazing.tsx — helper `isEnclosureCandidate` qui sélectionne les
    pins éligibles à recevoir des animaux (land_plot ≥3 pts + fences fermés
    non migrés en fallback). Les modales AddMovement et PasteImport sont
    alimentées par ce filtre au lieu de `pins.filter(p => p.type === 'fence')`.
  - S5.4 : 2 annonces in-app (Eugénie + broadcast) expliquant le nouveau
    workflow et rassurant les utilisatrices que rien n'est perdu.

- **Session S4 (UX espaces — pleine refonte côté utilisateur)** :
  - S4.2 : rendu visuel des land_plots autonomes en Polygon vert clair,
    tap pour sélection. Les jumeaux (migrés) restent invisibles côté
    map (couverts par leur fence) — accessibles via S4.5.
  - S4.3 : nouveau mode "⛰ Espace" dans la barre du bas. Tap pour tracer
    point par point + auto-fermeture en tap sur 1er point ou bouton
    "Valider". Modal de saisie du nom → addDoc map_pins type='land_plot'.
  - S4.4 : LandPlotPanel — header (surface via polygonAreaSquareMeters,
    nb points, nb holes) + EnclosurePlacementPanel réutilisé via prop
    `isEnclosed` (toujours true pour un plot valide).
  - S4.5 : bouton "→ Voir l'espace défini" en tête du FencePanel quand
    `pin.migratedToPlotId` existe → setSelected(plot jumeau).
  - S4.6 : outil "+ Zone vide intérieure" (donut polygon). Toolbar orange,
    tracé point par point, sauvegarde immédiate via `landplot.holes[]`.
    UI : liste des zones avec bouton Supprimer + bouton "+ Ajouter".
  - S4.7 : rendu Polygon avec holes via Leaflet `[outer, ...holes]`.

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
