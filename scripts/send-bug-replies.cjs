#!/usr/bin/env node
/**
 * Script one-shot pour envoyer des messages in-app pré-rédigés en réponse aux
 * bugs/questions du rapport `ferme-bugs-2026-05-20V2.json`.
 *
 * Cible les utilisatrices Eugénie et Benoît (UIDs lus directement dans le rapport).
 * Crée des docs dans la collection Firestore `user_messages`. Les destinataires
 * verront un badge "📬 nouveau message" sur leur Dashboard et pourront relire
 * autant de fois qu'elles veulent via /messages.
 *
 * Pré-requis :
 *   1. firebase-admin installé : cd scripts && npm install firebase-admin
 *   2. Clé service account : scripts/le-cazal-service-account.json
 *
 * Usage :
 *   node scripts/send-bug-replies.cjs --from <uid_super_admin> [--dry-run]
 *
 * --from   uid du super-admin "expéditeur" (apparaît dans le champ "De" côté UI).
 *          Par défaut : Benoît (ucolJqEYUbedS3OTFQLoqtXVoMp2).
 * --dry-run  N'écrit rien dans Firestore, affiche juste les messages prévus.
 */

const fs   = require('fs')
const path = require('path')

// UIDs extraits du rapport `ferme-bugs-2026-05-20V2.json`
const UID_EUGENIE = 'FmtaeNWzGnTFRyHPZXUhLLnQmEL2'
const UID_BENOIT  = 'ucolJqEYUbedS3OTFQLoqtXVoMp2'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fromIdx = args.indexOf('--from')
const FROM_UID = fromIdx >= 0 && args[fromIdx + 1] ? args[fromIdx + 1] : UID_BENOIT

// Messages à envoyer (hard-codés à partir de l'analyse du rapport V2)
const MESSAGES = [
  {
    toUid: UID_EUGENIE,
    toUidName: 'Eugenie',
    title: 'Retirer une enclave dans un parc',
    body: `Coucou Eugénie 👋

Quand tu as découpé un parc à la cisaille et que tu veux annuler le découpage :

1. Touche le parc principal sur la carte.
2. Dans le panneau de droite (les détails du parc), descends un peu.
3. Tu verras un bouton "Restaurer fil unique" qui apparaît seulement sur les parcs découpés. Touche-le.

Le parc retrouve son contour d'origine, sans l'enclave. Si tu ne vois pas le bouton, vérifie que tu as bien sélectionné le parc qui contient l'enclave (pas le segment d'enclave lui-même).

Dis-moi si ça marche !`,
    relatedBugId: 'X4cKH4I8h2ZXl1LZkn5S',
  },

  {
    toUid: UID_EUGENIE,
    toUidName: 'Eugenie',
    title: 'Notifier tout le monde à une heure précise',
    body: `Coucou Eugénie 👋

Pour qu'une tâche envoie une notif à TOUT LE MONDE (et pas à une seule personne) à une heure précise, le système existe déjà — voici comment :

1. Va sur l'onglet Tâches.
2. Appuie sur "+ Ajouter une tâche".
3. Donne-lui un titre, une date.
4. **Important** : choisis le mode "📣 Broadcast" (au lieu de "Pool" ou "Assignée"). C'est dispo seulement pour toi et Benoît.
5. **Coche l'heure due** et règle l'heure pile que tu veux (ex: 18:00).
6. Valide.

À l'heure pile, tout le monde reçoit une notif en même temps. N'importe qui peut cocher "fait" et ça reste visible 24h pour informer les autres que c'est traité.

Si tu ne vois pas le mode Broadcast, dis-moi.`,
    relatedBugId: 'OMpduK1jrMjVsaXtM97g',
  },

  {
    toUid: UID_EUGENIE,
    toUidName: 'Eugenie',
    title: 'Numéro SIRE et transpondeur des animaux',
    body: `Coucou Eugénie 👋

Bonne nouvelle : les champs SIRE et numéro de transpondeur sont déjà dans la fiche de chaque animal. Pour les saisir :

1. Va sur la carte, touche un parc.
2. Dans la liste d'animaux du parc, touche l'animal.
3. Dans sa fiche, descends jusqu'à "Identification" — tu y verras les champs "Numéro SIRE" et "Transpondeur".
4. Touche le crayon, remplis, valide.

Tu peux aussi les éditer depuis Admin → Animaux → édition d'un animal.

Si la zone d'identification n'apparaît pas chez toi, c'est sûrement que ton appli affiche une vieille version. Ferme complètement l'appli et rouvre-la — la nouvelle version se chargera (les changements de cette semaine y sont).`,
    relatedBugId: 'drpI0QbvwiTDDdfiWlXg',
  },

  {
    toUid: UID_BENOIT,
    toUidName: 'Benoît',
    title: 'Le crayon des mouvements — corrigé',
    body: `Salut Benoît 👋

Tu avais signalé que le crayon de "Historique des mouvements" ne permettait pas de noter une date. Bien vu — c'était une icône trompeuse, elle ne servait qu'à déplier la liste.

C'est corrigé. Désormais :
- Le crayon est remplacé par une simple flèche ▼ (juste pour déplier).
- En dessous de l'historique, un nouveau bouton "✏️ Noter un mouvement" t'envoie directement dans le calendrier de pâturage, le formulaire de saisie ouvert.

Tu peux aussi y aller directement par le bouton "Calendrier complet →" en haut de l'historique, ou par l'icône "Pâturage" dans le menu.

Pour le copier-coller depuis ton calendrier Excel : c'est dans Pâturage → bouton "Importer (TSV)" en haut.

Mise à jour dispo dès le prochain rafraîchissement de l'appli (ferme et rouvre).`,
    relatedBugId: 'SCToJXsHleX3mYjJ0UAA',
  },
]

