# Déploiement du proxy de tuiles IGN (Cloudflare Worker)

But : les tuiles de la carte passent par un cache Cloudflare gratuit au lieu de
taper l'IGN en direct → plus de carrés noirs / rechargement en boucle.

**Coût : 0 € (Workers free = 100 000 requêtes/jour, sans carte bancaire).**

## Méthode A — tout au clic sur le site Cloudflare (RECOMMANDÉ, pas de terminal)

Le terminal (wrangler) plante sur ce Windows (`Assertion failed … libuv`). On passe
donc par le tableau de bord web — plus simple de toute façon.

1. **https://dash.cloudflare.com** → connexion (ou compte gratuit : email + mdp, **pas de carte**).
2. Menu gauche : **Compute (Workers)** / « Workers & Pages ».
3. **Create** → **Create Worker** (« Start with Hello World »).
4. Nom : **`ferme-tiles`** → **Deploy**. (S'il demande un sous-domaine workers.dev, choisis-en un.)
5. **Edit code** → efface tout le code exemple (Ctrl+A, Suppr).
6. Ouvre `index.js` (ce dossier) → Ctrl+A, Ctrl+C → colle dans l'éditeur Cloudflare (Ctrl+V).
7. **Deploy**.
8. Copie l'URL affichée : **`https://ferme-tiles.TON-SOUS-DOMAINE.workers.dev`**.
9. **Vérifie** — colle dans le navigateur (avec TON URL) :
   ```
   https://ferme-tiles.TON-SOUS-DOMAINE.workers.dev/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=15&TILEROW=12049&TILECOL=16542&FORMAT=image%2Fjpeg
   ```
   → une image de tuile aérienne doit s'afficher.
10. **Envoie l'URL** au dev (moi) → je branche l'app + déploie.

## Méthode B — terminal wrangler (si le CLI ne plante pas chez toi)

Attention : **coller les commandes SANS le `#` ni le texte après** (le terminal Windows
prend le commentaire pour des arguments).

```
cd "C:\Users\Administrator\Downloads\projet farm\tile-proxy"
npx wrangler login
npx wrangler deploy
```
Puis même vérification qu'en étape 9, et envoie l'URL.

## Notes
- L'allowlist n'autorise que 3 couches IGN (aérien / plan / parcelles) — ce n'est
  pas un proxy ouvert.
- Le cache est de 30 jours. Pour vider : `npx wrangler deploy` redéploie le code
  (le cache edge se renouvelle tout seul à expiration).
- Ce worker est **indépendant** de l'ancien `worker/` (cron FCM, projet test) — ne
  pas les confondre.
