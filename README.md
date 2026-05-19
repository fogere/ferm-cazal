# 🌿 Ferme Stinglhamber

PWA de gestion pour la **Ferme Stinglhamber** (Roquefixade, Ariège, France) — 24 ânes + 13 chevaux, 3 utilisateurs réguliers + aides occasionnelles.

Conçue pour fonctionner **0€/mois** : Firebase tier gratuit + IGN tuiles publiques + Open-Meteo.

App en ligne : <https://le-cazal.web.app>

## Pile technique

- **Frontend** : React 18 + TypeScript + Vite + Tailwind CSS v4
- **PWA** : Workbox (service worker, mode hors-ligne, installable Android)
- **Backend** : Firebase Auth / Firestore / Cloud Messaging / Hosting
- **Carte** : Leaflet + tuiles IGN (Géoportail) + fallback OpenStreetMap
- **Météo** : Open-Meteo (sans clé)
- **Cloud Functions** *(optionnel)* : pour cron des notifications push

## Structure du repo

```
.
├── app/                 # Frontend React (Vite)
│   ├── src/             # Code source TypeScript + JSX
│   ├── public/          # Assets statiques (icônes PWA, manifest)
│   └── firestore.rules  # Règles de sécurité Firestore
├── functions/           # Cloud Functions (Node.js)
├── worker/              # Cloudflare Worker (proxy CORS optionnel)
├── firebase.json        # Config déploiement Firebase
├── projet.md            # Documentation fonctionnelle complète
└── AVANCEMENT.md        # Historique des sessions de dev
```

## Démarrage local

### Prérequis
- Node.js 20+
- Compte Firebase avec un projet créé (Auth + Firestore + Hosting activés)

### Installation
```bash
cd app
cp .env.example .env
# → renseigner les variables Firebase de ton projet dans .env
npm install
npm run dev
```

L'app est accessible sur `http://localhost:5173`.

### Déploiement
```bash
cd app
npm run build
firebase deploy --only hosting
```

Pour déployer aussi les règles Firestore :
```bash
firebase deploy --only firestore:rules,hosting
```

## Fonctionnalités principales

- **Carte interactive IGN** (aérien + plan) avec épingles : points d'eau, batteries de clôture, zones animaux, clôtures électriques
- **Système de clôtures avancé** : dessin polygonal avec snap magnétique, fermeture en enclos, découpe au ciseau pour changer le type de fil sur une portion sans casser l'enclos
- **Animaux nommés individuellement** avec photos d'identité, placement par enclos, historique des rotations
- **Carnet de soins** par animal : vaccins, vermifuge, parage, visite véto, saillie (auto-calcul mise bas +340j cheval / +365j âne)
- **Tâches** : récurrentes, auto-distribution par charge, disponibilité quotidienne
- **Alertes** : eau à remplir, batteries à vérifier, soins en retard
- **Géolocalisation** des membres + pointeur partagé temps réel (utile pendant les appels)
- **Photos** sur épingles et animaux (compressées client-side)
- **Réserves** (foin, granulés…) avec alerte stock bas
- **Mode sombre**
- **Accès temporaire** pour aides occasionnelles (code XXXX-XXXX-XXXX avec expiration)

Voir [`projet.md`](./projet.md) pour la documentation détaillée.

## Sécurité

- Authentification email/password obligatoire (comptes créés manuellement par l'admin Firebase)
- Accès temporaire via code à durée limitée
- Règles Firestore strictes : aucun accès sans UID Firebase valide
- Headers HTTP de sécurité (CSP, X-Frame-Options, HSTS, etc.) configurés dans `firebase.json`
- `robots.txt` interdit le crawl

## License

Privée — usage réservé à la Ferme Stinglhamber.