async function main() {
  let admin
  try {
    admin = require('firebase-admin')
  } catch {
    console.error('❌ firebase-admin non installé. Lance d\'abord :')
    console.error('   cd scripts && npm install firebase-admin')
    process.exit(1)
  }

  const credPath = path.join(__dirname, 'le-cazal-service-account.json')
  if (!fs.existsSync(credPath)) {
    console.error(`❌ Clé service account introuvable : ${credPath}`)
    console.error('   Télécharge-la depuis Firebase Console et place-la ici.')
    process.exit(1)
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(credPath)),
  })
  const db = admin.firestore()

  // Récupérer le displayName de l'expéditeur (FROM_UID) pour l'afficher côté UI
  let fromName = 'Admin'
  try {
    const fromDoc = await db.collection('users').doc(FROM_UID).get()
    if (fromDoc.exists) {
      fromName = fromDoc.data().displayName || 'Admin'
    } else {
      console.warn(`⚠ User /users/${FROM_UID} introuvable — fromUidName="Admin"`)
    }
  } catch (err) {
    console.warn(`⚠ Impossible de lire /users/${FROM_UID}:`, err.message)
  }

  console.log(`\n📬 Envoi de ${MESSAGES.length} message(s) — expéditeur : ${fromName} (${FROM_UID})`)
  console.log(dryRun ? '   🧪 Mode dry-run : aucune écriture Firestore.\n' : '   ✏️  Écriture réelle.\n')

  let sent = 0
  for (const m of MESSAGES) {
    const payload = {
      toUid:        m.toUid,
      toUidName:    m.toUidName,
      fromUid:      FROM_UID,
      fromUidName:  fromName,
      title:        m.title,
      body:         m.body,
      relatedBugId: m.relatedBugId,
      createdAt:    Date.now(),
      readAt:       null,
    }
    console.log(`→ Pour ${m.toUidName} : "${m.title}"`)
    if (!dryRun) {
      const ref = await db.collection('user_messages').add(payload)
      console.log(`  ✓ Créé : user_messages/${ref.id}`)
      sent += 1
    }
  }

  console.log(`\n${dryRun ? '🧪' : '✅'} Terminé. ${sent} message(s) envoyé(s).`)
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Erreur fatale :', err)
  process.exit(1)
})
