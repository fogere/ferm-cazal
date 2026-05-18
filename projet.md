# FERME NILSLAMBER — Document de fondation complet

> Document de référence permanent. Toute décision de code, de design ou d'architecture
> doit être cohérente avec ce fichier. Mettre à jour ce fichier si quelque chose change.

---

## 1. CONTEXTE ET OBJECTIF

### La ferme
- **Adresse** : 14 Cazals, 09300 Roquefixade, Ariège, France
- **Coordonnées GPS** : 42.93748279091415, 1.7452322229748927
- **Altitude** : entre 508m et 995m, moyenne 752m — zone de montagne pyrénéenne
- **Superficie commune** : 12.3 km²
- **Environnement** : forêts mixtes (chênes, hêtres, sapins), à proximité du Parc naturel régional des Pyrénées ariégeoises
- **Risque incendie** : réel en été (Ariège = 45% de couverture forestière), surveillance nécessaire

### La famille
- **Nom** : Nilslamber (orthographe phonétique, non confirmée officiellement)
- **Père** : actuellement hospitalisé — absent du terrain pour une durée indéterminée
- L'équipe active est donc réduite à 3 personnes principales + occasionnels

### Objectif du logiciel
Fournir un outil de gestion de ferme qui soit **plus bénéfique que demandeur**.
Chaque interaction doit prendre moins de 10 secondes.
Aucune saisie longue. Aucune navigation complexe.
Si l'outil demande plus d'effort qu'il n'en économise, il a échoué.

### Contrainte absolue
**Coût d'hébergement et de fonctionnement : 0€/mois pour les utilisateurs.**
Tous les services utilisés sont dans leur tier gratuit.

---

## 2. UTILISATEURS

### Les 3 utilisateurs permanents
| Prénom | Rôle principal | Profil terrain |
|--------|---------------|----------------|
| **Mathieu** | Administratif, PAC (Politique Agricole Commune), dossiers | Moins présent sur le terrain |
| **Nils** | Référent terrain quotidien : eau, surveillance bien-être, systèmes | Le plus actif physiquement |
| **Eugénie** | Administratif, PAC, dossiers | Moins présente sur le terrain |

Quand c'est physique (taille des sabots, installation systèmes eau, gros travaux) : les 3 ensemble.

### Utilisateurs temporaires / occasionnels
- La famille peut s'agrandir ponctuellement (membres, amis, aide extérieure)
- Ces personnes n'ont **pas de compte Firebase**
- Elles apparaissent uniquement comme **prénom dans le pool de répartition des tâches**
- Ajoutées et retirées manuellement par un utilisateur connecté
- Elles reçoivent leurs informations oralement, pas de notification pour elles

### Comptes Firebase
- 3 comptes créés **manuellement** dans la console Firebase par l'administrateur (le développeur)
- **Aucune inscription publique** n'est possible
- **Aucun autre accès** n'est possible
- Les comptes peuvent être modifiés (mot de passe) depuis la console Firebase

---

## 3. ANIMAUX

### Ânes — 24 au total
| Catégorie | Nombre |
|-----------|--------|
| Mâles | 6 |
| Femelles | 17 |
| Hongres | 1 |
| **Total** | **24** |

### Chevaux — 13 au total
| Catégorie | Nombre |
|-----------|--------|
| Étalon | 1 |
| Hongres | 2 |
| Pouliches | 3 |
| Juments | 7 |
| **Total** | **13** |

### Règles animaux
- Les groupes d'animaux **ne sont pas fixes dans les terrains** — ils tournent
- Ex : le terrain des juments peut accueillir des ânes et vice versa
- La carte doit permettre de modifier **en temps réel** quel groupe occupe quel terrain
- Ces données sont stockées en base et servent à pré-remplir les listes dans toute l'app
- Si un animal arrive ou part, les compteurs sont modifiables manuellement

---

## 4. INFRASTRUCTURE TECHNIQUE

### Connectivité
- **Pas de box wifi** à la ferme
- Chaque utilisateur utilise sa **connexion 4G/5G personnelle** (Bouygues Telecom)
- **Partage de connexion** depuis les téléphones pour les ordinateurs si besoin
- **5G+ constant** — couverture excellente sur toute la propriété
- L'app doit fonctionner sur **connexion mobile uniquement**, jamais dépendre d'un wifi fixe

### Appareils
- **Tous Android** — notifications PWA fonctionnent nativement sans contrainte iOS
- Utilisés sur **téléphone principalement**, parfois PC via partage de connexion

---

## 5. STACK TECHNIQUE — COÛT 0€

