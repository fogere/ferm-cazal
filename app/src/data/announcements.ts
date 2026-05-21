/**
 * Annonces statiques affichées à toutes les utilisatrices.
 *
 * Comment ajouter une annonce :
 *   1. Choisis un `id` UNIQUE (kebab-case ; ne réutilise jamais un id existant
 *      sinon les lecteurs qui l'ont déjà marquée lue ne reverront pas la nouvelle).
 *   2. Ajoute l'objet en HAUT du tableau ANNOUNCEMENTS (les plus récentes d'abord).
 *   3. `forUser` :
 *        - `null` → broadcast à toutes les utilisatrices
 *        - `'Eugenie'` ou `'Benoît'` → ciblée (match exact du displayName)
 *   4. `createdAt` : timestamp en ms (Date.now() au moment de l'écriture).
 *   5. Push + déploie hosting → l'annonce apparaît dès le rafraîchissement client.
 *
 * Le marquage "lu" est local (localStorage par device — pas de coût Firestore).
 * Si l'utilisatrice a 2 devices, elle marquera lu sur chacun. Pas critique.
 */
export interface Announcement {
  id:        string
  title:     string
  body:      string
  forUser:   string | null   // null = broadcast à tous
  createdAt: number          // ms epoch
}

// Pseudo-uid pour le bouton "Tout marquer lu". Stocké à part de readAt Firestore.
export const ANNOUNCEMENTS_READ_LS_KEY = 'fm_announcements_read'