| Couche | Technologie | Tier gratuit | Coût |
|--------|-------------|-------------|------|
| Frontend | React + TypeScript | — | 0€ |
| Style | Tailwind CSS | — | 0€ |
| Auth | Firebase Authentication | 10K auth/mois | 0€ |
| Base de données | Firebase Firestore | 1GB, 50K lectures/jour, 20K écritures/jour | 0€ |
| Notifications push | Firebase Cloud Messaging | Illimité | 0€ |
| Hébergement | Firebase Hosting | 10GB stockage, 360MB/jour bande passante | 0€ |
| Carte | Leaflet.js + tuiles IGN | API publique française gratuite | 0€ |
| Météo | Open-Meteo | Illimité, sans clé API | 0€ |
| Vigilance météo | API Météo-France officielle | API publique | 0€ |
| Risque incendie | feuxdeforet.fr / Géorisques | Données ouvertes gouvernementales | 0€ |
| Dépôt code | GitHub | Tier gratuit | 0€ |
| **TOTAL** | | | **0€/mois** |

### Justification Firebase vs GitHub Pages
Firebase Hosting est utilisé (et non GitHub Pages) car :
- Même plateforme que Firestore et Auth — déploiement intégré
- HTTPS automatique
- Headers de sécurité configurables
- Meilleure performance CDN

---

## 6. SÉCURITÉ

### Authentification
- Firebase Auth gère nativement le **blocage progressif** après tentatives échouées
  - 3 tentatives échouées → blocage 1 min → 5 min → 15 min → etc.
- Sessions persistantes sur Android (pas besoin de se reconnecter chaque jour)
- Aucun lien "Créer un compte" sur la page de connexion
- Aucun formulaire d'inscription public

### Anti-bot / Anti-crawl
- `robots.txt` interdit tout crawl
- Headers HTTP de sécurité stricts (Content-Security-Policy, X-Frame-Options, etc.)
- URL non devinable (domaine Firebase aléatoire type `ferme-xxxx.web.app`)
- Le site ne retourne aucune information sans authentification valide

### Règles Firestore
- Les règles de sécurité Firestore interdisent tout accès sans UID Firebase valide
- Chaque utilisateur ne peut modifier que ses propres préférences
- Les données de la ferme sont accessibles à tout utilisateur authentifié
- Aucun accès public en lecture ou écriture

---

## 7. ARCHITECTURE DE L'APPLICATION

### Structure des pages
```
/ (login)
  └── /dashboard          → tableau de bord quotidien
  └── /tasks              → carnet de tâches
  └── /map                → carte interactive de la ferme
  └── /alerts             → alertes actives et historique
  └── /settings           → préférences personnelles (notifications, etc.)
  └── /admin              → gestion utilisateurs temporaires, configuration
```

### PWA (Progressive Web App)
- Installable sur l'écran d'accueil Android comme une vraie app
- Icône personnalisée, ouverture sans barre de navigateur
- Notifications push même app fermée (Firebase Cloud Messaging)
- Mode hors-ligne natif via Firestore cache — les données restent consultables sans réseau

---

## 8. FONCTIONNALITÉS DÉTAILLÉES

---

### 8.1 PAGE DE CONNEXION

- Champ prénom + mot de passe
- Bouton "Entrer"
- Compteur de tentatives visible après la 1ère erreur
- Message d'erreur discret et non informatif ("Identifiants incorrects")
- Aucun lien "Mot de passe oublié" public (passe par l'administrateur Firebase)
- Aucun lien "Créer un compte"

---

### 8.2 TABLEAU DE BORD

Écran principal après connexion. Vision en un coup d'œil de l'état de la journée.

**Contenu :**
- Salutation personnalisée + date du jour
- Météo actuelle (température, icône condition, vent) — Open-Meteo
- Vigilance météo département Ariège (Vert/Jaune/Orange/Rouge) — Météo-France
- Niveau risque incendie Ariège (Faible/Modéré/Élevé/Très élevé) — Géorisques
- Mes tâches du jour (liste cochable directement depuis ici)
- Alertes actives (points d'eau à remplir bientôt, batteries faibles, problèmes signalés)
- Disponibilité du jour : bouton "Oui / Non / Limité" à cocher au réveil

**Règle UX :** tout ce qui est sur ce tableau de bord doit être actionnable en 1 tap.

---

### 8.3 DISPONIBILITÉ QUOTIDIENNE

Chaque matin, à la première ouverture de l'app, popup non-bloquante :
"Es-tu disponible aujourd'hui ?"
- **Disponible** → tâches normales assignées
- **Limité** → moins de tâches assignées (configurable : 50% par défaut)
- **Indisponible** → aucune tâche, redistribution aux autres

Cette info est utilisée par le système de répartition des tâches.
Elle peut être modifiée à tout moment dans la journée.

---

### 8.4 CARNET DE TÂCHES

#### Vue journalière
- Tâches du jour, séparées par personne assignée
- Chaque tâche : description courte, zone/animal concerné, case à cocher
- Cocher = terminé (1 tap)
- Tâche non cochée de la veille : remonte en rouge en haut de la liste
- Les tâches des autres sont visibles en lecture seule (transparence d'équipe)

#### Création d'une tâche
Formulaire minimaliste :
- Texte libre court (obligatoire)
- Zone/animal concerné (liste déroulante — voir section Données)
- Assigné à : liste des personnes disponibles aujourd'hui (ou "Auto")
- Récurrence : Unique / Quotidienne / Hebdomadaire / Personnalisée
- Priorité : Normale / Urgente

#### Répartition automatique
- Chaque matin les tâches récurrentes sont auto-assignées
- Le système calcule un **score de charge** par personne (nombre de tâches dans la semaine)
- Les nouvelles tâches vont vers la personne avec le score le plus bas
- Les personnes marquées "Indisponible" sont exclues
- Les personnes "Limité" reçoivent moitié moins
- Si personne disponible → alerte à tous

#### Visualisation charge
- Graphique simple (barres) en bas du carnet : charge de la semaine par personne
- Permet de voir d'un coup d'œil si la répartition est équitable

---

### 8.5 CARTE INTERACTIVE

#### Fond de carte
- **Leaflet.js** avec tuiles **IGN** (Institut Géographique National)
- Deux couches disponibles, basculables :
  - Vue aérienne (orthophoto) — voir la ferme depuis le ciel
  - Vue cadastrale — voir les parcelles et limites officielles
- Centré automatiquement sur les coordonnées GPS de la ferme au chargement
- Zoom par défaut montrant toute la propriété
- Pinch-to-zoom mobile, molette PC

#### Système d'épingles
Chaque épingle a :
- **Type** (détermine l'icône et la couleur de base)
- **Nom** (ex : "Bac nord", "Ruisseau du bas", "Batterie clôture est")
- **Statut** (détermine la couleur finale de l'épingle)
- **Fiche détaillée** avec tous les champs spécifiques au type
- **Date de dernière modification** + auteur

**Types d'épingles disponibles :**

| Type | Icône | Description |
|------|-------|-------------|
| Point d'eau naturel | Goutte bleue | Source, ruisseau, mare naturelle |
| Point d'eau manuel | Goutte orange | Bac, citerne, abreuvoir à remplir |
| Batterie clôture | Éclair | Batterie alimentant une clôture électrique |
| Zone animaux | Patte | Terrain occupé par un groupe d'animaux |
| Clôture | Ligne | Segment de clôture (état signalable) |
| Note libre | Épingle | Information quelconque |
| Alerte libre | Triangle rouge | Problème signalé, non catégorisé |

**Couleurs de statut :**
- Vert = OK / Normal
- Orange = Attention / Vérifier
- Rouge = Problème / Urgent
- Gris = Inactif / Hors saison

---

### 8.6 POINTS D'EAU — SYSTÈME COMPLET

C'est la fonctionnalité la plus critique. L'eau est la tâche la plus souvent oubliée.

#### Type A — Point d'eau naturel

Fiche configurable :
```
Nom              : [texte libre]
Mode de dispo    : ○ Toujours disponible  ○ Saisonnier  ○ Sur condition
Mois actifs      : [sélection des mois si saisonnier] ex: Nov-Avr
Statut actuel    : ○ Fonctionnel  ○ Problème signalé  ○ Asséché  ○ Gelé
Note             : [texte libre]
Animaux concernés: [multi-sélection]
Dernière vérif   : [date auto + auteur]
```

**Comportement :**
- Si saisonnier et mois hors période active → épingle grise automatiquement
- Si "Problème signalé" → épingle rouge + alerte visible sur tableau de bord
- Aucune notification automatique pour les points naturels (sauf si problème signalé)
- L'utilisateur peut forcer un override ("Actif quand même" / "Inactif quand même")

#### Type B — Point d'eau manuel

Fiche configurable :
```
Nom              : [texte libre]
Intervalle max   : [nombre] heures / jours  ex: "48 heures"
Animaux concernés: [multi-sélection]
Assigné à        : ○ Auto (répartition)  ○ [personne spécifique]
Heure préférée   : [plage horaire]  ex: "entre 8h et 11h"
Seuil d'alerte   : X heures avant l'échéance  ex: "3h avant"
Escalade si non  
  confirmé après : Y heures  ex: "2h après échéance → alerte à tous"
Heures silenc.   : [22h00 – 07h00] (configurable)
Note             : [texte libre]
```

**Comportement automatique :**
1. Le système calcule en permanence : `prochaine_échéance = dernier_remplissage + intervalle`
2. `X heures avant l'échéance` → notification push à la personne assignée
3. Si l'heure de notification tombe dans les heures silencieuses → elle est reportée à la fin des heures silencieuses (typiquement 7h)
4. L'utilisateur confirme le remplissage en cochant dans l'app (1 tap)
5. Si non confirmé `Y heures après l'échéance` → notification à **tous les utilisateurs**
6. À la confirmation : `dernier_remplissage` mis à jour, cycle recommence

**Règle absolue : on est toujours en avance, jamais en retard.**

**Exemple concret :**
```
Bac ânes nord — intervalle 48h
Dernier remplissage : jeudi 15 mai à 14h00 par Nils
Prochaine échéance  : samedi 17 mai à 14h00
Seuil alerte        : 3h avant → notification samedi 17 mai à 11h00
Heures silencieuses : 22h–07h → pas de décalage nécessaire ici
Si non confirmé à 16h00 (2h après échéance) → alerte à Mathieu + Eugénie
```

**Exemple avec heures silencieuses :**
```
Bac est — intervalle 24h
Dernier remplissage : vendredi 16 mai à 21h00 par Eugénie
Prochaine échéance  : samedi 17 mai à 21h00
Seuil alerte        : 4h avant → samedi 17 mai à 17h00 → OK, pas de décalage
```

**Exemple critique (nuit) :**
```
Bac sud — intervalle 12h
Dernier remplissage : vendredi 16 mai à 22h30 par Mathieu
Prochaine échéance  : samedi 17 mai à 10h30
Seuil alerte        : 3h avant → 07h30 → dans heures silencieuses? Non (après 7h) → notification à 07h30
```

---

### 8.7 BATTERIES DE CLÔTURE

Pas de capteur. Tout est saisi à la main.

Fiche configurable :
```
Nom              : [texte libre]  ex: "Batterie clôture nord"
Zone couverte    : [texte libre ou lien vers zone carte]
Statut           : ○ Bon  ○ Attention  ○ Critique  ○ À changer  ○ En panne
Dernière vérif   : [date auto + auteur]
Note             : [texte libre]  ex: "Recharger si < Attention"
Rappel vérif     : Tous les [X] jours → notification à [personne/tous]
```

**Comportement :**
- Statut = Attention ou pire → épingle orange/rouge sur carte + badge sur tableau de bord
- Rappel de vérification : notification push récurrente selon intervalle configuré
- Aucun pourcentage, aucune automatisation électronique

---

### 8.8 ZONES ANIMAUX ET ROTATION DES TERRAINS

Chaque zone/terrain sur la carte est une épingle de type "Zone animaux".

Fiche :
```
Nom du terrain   : [texte libre]  ex: "Grand pré nord"
Occupants actuels: [multi-sélection groupe]  ex: "Juments", "Ânes mâles"
Depuis le        : [date, auto à la modification]
Clôture associée : [lien vers épingle clôture]
Batterie associée: [lien vers épingle batterie]
Note             : [texte libre]
Historique       : [automatique — liste des rotations passées]
```

**Groupes d'animaux disponibles (modifiables en admin) :**
- Juments (7)
- Étalon (1)
- Hongres chevaux (2)
- Pouliches (3)
- Ânes mâles (6)
- Ânes femelles (17)
- Hongre âne (1)
- Tout le troupeau
- [Personnalisé…]

**Modifier les occupants** : 1 tap sur l'épingle → sélection dans liste → confirmer.
L'historique de rotation est conservé et consultable.

---

### 8.9 ALERTES ET NOTIFICATIONS

#### Types d'alertes
| Type | Déclencheur | Destinataires |
|------|-------------|---------------|
| Point d'eau manuel — rappel | X heures avant échéance | Personne assignée |
| Point d'eau manuel — escalade | Y heures après échéance non confirmée | Tous |
| Point d'eau naturel — problème | Signalement manuel | Tous |
| Batterie — vérification | Rappel périodique | Personne assignée ou tous |
| Batterie — statut critique | Statut passé à Critique/En panne | Tous |
| Météo — vigilance | Niveau Orange ou Rouge Ariège | Tous |
| Risque incendie — élevé | Niveau Élevé ou Très élevé Ariège | Tous |
| Alerte libre | Créée manuellement | Au choix |
| Tâche oubliée | Tâche récurrente non cochée J-1 | Personne assignée |

#### Heures silencieuses
- Par défaut : 22h00 → 07h00
- Configurable par utilisateur dans ses préférences
- Les notifications en dehors de cette plage sont reportées au début de la prochaine plage active
- Les alertes de niveau "Urgence" (escalade eau, vigilance rouge) ignorent les heures silencieuses

#### Centre d'alertes
- Page dédiée listant toutes les alertes actives triées par urgence
- Chaque alerte : bouton "Résolu" (1 tap)
- Historique des alertes résolues (30 derniers jours)
- Filtre par type, par zone, par personne

---

### 8.10 MÉTÉO ET RISQUES EXTERNES

Ces données sont **informatives uniquement**. Aucune action automatique n'en découle.
C'est l'humain qui décide quoi faire avec ces informations.

#### Météo locale — Open-Meteo
- API gratuite, sans clé, sans inscription
- Données pour les coordonnées exactes de la ferme (42.9375, 1.7452)
- Rafraîchissement toutes les heures
- Affiché sur le tableau de bord :
  - Température actuelle
  - Condition (icône : soleil, nuages, pluie, neige, vent…)
  - Vitesse du vent
  - Précipitations dans les 3 prochaines heures
  - Prévision mini/maxi du jour
  - Risque de gel la nuit (température < 2°C)

#### Vigilance météo — Météo-France API officielle
- API publique française, gratuite
- Niveau de vigilance pour le département Ariège (09)
- Types : Vent violent / Orages / Pluie-inondation / Neige-verglas / Grand froid / Canicule / Vagues-submersion / Avalanches
- Affiché : bandeau coloré sur tableau de bord (Vert / Jaune / Orange / Rouge)
- Notification push si Orange ou Rouge

#### Risque incendie — Géorisques + feuxdeforet.fr
- Données gouvernementales françaises, gratuites
- Niveau de danger incendie pour l'Ariège
- Affiché sur tableau de bord
- Notification push si Élevé ou Très élevé

---

### 8.11 PRÉFÉRENCES UTILISATEUR

Chaque utilisateur configure ses propres préférences (stockées en Firestore, par UID).

```
Heures silencieuses    : [début] → [fin]  défaut: 22h00 → 07h00
Disponibilité limitée  : réduction de [50]% des tâches assignées
Rappels actifs         : [liste des types de rappels activés/désactivés]
Couleur profil         : [couleur choisie — sert à identifier visuellement sur la carte]
```

---

### 8.12 ADMIN (accessible à tous les utilisateurs connectés)

- **Gestion des utilisateurs temporaires** : ajouter/retirer un prénom dans le pool de tâches
- **Configuration des groupes d'animaux** : modifier les noms, effectifs
- **Historique général** : journal des actions (qui a fait quoi et quand)
- **Export** : export CSV des tâches et alertes (pour les besoins PAC/administratifs)

---

## 9. MODÈLE DE DONNÉES FIRESTORE

### Collections principales

```
/users/{uid}
  - displayName: string
  - color: string
  - silentStart: string (ex: "22:00")
  - silentEnd: string (ex: "07:00")
  - fcmToken: string (token Firebase Cloud Messaging)
  - availability: "available" | "limited" | "unavailable"
  - availabilityDate: timestamp

/tasks/{taskId}
  - title: string
  - zone: string
  - assignedTo: string (uid ou prénom temporaire)
  - recurrence: "once" | "daily" | "weekly" | "custom"
  - recurrenceInterval: number (jours si custom)
  - priority: "normal" | "urgent"
  - completed: boolean
  - completedAt: timestamp
  - completedBy: string (uid)
  - createdAt: timestamp
  - createdBy: string (uid)
  - dueDate: timestamp

/waterPoints/{pointId}
  - name: string
  - type: "natural" | "manual"
  - lat: number
  - lng: number
  - status: "ok" | "warning" | "problem" | "inactive"
  - animals: array<string>
  - note: string
  — [si natural] :
    - availabilityMode: "always" | "seasonal" | "conditional"
    - activeMonths: array<number> (0-11)
  — [si manual] :
    - intervalHours: number
    - lastFilled: timestamp
    - lastFilledBy: string (uid)
    - alertBeforeHours: number
    - escalateAfterHours: number
    - assignedTo: string (uid ou "auto")

/batteries/{batteryId}
  - name: string
  - lat: number
  - lng: number
  - status: "good" | "warning" | "critical" | "replace" | "down"
  - lastChecked: timestamp
  - lastCheckedBy: string (uid)
  - checkIntervalDays: number
  - note: string

/zones/{zoneId}
  - name: string
  - lat: number
  - lng: number
  - currentOccupants: array<string>
  - occupiedSince: timestamp
  - linkedBattery: string (batteryId)
  - note: string
  - rotationHistory: array<{occupants, from, to}>

/pins/{pinId}
  - name: string
  - type: "water_natural" | "water_manual" | "battery" | "zone" | "fence" | "note" | "alert"
  - lat: number
  - lng: number
  - status: "ok" | "warning" | "problem" | "inactive"
  - note: string
  - createdAt: timestamp
  - createdBy: string (uid)
  - updatedAt: timestamp
  - refId: string (id du document lié dans /waterPoints, /batteries, /zones…)

/alerts/{alertId}
  - type: string
  - message: string
  - severity: "info" | "warning" | "urgent"
  - resolved: boolean
  - resolvedAt: timestamp
  - resolvedBy: string (uid)
  - createdAt: timestamp
  - refId: string (id du point d'eau, batterie, etc. concerné)

/tempUsers/{id}
  - displayName: string
  - active: boolean
  - addedBy: string (uid)
  - addedAt: timestamp
```

---

## 10. CARTE — INTÉGRATION IGN

### Pourquoi IGN et non une image uploadée
- Les tuiles IGN sont **les données officielles françaises** (même source que Géoportail)
- Vue aérienne précise et à jour de la ferme et ses parcelles
- Carte **interactive** (zoom, déplacement) vs image figée
- Les **limites de parcelles cadastrales** sont visibles
- Aucun coût, API publique

### Couches utilisées
```javascript
// Vue aérienne (orthophoto)
https://wxs.ign.fr/essentiels/geoportail/wmts?
  SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0
  &LAYER=ORTHOIMAGERY.ORTHOPHOTOS
  &STYLE=normal&TILEMATRIXSET=PM
  &TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg

// Vue cadastrale (parcelles)
https://wxs.ign.fr/essentiels/geoportail/wmts?
  SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0
  &LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS
  &STYLE=normal&TILEMATRIXSET=PM
  &TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png
```

### Paramètres Leaflet
```javascript
center: [42.93748, 1.74523]
zoom: 16  // montre toute la propriété
minZoom: 13
maxZoom: 20
```

---

## 11. APIS EXTERNES — DÉTAILS

### Open-Meteo (météo)
```
URL : https://api.open-meteo.com/v1/forecast
Params :
  latitude=42.9375
  longitude=1.7452
  current=temperature_2m,precipitation,wind_speed_10m,weather_code
  daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,temperature_2m_min
  timezone=Europe/Paris
  forecast_days=3
Rafraîchissement : toutes les heures
Clé API : aucune
```

### Météo-France Vigilance
```
URL : https://public-api.meteofrance.fr/public/DPVigilance/v1/carteVigilance/encours
Département ciblé : 09 (Ariège)
Rafraîchissement : toutes les heures
Clé API : aucune (API publique)
```

### Géorisques — risque incendie
```
URL : https://www.georisques.gouv.fr/api/v1/ifm
Params : lat=42.9375&lon=1.7452&rayon=1
Rafraîchissement : une fois par jour le matin
Clé API : aucune (données ouvertes)
```

---

## 12. ORDRE DE DÉVELOPPEMENT

### Phase 1 — Fondations (priorité absolue)
1. ✅ Initialisation projet React + TypeScript + Tailwind
2. ✅ Configuration Firebase (Auth, Firestore, Hosting, FCM)
3. ✅ Création des 3 comptes utilisateurs (Mathieu, Nils, Eugénie)
4. ✅ Page de connexion sécurisée
5. ✅ Règles de sécurité Firestore
6. ✅ Structure de routing

### Phase 2 — Cœur opérationnel
7. ✅ Tableau de bord (météo, disponibilité du jour, tâches du jour, alertes actives)
8. ✅ Intégration Open-Meteo + Vigilance estimée (Météo-France API officielle pas branchée, vigilance calculée localement depuis Open-Meteo)
9. ✅ Carnet de tâches (création, assignation, cocher, récurrence)
10. ✅ Système de disponibilité quotidienne

### Phase 3 — Carte
11. ✅ Intégration Leaflet.js + tuiles IGN (aérien + plan)
12. ✅ Système d'épingles (CRUD complet)
13. ✅ Fiches points d'eau naturels
14. ✅ Zones animaux + rotation des terrains (système legacy `zone` + nouveau via enclos fermés)
15. ✅ Fiches batteries de clôture

### Phase 4 — Notifications et eau
16. ✅ Intégration Firebase Cloud Messaging (Android) — côté client
17. ✅ Système points d'eau manuels (calcul échéances client-side)
18. ✅ Heures silencieuses configurables par utilisateur
19. ⚠ Répartition automatique des tâches : assignation manuelle ou "Auto" basique, pas de score de charge sophistiqué

### Phase 5 — Compléments
20. ✅ Utilisateurs temporaires (ajout/retrait dans pool) + système de codes d'accès temporaires
21. ✅ Historique des alertes
22. ✅ Export CSV
23. ✅ Page admin
24. ❌ Risque incendie Géorisques : actuellement estimé depuis météo, pas branché sur l'API officielle
25. ⚠ Tests finaux sur Android, optimisation mobile : en cours d'usage par les utilisateurs réels

---

## 13. RÈGLES DE DÉVELOPPEMENT

- **L'UX prime sur tout** : si une interaction prend plus de 10 secondes, c'est un bug de conception
- **Tout est configurable manuellement** : aucune valeur ne doit être codée en dur dans l'interface
- **Aucune automatisation physique** : le logiciel informe, l'humain agit
- **Offline first** : l'app doit rester utilisable sans réseau (Firestore cache)
- **Mobile first** : concevoir pour téléphone Android, adapter pour PC ensuite
- **0€** : ne jamais dépasser le tier gratuit de Firebase
- **Français uniquement** : toute l'interface est en français
- **Pas de moutons** : les clôtures concernent les ânes et les chevaux uniquement
- **Pas de pourcentage batterie** : les batteries n'ont pas de capteur, statut manuel uniquement

---

## 14. INFORMATIONS CONTEXTUELLE FERME

- **Saison actuelle** (mai 2026) : printemps, risque incendie faible, météo fraîche (8-15°C)
- **Tâche la plus oubliée** : l'eau — c'est la priorité numéro 1 du système de notifications
- **Père hospitalisé** : l'équipe est réduite, ne pas surcharger Nils qui gère seul le terrain
- **PAC** (Politique Agricole Commune) : Mathieu et Eugénie gèrent les dossiers administratifs européens de la ferme — une fonctionnalité export CSV peut servir pour leurs obligations de traçabilité
- **Les terrains alternent** : aucun terrain n'est réservé à une espèce de façon permanente
- **Points d'eau temporaires** : ils changent souvent, le système doit permettre ajout/suppression rapide

---

## 15. ÉTAT ACTUEL DU PROJET (mise à jour 16 mai 2026)

### 15.1 Ce qui est implémenté et fonctionnel

#### Pages livrées
- ✅ `/login` — auth email/password + accès temporaire par code XXXX-XXXX-XXXX (auth anonyme Firebase)
- ✅ `/dashboard` — météo, vigilance, risque feu (estimé), tâches du jour, alertes actives, disponibilité 1-tap
- ✅ `/tasks` — création, assignation, récurrence (unique/quotidienne/hebdo), priorité, regroupement par bucket (retard/aujourd'hui/demain/à venir)
- ✅ `/map` — carte IGN aérien+plan avec système d'épingles complet
- ✅ `/alerts` — alertes actives triées par sévérité + historique 20 dernières résolues + création manuelle
- ✅ `/settings` — édition nom, couleur, heures silencieuses, déconnexion
- ✅ `/admin` — gestion utilisateurs temporaires, codes d'accès, groupes d'animaux, animaux individuels nommés, export CSV

#### Fonctionnalités majeures ajoutées (au-delà du doc initial)
- ✅ **Animaux individuels nommés** — chaque âne (24) et cheval (13) a un nom dans `/animals`, attribuables à un enclos via `enclosureId`
- ✅ **Photos d'identité par animal** — JPEG compressé sur le doc animal
- ✅ **Système de clôtures avancé** — dessin polygonal, snap magnétique sur points existants, fermeture par snap sur point de départ
- ✅ **Presets de fil** — types électrique/barbelé/ruban/fil lisse avec couleur+style visuel propre à chaque
- ✅ **Découpe au ciseau** — change visuellement le type de fil sur une portion sans casser l'enclos (`fillOnly` + `cutFromId`)
- ✅ **Restauration enclos** — bouton 1-clic pour annuler toutes les coupes d'un enclos
- ✅ **Sélection point-in-polygon** — taper à l'intérieur d'un enclos le sélectionne directement
- ✅ **Labels animaux dans enclos** — affichage des noms ou comptes (🐎/🐴) selon zoom
- ✅ **Codes d'accès temporaires** — pour aides occasionnelles, anonyme Firebase + session avec expiration
- ✅ **Bouton 🐾 placement animaux** — panneau global pour déplacer rapidement les animaux d'enclos en enclos
- ✅ **Carnet de soins par animal** — vaccins, vermifuge, parage, visite véto, médication, **saillie** (auto-calcul mise bas +340j cheval / +365j âne), mise bas, autre. Badge "en retard" / "bientôt" sur chaque animal.
- ✅ **Photos sur épingles map** — capture caméra mobile, compressée client-side, viewer fullscreen, badge 📷 sur les épingles documentées
- ✅ **Géolocalisation des membres** — opt-in Settings, marqueurs colorés pulsants sur la carte avec initiale
- ✅ **Pointeur partagé temps réel** — bouton "Pointer" → tap sur la carte → anneau pulsant + vibration mobile chez les autres (utile pendant appel téléphone)
- ✅ **Mode tournée géolocalisé** — Dashboard liste les points d'eau / batteries urgents par distance depuis ta position
- ✅ **Réserves foin/granulés/paille** — Admin avec ajustement quick `−/+`, alerte stock bas sur Dashboard
- ✅ **Historique tournant des terrains** — log auto des mouvements animaux entre enclos, vue dans le panneau enclos
- ✅ **Bilan hebdomadaire** — Dashboard avec stats 7j (tâches faites, eau remplie, soins enregistrés), highlight vert le dimanche
- ✅ **Sauvegarde JSON manuelle** — export complet Firestore en un clic depuis Admin
- ✅ **Mode sombre** — toggle Clair/Sombre dans Settings, suit la préf système par défaut
- ✅ **Fond de carte OpenStreetMap** — fallback automatique si IGN ne répond pas, bouton "Passer à OSM" si erreur tuile détectée
- ✅ **Confirmation 2-clics suppression épingle** — affiche le nombre d'animaux/segments impactés
- ✅ **Anneau de sélection animé** sur la carte
- ✅ **Auto-distribution des tâches** — bouton "⚡ Auto" qui assigne au moins chargé, score affiché par utilisateur

### 15.2 Ce qui reste à faire

#### Critique (bloquant l'usage réel)
1. **Cloud Function ou cron déclenchant les notifications FCM** — actuellement l'app reçoit les notifications mais personne ne les envoie. Solutions gratuites :
   - GitHub Actions schedule (cron 15 min) qui appelle un endpoint HTTP scanner les `nextReminderAt` et envoie les push via Admin SDK
   - OU service worker du PWA qui surveille en background quand l'app est ouverte (limité)
   - OU passer au Blaze plan Firebase avec budget alert à 0€ (Cloud Functions gratuit jusqu'à 2M invocations/mois)

2. **Auto-création des tâches récurrentes** — le flag `nextOccurrenceCreated` existe mais le déclencheur n'est pas branché. Mêmes options que ci-dessus.

3. **Risque incendie Géorisques** — actuellement estimé bidon depuis la météo, à brancher sur l'API officielle.

#### Important (amélioration significative)
4. **Vigilance Météo-France API officielle** — actuellement vigilance estimée depuis Open-Meteo, l'API officielle française donnerait des données plus fiables.

5. **Répartition automatique sophistiquée** — calculer le score de charge hebdomadaire par personne et auto-assigner les nouvelles tâches au moins chargé.

6. **Tests Android approfondis** — installation PWA, notifications push, mode hors-ligne avec coupure réseau, comportement carte sans signal.

#### Souhaitable (polish)
7. **Animation des labels d'enclos** — actuellement affichage statique, pourrait fade-in/out au zoom
8. **Mode sombre** — la ferme est utilisée tôt le matin et tard le soir
9. **Indication visuelle des sélections sur la carte** — highlight de l'épingle sélectionnée
10. **Confirmation pour suppressions destructives** — actuellement direct sans warning sauf pour les presets

### 15.3 Propositions d'extensions

Idées non demandées mais qui pourraient apporter de la valeur :

#### Suivi vétérinaire
- **Carnet de soins par animal** — vaccins, vermifuge, pareur d'onglons/sabots, visites véto
- **Rappels personnalisés par animal** — "Vacciner Tornade dans 30 jours"
- **Photos d'identité par animal** — pour reconnaissance rapide
- **Mensurations + courbes de croissance** — utile pour les poulains

#### Reproduction (juments + étalon)
- **Calendrier des chaleurs** — saisie manuelle des observations
- **Suivi gestation** — date saillie → date prévue mise bas (340 jours), rappels échographie/vaccins
- **Historique des saillies** par jument/étalon

#### Logistique terrain
- **Réserves foin/paille/granulés** — niveaux + alerte rupture
- **Pluviomètre manuel** — saisie quotidienne + cumul mensuel pour gestion pâturages
- **Photo sur épingle** — preuve visuelle d'un problème sur point d'eau / batterie
- **Mode "tournée"** — pré-affichage géolocalisé des tâches à proximité

#### Vue d'ensemble
- **Compte rendu hebdomadaire automatique** — résumé dimanche soir : tâches faites, alertes traitées, météo de la semaine
- **Tableau de bord PAC** — vue groupée des données pour Mathieu/Eugénie quand ils préparent les dossiers
- **Historique tournant des terrains** — visualisation des rotations animales sur 6 mois (qui était où)

#### Sécurité / résilience
- **Sauvegarde automatique Firestore → JSON** — export complet hebdomadaire vers Google Drive personnel
- **Mode hors-ligne renforcé** — file d'attente des écritures + synchro à la reconnexion
- **Audit log visible** — qui a modifié quoi et quand, déjà partiellement en place via `updatedBy`

### 15.4 Dette technique identifiée

- `Map.tsx` fait 2618 lignes — découpage en sous-composants pour les sheets serait sain
- Pas de tests automatisés — pour 3 utilisateurs, acceptable mais à garder en tête
- États mode/sélection multiples dans Map.tsx — un état finite-state-machine unique simplifierait
- Vigilance et risque feu actuellement estimés, à remplacer par les vraies sources officielles

---

*Document créé le 15 mai 2026. Dernière mise à jour : 17 mai 2026 (intégration carnet de soins étendu, géoloc membres + pointeur partagé, mode tournée géolocalisé, photos animaux + épingles, historique mouvements enclos, mode sombre, fallback OSM, sauvegarde JSON, suppression du pluviomètre jugé inutile par l'utilisateur).*

















# idée pas en forme

- geolocalisation a l'aide des portable a fin de savoir ou tout les membre de la famille ce trouve
- curseur interaction sur la map en temps réel a fin de pouvoir voir les deplacement des autre ainsi que de pouvoir pointer un endroit precis si on es au téléphone a distance