export const ANNOUNCEMENTS: Announcement[] = [
  // ── 21/05/2026 (fin de soirée) — cours d'eau polyline Phase 1 + suite refonte à venir ──
  {
    id:        '2026-05-21-cours-eau-polyline',
    title:     'Cours d\'eau — Phase 1 (tracé + saisonnalité)',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-21T23:45:00+02:00'),
    body: `Coucou Eugénie 👋

Première partie de ce que tu demandais sur les cours d'eau, c'est en ligne.

Sur la carte, tu as maintenant un nouvel outil "🏞️ Cours d'eau" :
1. Active l'outil dans la barre du bas.
2. Touche la carte point par point pour tracer le cours d'eau.
3. Quand tu termines, tu choisis : "permanent" ou "saisonnier" (avec les mois actifs).

Les anciens points d'eau naturels en cercle restent affichés tant que tu ne les supprimes pas — pas de migration automatique pour ne rien casser. Quand tu veux passer un point en tracé : supprime l'ancien puis trace le nouveau cours d'eau au même endroit.

Ce qui reste à faire (noté, à venir) :
- "Atténuation manuelle par segment" : pouvoir dire "à partir de ce point, le débit chute de 90% car ça s'infiltre dans le sol". Pas encore implémenté.
- Refonte clôtures vs espaces : ton idée plus profonde de séparer "définition d'un espace" (terrain qui nous appartient) du "tracé physique de clôture" (amovible, modifiable). Gros chantier, à discuter ensemble avant que je touche. Snap automatique du tracé clôture sur le tracé espace + zones vides intérieures (bouts de terrain qui ne nous appartiennent pas au milieu d'un grand parc) — c'est tout noté.`,
  },

  // ── 21/05/2026 (fin de soirée) — V2 safe : intensité fil, voyant batterie, tâches "pour tous", timeout GPS ──
  {
    id:        '2026-05-21-tache-pour-tous',
    title:     'Assigner une tâche à "tous"',
    forUser:   'Nils',
    createdAt: Date.parse('2026-05-21T23:30:00+02:00'),
    body: `Salut Nils,

Le mode "📣 Pour tous" est maintenant accessible quand tu crées une tâche (avant il était réservé à Eugénie/Benoît).

Va sur Tâches → "+ Ajouter une tâche" → Mode → "📣 Pour tous". La tâche sera partagée à tout le monde et n'importe qui peut la cocher comme faite.

Note : l'envoi automatique d'une notif push à une heure précise reste réservé aux super-admins (sinon n'importe qui pourrait spammer les autres). Si tu veux une notif programmée pour tous, demande à Eugénie ou Benoît.`,
  },

  {
    id:        '2026-05-21-intensite-fil-elec',
    title:     'Atténuation visuelle du fil électrique',
    forUser:   'Nils',
    createdAt: Date.parse('2026-05-21T23:30:00+02:00'),
    body: `Salut Nils,

Tu peux maintenant indiquer l'intensité du courant sur chaque tronçon de clôture électrique :
1. Touche une clôture électrique sur la carte.
2. Dans le panneau de droite, bloc "Intensité du courant" :
   - ⚡ Plein → trait continu normal
   - ⚡ Atténué → pointillé moyen, opacité réduite (fin de circuit, courant faible)
   - ⊘ Coupé → pointillé fin gris (circuit débranché)

Et tu peux aussi connecter une clôture à une batterie spécifique :
- Bloc "Reliée à une batterie" sous le sélecteur d'intensité.
- Si tu éteins la batterie reliée (voir annonce voyant batterie), TOUTES les clôtures connectées s'affichent automatiquement comme coupées sur la carte.`,
  },

  {
    id:        '2026-05-21-voyant-batterie',
    title:     'Voyant ON/OFF sur les batteries',
    forUser:   'Nils',
    createdAt: Date.parse('2026-05-21T23:30:00+02:00'),
    body: `Salut Nils,

Tu peux maintenant éteindre/rallumer une batterie depuis la carte :
1. Touche un pin batterie ⚡ sur la carte.
2. En bas du panneau, bouton "⊘ Éteindre la batterie".
3. La batterie devient grise avec un voyant rouge ⊘ visible sur la carte.
4. Toutes les clôtures connectées à cette batterie passent automatiquement en mode "coupé" (grises, pointillés fins).
5. Le compteur "X clôtures" sur le bouton te dit combien de tronçons sont reliés.

Pour relier une clôture à une batterie : panneau de la clôture → bloc "Reliée à une batterie".`,
  },

  // ── 21/05/2026 (nuit) — fix gros morceaux : pâturage agrégé + GPS précision ──
  {
    id:        '2026-05-21-gps-precision',
    title:     'GPS — précision améliorée',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-21T22:00:00+02:00'),
    body: `Coucou Eugénie 👋

Tu avais raison sur le GPS — il faisait du positionnement par Wi-Fi/réseau au lieu du GPS satellite, d'où les 500 m de rayon aléatoire que tu voyais.

C'est corrigé sur les 3 systèmes qui utilisent ta position :
- Partage temps réel sur la carte (toi visible pour les autres)
- Détection "tu es dans un enclos" (notif animaux à vérifier)
- Publication ponctuelle quand quelqu'un ouvre la carte

Maintenant la précision sera de 5 à 20 m en outdoor (sur le terrain), comme un GPS normal.

Petit point : ça consommera un peu plus de batterie. Mais ton partage s'auto-coupe au bout de 2 h, donc rien de grave.

Pour le "ne s'active pas auto" : c'est que ton téléphone a besoin que tu aies AUTORISÉ l'accès à la position pour le site. Va dans Réglages → ferme l'appli → ouvre les permissions de Chrome/Firefox → autorise "le-cazal.web.app" pour la localisation toujours (pas seulement "pendant l'utilisation").`,
  },

  {
    id:        '2026-05-21-paturage-agrege',
    title:     'Parcs scindés : couleur d\'herbe corrigée',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-21T22:00:00+02:00'),
    body: `Coucou Eugénie 👋

Tu avais bien expliqué le problème : quand tu coupes un parc en 2 ou 3 avec la cisaille pour forcer les bêtes à brouter un coin précis, l'appli traitait chaque sous-parc comme indépendant pour la couleur d'herbe. Du coup tu voyais "vert prêt à pâturer" alors que tu venais juste de retirer les bêtes.

C'est corrigé. Maintenant l'appli regroupe les sous-parcs issus d'un même parc d'origine :
- Si tu déplaces les animaux d'un sous-parc vers un autre sous-parc du même parc, l'herbe ne reset pas — c'est la même herbe en repousse.
- La couleur du parc ne redevient "vert prêt" que quand TOUS les sous-parcs sont vides depuis assez longtemps (14 j → brun, 60 j → jaune, plus → vert vif).
- Si tu sors les animaux pour les mettre dans un parc complètement extérieur, là le compteur démarre normalement.

Toutes les parties d'un même parc d'origine se synchronisent pour la couleur.`,
  },

  // ── 21/05/2026 (soir) — réponses aux bugs V4 ──
  {
    id:        '2026-05-21-fcm-pc-vs-tel',
    title:     'Notifs sur PC vs téléphone',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-21T20:00:00+02:00'),
    body: `Coucou Eugénie 👋

Tu as raison, c'est bien ton PC qui pose problème, pas l'appli. Le message d'erreur "AbortError: Registration failed - push service error" dans la console signifie que c'est CHROME / EDGE sur Windows qui n'arrive pas à se connecter au service de notifications de Google.

C'est un bug connu, pas chez nous. Il se produit dans 2 cas typiques :
1. La synchro Chrome / Edge est désactivée (compte non connecté au navigateur).
2. Le pare-feu Windows bloque les push (parfois après une mise à jour).

À essayer dans l'ordre :
1. Vérifie que tu es bien connectée à ton compte Google dans Chrome (ou Microsoft dans Edge).
2. Va sur le-cazal.web.app → réglages → désactive puis réactive les notifications push.
3. Si rien ne marche : pas grave, garde ton téléphone comme canal de notif principal. Le PC est secondaire.

Sur Android tout fonctionne car le système gère lui-même les push, sans passer par le navigateur.`,
  },

  {
    id:        '2026-05-21-poteaux-suppression-fix',
    title:     'Suppression anciens poteaux — à retester',
    forUser:   'Nils',
    createdAt: Date.parse('2026-05-21T20:00:00+02:00'),
    body: `Salut Nils,

Tu as signalé que la suppression marchait sur les nouveaux poteaux mais pas les anciens en mode édition de clôture. J'ai déployé un fix complet ce matin (insertion ghost markers + double-tap visible dans le bandeau d'aide).

Si tu retestes maintenant et que la suppression des anciens marche : annonce à classer.
Sinon ouvre un nouveau bug avec les étapes précises (quel parc, quel poteau, ce que ça fait à la place) et je creuse — le double-tap est peut-être ambigu sur certains devices (geste interprété comme drag).`,
  },

  // ── 21/05/2026 — annonce broadcast (visible par tous, y compris l'admin/dev) ──
  {
    id:        '2026-05-21-systeme-annonces',
    title:     '📢 Nouveau : système d\'annonces in-app',
    forUser:   null, // broadcast à tous
    createdAt: Date.parse('2026-05-21T19:30:00+02:00'),
    body: `Salut tout le monde !

Cette page que tu lis est nouvelle. Voici comment ça marche :

🟢 Les annonces vertes en haut sont les nouvelles (non lues). En les ouvrant, elles passent automatiquement en "lues" (icône enveloppe ouverte).

🔁 Tu peux relire chaque annonce autant de fois que tu veux — elles restent ici jusqu'à ce que tu les masques toi-même avec le bouton "Masquer" en bas de chaque annonce.

📱 Si tu utilises l'appli sur 2 appareils différents (téléphone + tablette), tu marqueras "lu" séparément sur chacun. Pas critique.

Si tu signales un bug ou poses une question via le bouton 🐞 en bas à droite, la réponse arrivera ici, ciblée à ton compte. Les annonces "système" comme celle-ci sont visibles par tout le monde.`,
  },

  // ── 21/05/2026 — confirmations des bugs V3 d'Eugénie ──
  {
    id:        '2026-05-21-clic-pin-priorite',
    title:     'Clic sur un parc — pins en priorité maintenant',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-21T18:00:00+02:00'),
    body: `Coucou Eugénie 👋

Tu avais raison, c'était énervant. Quand tu cliquais en plein milieu d'un parc, ça tombait toujours sur l'édition du parc, jamais sur les points d'eau ou batteries placés dedans.

C'est inversé maintenant :
1. Les pins (points d'eau, batterie, tâches à faire…) sont en priorité.
2. Le fil de la clôture vient ensuite.
3. L'intérieur du parc ne se sélectionne plus que si tu cliques dans une zone vraiment vide (aucun pin proche).

Si un point d'eau est planqué sous un autre élément, vise précisément dessus — le rayon de tolérance est large (≈ ton doigt).`,
  },

  {
    id:        '2026-05-21-edition-poteaux',
    title:     'Édition clôture : ajouter et supprimer des poteaux',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-21T18:00:00+02:00'),
    body: `Coucou Eugénie 👋

Bonne nouvelle, les 2 demandes sont prêtes :

➕ AJOUTER un poteau entre 2 existants :
En mode édition de clôture, tu vois maintenant des petits cercles verts avec un "+" au milieu de chaque segment (entre 2 poteaux). Touche-le et un nouveau poteau apparaît à cet endroit — tu peux ensuite le déplacer en le glissant.

➖ SUPPRIMER un poteau :
Cette fonction existait déjà mais je sais qu'elle n'était pas claire. C'est un DOUBLE-TAP sur le poteau (deux taps rapprochés). Le bandeau d'aide en haut de l'écran le rappelle aussi.

⚠️ Les changements ne sont sauvegardés qu'au moment où tu touches "Valider" en bas. Si tu te trompes, tu peux annuler avant.`,
  },

  // ── 20/05/2026 — réponses RTFM V2 ──
  {
    id:        '2026-05-20-retirer-enclave',
    title:     'Retirer une enclave dans un parc',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-20T18:00:00+02:00'),
    body: `Coucou Eugénie 👋

Quand tu as découpé un parc à la cisaille et que tu veux annuler le découpage :

1. Touche le parc principal sur la carte.
2. Dans le panneau de détails du parc, descends un peu.
3. Tu verras un bouton "Restaurer fil unique" qui apparaît seulement sur les parcs découpés. Touche-le.

Le parc retrouve son contour d'origine, sans l'enclave. Si tu ne vois pas le bouton, vérifie que tu as bien sélectionné le parc qui contient l'enclave (pas le segment d'enclave lui-même).`,
  },

  {
    id:        '2026-05-20-notif-tout-le-monde',
    title:     'Notifier tout le monde à une heure précise',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-20T18:00:00+02:00'),
    body: `Coucou Eugénie 👋

Pour qu'une tâche envoie une notif à TOUT LE MONDE (et pas à une seule personne) à une heure précise, le système existe déjà — voici comment :

1. Va sur l'onglet Tâches.
2. Appuie sur "+ Ajouter une tâche".
3. Donne-lui un titre, une date.
4. Important : choisis le mode "📣 Broadcast" (au lieu de "Pool" ou "Assignée"). C'est dispo seulement pour toi et Benoît.
5. Coche l'heure due et règle l'heure pile que tu veux (ex: 18:00).
6. Valide.

À l'heure pile, tout le monde reçoit une notif en même temps. N'importe qui peut cocher "fait" et ça reste visible 24h pour informer les autres que c'est traité.`,
  },

  {
    id:        '2026-05-20-sire-transpondeur',
    title:     'Numéro SIRE et transpondeur des animaux',
    forUser:   'Eugenie',
    createdAt: Date.parse('2026-05-20T18:00:00+02:00'),
    body: `Coucou Eugénie 👋

Bonne nouvelle : les champs SIRE et numéro de transpondeur sont déjà dans la fiche de chaque animal. Pour les saisir :

1. Va sur la carte, touche un parc.
2. Dans la liste d'animaux du parc, touche l'animal.
3. Dans sa fiche, descends jusqu'à "Identification" — tu y verras les champs "Numéro SIRE" et "Transpondeur".
4. Touche le crayon, remplis, valide.

Tu peux aussi les éditer depuis Admin → Animaux → édition d'un animal.

Si la zone d'identification n'apparaît pas chez toi, c'est sûrement que ton appli affiche une vieille version. Ferme complètement l'appli et rouvre-la — la nouvelle version se chargera.`,
  },

  {
    id:        '2026-05-20-crayon-mouvements',
    title:     'Le crayon des mouvements — corrigé',
    forUser:   'Benoît',
    createdAt: Date.parse('2026-05-20T18:00:00+02:00'),
    body: `Salut Benoît 👋

Tu avais signalé que le crayon de "Historique des mouvements" ne permettait pas de noter une date. Bien vu — c'était une icône trompeuse, elle ne servait qu'à déplier la liste.

C'est corrigé. Désormais :
- Le crayon est remplacé par une simple flèche ▼ (juste pour déplier).
- En dessous de l'historique, un nouveau bouton "✏️ Noter un mouvement" t'envoie directement dans le calendrier de pâturage, le formulaire de saisie ouvert.

Tu peux aussi y aller par le bouton "Calendrier complet →" en haut de l'historique, ou par l'icône "Pâturage" dans le menu.

Pour le copier-coller depuis ton calendrier Excel : c'est dans Pâturage → bouton "Importer (TSV)" en haut.`,
  },
]

/* ────────────────────────────────────────────────────────────────────────────
   Helpers — lecture / écriture du statut "lu" dans localStorage
   ────────────────────────────────────────────────────────────────────────── */

export function getReadAnnouncementIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ANNOUNCEMENTS_READ_LS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

export function markAnnouncementRead(id: string): void {
  try {
    const ids = getReadAnnouncementIds()
    if (ids.has(id)) return
    ids.add(id)
    localStorage.setItem(ANNOUNCEMENTS_READ_LS_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    /* localStorage indisponible (mode privé strict) — pas critique */
  }
}

/**
 * Annonces visibles pour un utilisateur donné, triées du plus récent au plus ancien.
 * Le match `forUser` est insensible à la casse ET aux accents (Eugenie ≡ Eugénie,
 * Benoit ≡ Benoît) pour ne pas dépendre de la façon exacte dont chacun a écrit
 * son prénom dans Settings.
 */
function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

export function getVisibleAnnouncements(displayName: string | undefined | null): Announcement[] {
  const name = normalizeName(displayName ?? '')
  return ANNOUNCEMENTS
    .filter(a => a.forUser === null || normalizeName(a.forUser) === name)
    .sort((a, b) => b.createdAt - a.createdAt)
}
