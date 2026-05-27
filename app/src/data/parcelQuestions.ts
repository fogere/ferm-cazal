import type { ParcelQuestion } from '../types'

/**
 * Questionnaire d'enrichissement des fiches terrain.
 *
 * Chaque question vient des fiches papier `fichier/*.docx/.odt/.odp` que
 * Nils a écrites au fil des années. La famille (Eugénie, Benoît, Chacha, Nils
 * + 1) reconnaîtra les citations directement.
 *
 * Chaque question :
 *   - `sourceDoc` + `sourceQuote` = on cite exactement le doc d'origine
 *   - `question` = la question concrète à laquelle on doit répondre
 *   - `context` = pourquoi on demande, ce qui sera fait avec la réponse
 *   - `questionType` = forme de la réponse (texte, choix, carte…)
 *
 * Les réponses sont stockées dans Firestore `parcel_answers/{question.id}`.
 *
 * Pour ajouter/modifier une question : éditer ce fichier, redéployer.
 * Les réponses existantes restent (clé par id stable).
 */

export const PARCEL_QUESTIONS: ParcelQuestion[] = [

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ DOC 1 — Fond Rouge bas 988                                          ║
  // ╠══════════════════════════════════════════════════════════════════════╣
  // ║ Déjà importé : enrichissement du plot 'Fond rouge en bas' + 3       ║
  // ║ sessions de pâturage. Reste à clarifier : le ruisseau + obs eau.    ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  {
    id:           'd1-q1-ruisseau-existant',
    sourceDoc:    'fichier/Fond rouge bas 988.odt',
    sourceQuote:  '« Un ruisselet s\'écoule dans cet ancien chemin à certaines périodes. »',
    category:     'water_match',
    question:     'Ce ruisselet existe-t-il déjà sur la carte comme cours d\'eau ?',
    context:      'Si oui : on lui attache le journal d\'observations du doc 1 (4 dates entre déc 2024 et fév 2026). Sinon on le crée (question suivante).',
    questionType: 'yes_no',
    order:        110,
  },
  {
    id:           'd1-q2-ruisseau-placement',
    sourceDoc:    'fichier/Fond rouge bas 988.odt',
    sourceQuote:  '« Un ruisselet s\'écoule dans cet ancien chemin à certaines périodes. »',
    category:     'water_match',
    question:     'Si le ruisselet n\'existe pas encore : trace son chemin sur la carte (polyligne).',
    context:      'Ne pas répondre si on a déjà identifié un ruisseau existant à la question précédente.',
    questionType: 'polygon_on_map',
    order:        111,
  },
  {
    id:           'd1-q3-ruisseau-mois-actifs',
    sourceDoc:    'fichier/Fond rouge bas 988.odt',
    sourceQuote:  '« Beaucoup d\'eau le 17 décembre 2024 · écoulement début mai 2025 · Pas d\'eau le 11 décembre 2025 · Beaucoup d\'eau début février 2026 »',
    category:     'water_match',
    question:     'Sur quels mois ce ruisselet coule habituellement ? (cocher tout ce qui s\'applique)',
    context:      'D\'après les observations du doc : actif en hiver/printemps quand il pleut, sec en été et en hiver sec. À toi de cocher les mois où il a coulé au moins une fois ces 5 dernières années.',
    questionType: 'multi_choice',
    options: [
      { id: '1',  label: 'Janvier' },
      { id: '2',  label: 'Février' },
      { id: '3',  label: 'Mars' },
      { id: '4',  label: 'Avril' },
      { id: '5',  label: 'Mai' },
      { id: '6',  label: 'Juin' },
      { id: '7',  label: 'Juillet' },
      { id: '8',  label: 'Août' },
      { id: '9',  label: 'Septembre' },
      { id: '10', label: 'Octobre' },
      { id: '11', label: 'Novembre' },
      { id: '12', label: 'Décembre' },
    ],
    order:        112,
  },
  {
    id:           'd1-q4-confirme-cadastre',
    sourceDoc:    'fichier/Fond rouge bas 988.odt',
    sourceQuote:  '« Parcelle B988 Audinos 3 519m² repris sur îlot 53 à la Pac 2023 »',
    category:     'plot_match',
    question:     'Confirme : la parcelle B988 est bien chez Sophie Audinos en fermage ?',
    context:      'Déjà importé sur le plot "Fond rouge en bas" comme landowner="Sophie Audinos", leaseType="fermage". Si erreur, le préciser.',
    questionType: 'yes_no',
    order:        100,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ DOC 2 — Clairière Hugon et Butte 277                                ║
  // ╠══════════════════════════════════════════════════════════════════════╣
  // ║ Plot "Clairière Hugon" enrichi avec B277. Reste : Le Bois B264 +    ║
  // ║ session attribution + La Butte + eau.                                ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  {
    id:           'd2-q1-le-bois-b264',
    sourceDoc:    'fichier/Clairière Hugon et Butte 277.odt',
    sourceQuote:  '« Le Bois B264 6 440m² »',
    category:     'plot_match',
    question:     'Le Bois B264 — c\'est lequel des plots existants ? Ou faut-il le créer ?',
    context:      'Il y a aujourd\'hui 4 plots nommés "bois" sur la carte. Si l\'un d\'eux correspond à B264, choisis-le. Sinon, réponds "à créer" et on placera le polygone dans une autre question.',
    questionType: 'plot_pick',
    order:        200,
  },
  {
    id:           'd2-q2-le-bois-creer-si-besoin',
    sourceDoc:    'fichier/Clairière Hugon et Butte 277.odt',
    sourceQuote:  '« Le Bois B264 6 440m² »',
    category:     'plot_create',
    question:     'Si Le Bois B264 doit être créé : dessine son contour sur la carte.',
    context:      'À répondre uniquement si la question précédente a indiqué "à créer".',
    questionType: 'polygon_on_map',
    order:        201,
  },
  {
    id:           'd2-q3-la-butte-statut',
    sourceDoc:    'fichier/Clairière Hugon et Butte 277.odt',
    sourceQuote:  'Titre du document : « La clairière – La Butte – Le Bois » + nom de fichier « Butte 277 »',
    category:     'plot_match',
    question:     'La Butte : c\'est un sous-secteur de la Clairière Hugon (B277), ou un terrain à part ?',
    context:      'Le doc cite "La Butte" dans le titre mais ne lui donne pas de cadastre dédié. Si à part, on créera un plot Butte séparé.',
    questionType: 'single_choice',
    options: [
      { id: 'sub',      label: 'Sous-secteur de B277 (Clairière Hugon)', hint: 'pas de plot séparé à créer' },
      { id: 'separate', label: 'Plot séparé (à créer)' },
      { id: 'unknown',  label: 'On ne sait plus précisément' },
    ],
    order:        210,
  },
  {
    id:           'd2-q4-sessions-attribution',
    sourceDoc:    'fichier/Clairière Hugon et Butte 277.odt',
    sourceQuote:  '« 17/11/2024 au 17/01/2025 Isis, Nyala, Fiona, Fany · 29/04/2025 au 10/07/2025 Mathurin, Faro · 10/04/2026 au [maintenant] Bilbo, Darius »',
    category:     'session_animals',
    question:     'Ces 3 sessions de pâturage : elles concernent la Clairière B277, Le Bois B264, ou les 2 ensemble ?',
    context:      'Aujourd\'hui les mouvements sont importés sur la Clairière. Si ils étaient en réalité sur Le Bois B264 (ou les 2), on les déplacera après identification du Bois.',
    questionType: 'single_choice',
    options: [
      { id: 'clairiere', label: 'Toutes sur la Clairière B277' },
      { id: 'bois',      label: 'Toutes sur Le Bois B264' },
      { id: 'both',      label: 'Les 2 (parc unique avec passage libre)' },
      { id: 'mixed',     label: 'Ça dépend des sessions (préciser en note)' },
    ],
    order:        220,
  },
  {
    id:           'd2-q5-eau-assec',
    sourceDoc:    'fichier/Clairière Hugon et Butte 277.odt',
    sourceQuote:  '« Plus d\'eau à partir du 10 juillet 2025 ! »',
    category:     'water_match',
    question:     'Cette mention "plus d\'eau le 10/07/2025" — elle concerne quel point d\'eau ou ruisseau ?',
    context:      'On veut attacher l\'observation au bon élément carte. Si rien n\'existe encore, indique-le ; on créera ensuite.',
    questionType: 'plot_pick',
    order:        230,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ DOC 3 — La Campagne avant Roulotte                                  ║
  // ╠══════════════════════════════════════════════════════════════════════╣
  // ║ Tout au questionnaire : aucun plot matché.                          ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  {
    id:           'd3-q1-plot-existe-deja',
    sourceDoc:    'fichier/La Campaigne avant Roulotte.odt',
    sourceQuote:  'Titre : « La Campaigne avant Roulotte » — 2 parcelles 155 (2 420 m²) et 156 (4 165 m²)',
    category:     'plot_match',
    question:     'Ce parc existe-t-il déjà sur la carte sous un autre nom ?',
    context:      'En DB il y a un plot "le terrain de la roullotte" — c\'est le même ou un voisin ? Si un autre plot existant correspond, choisis-le. Sinon "À créer".',
    questionType: 'plot_pick',
    order:        300,
  },
  {
    id:           'd3-q2-plot-creer',
    sourceDoc:    'fichier/La Campaigne avant Roulotte.odt',
    sourceQuote:  '« Parcelle 155 de 2 420m² et parcelle 156 de 4 165m² »',
    category:     'plot_create',
    question:     'Si à créer : dessine le contour du parc "La Campagne avant Roulotte" sur la carte.',
    context:      'Le contour inclut les 2 parcelles (155 + 156) qui sont contiguës.',
    questionType: 'polygon_on_map',
    order:        301,
  },
  {
    id:           'd3-q3-ruisseau-canalise',
    sourceDoc:    'fichier/La Campaigne avant Roulotte.odt',
    sourceQuote:  '« Le 19 mai 2025 Nils canalise le ruisseau. » + « Ruisseau coule toute l\'année »',
    category:     'water_match',
    question:     'Le ruisseau permanent de La Campagne — il existe déjà sur la carte ?',
    context:      'Si oui : on l\'identifie. Sinon : on le crée (tracé à dessiner dans la question suivante).',
    questionType: 'yes_no',
    order:        310,
  },
  {
    id:           'd3-q4-ruisseau-trace',
    sourceDoc:    'fichier/La Campaigne avant Roulotte.odt',
    sourceQuote:  '« Ruisseau coule toute l\'année »',
    category:     'water_match',
    question:     'Si le ruisseau de La Campagne doit être créé : trace-le.',
    context:      'Polyligne. Le doc dit qu\'il coule toute l\'année (donc streamMode = permanent).',
    questionType: 'polygon_on_map',
    order:        311,
  },
  {
    id:           'd3-q5-marais-asseche',
    sourceDoc:    'fichier/La Campaigne avant Roulotte.odt',
    sourceQuote:  '« Depuis 2024 le centre de la parcelle 156 n\'est plus un marais ! »',
    category:     'narrative',
    question:     'Confirme : le centre de la parcelle 156 a bien été asséché en 2024 ? (pour mémoire dans la note du parc)',
    context:      'Juste pour valider ce qu\'on met dans la note narrative du plot.',
    questionType: 'yes_no',
    order:        320,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ DOC 4 — Fontrouge 957                                                ║
  // ╠══════════════════════════════════════════════════════════════════════╣
  // ║ Plot 'fontrouge' enrichi avec 11 parcelles + cadastralRef/pacIlot.  ║
  // ║ Reste : leaseType par parcelle, 5 chevaux non nommés, source.       ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  {
    id:           'd4-q1-cinq-chevaux',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« 29/12/2024 au 25/02/2025 5 chevaux »',
    category:     'session_animals',
    question:     'Quels étaient les 5 chevaux à Fontrouge du 29/12/2024 au 25/02/2025 ?',
    context:      'Le doc ne les nomme pas. Sélectionne les 5 chevaux du cheptel (ou les vrais s\'ils étaient autres). On créera ensuite les enclosure_movements pour chacun.',
    questionType: 'animals_pick',
    order:        400,
  },
  {
    id:           'd4-q2-source-existe',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« Source au dessus de la Fontaine de Font rouge »',
    category:     'water_match',
    question:     'La "Source au dessus de la Fontaine" existe-t-elle déjà sur la carte ?',
    context:      'On a 1 water_stream + 2 water_natural dans la DB. Si l\'une est la source de Fontrouge, identifie-la. Sinon on la crée.',
    questionType: 'plot_pick',
    order:        410,
  },
  {
    id:           'd4-q3-source-trace',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« Source au dessus de la Fontaine de Font rouge » + « la fontaine située au niveau de la route coule »',
    category:     'water_match',
    question:     'Si la source doit être créée : trace son cours sur la carte (polyligne).',
    context:      'Le doc parle d\'un écoulement de surface depuis la source en haut jusqu\'à la fontaine au niveau de la route. 9 observations entre déc 2024 et mai 2025 seront attachées.',
    questionType: 'polygon_on_map',
    order:        411,
  },
  {
    id:           'd4-q4-fontaine-route',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« cependant la fontaine située au niveau de la route coule »',
    category:     'water_match',
    question:     'La "fontaine au niveau de la route" — c\'est un point d\'eau distinct de la source du haut ? Si oui, place-le.',
    context:      'D\'après le doc, c\'est une fontaine qui coule presque toujours (différente de la source intermittente du haut). Probablement un water_natural.',
    questionType: 'pin_on_map',
    order:        412,
  },
  {
    id:           'd4-q5-leasetype-b952',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« B952 — Lucette Authié et Jojo »',
    category:     'owner_confirm',
    question:     'Parcelle B952 (Lucette Authié et Jojo) — quel type de location ?',
    questionType: 'single_choice',
    options: [
      { id: 'fermage',  label: 'Fermage (loyer / accord écrit)' },
      { id: 'gracious', label: 'Gracieux (prêt amical)' },
      { id: 'owned',    label: 'À nous (achat / héritage)' },
      { id: 'unknown',  label: 'On ne sait plus' },
    ],
    order:        420,
  },
  {
    id:           'd4-q6-leasetype-manenti',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« B955, B956 — Manenti · Accord 6/01/25 »',
    category:     'owner_confirm',
    question:     'Parcelles B955 et B956 (Manenti, avec "Accord 6/01/25") — quel type de location ?',
    questionType: 'single_choice',
    options: [
      { id: 'fermage',  label: 'Fermage (Accord = bail signé)' },
      { id: 'gracious', label: 'Gracieux (accord verbal sans loyer)' },
      { id: 'owned',    label: 'À nous' },
      { id: 'unknown',  label: 'On ne sait plus' },
    ],
    order:        421,
  },
  {
    id:           'd4-q7-leasetype-audinos',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« B957 — Audinos · Entrée »',
    category:     'owner_confirm',
    question:     'Parcelle B957 (Audinos, l\'entrée du parc) — quel type de location ?',
    context:      'Note : doc 1 dit qu\'Audinos = fermage pour B988. Probablement même type ici, mais à confirmer.',
    questionType: 'single_choice',
    options: [
      { id: 'fermage',  label: 'Fermage' },
      { id: 'gracious', label: 'Gracieux' },
      { id: 'owned',    label: 'À nous' },
      { id: 'unknown',  label: 'On ne sait plus' },
    ],
    order:        422,
  },
  {
    id:           'd4-q8-leasetype-miquel',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« B958, B959, B971, B972 — Miquel Thierry et Paul »',
    category:     'owner_confirm',
    question:     'Parcelles B958/B959/B971/B972 (Miquel Thierry et Paul) — quel type de location ?',
    questionType: 'single_choice',
    options: [
      { id: 'fermage',  label: 'Fermage' },
      { id: 'gracious', label: 'Gracieux' },
      { id: 'owned',    label: 'À nous' },
      { id: 'unknown',  label: 'On ne sait plus' },
    ],
    order:        423,
  },
  {
    id:           'd4-q9-leasetype-allabert',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« B970, B973 — Allabert Benoît » + « Stop Fabrice ! »',
    category:     'owner_confirm',
    question:     'Parcelles B970/B973 (Allabert Benoît) — quel type de location ?',
    context:      'La note "Stop Fabrice !" suggère qu\'il y a eu un souci avec Fabrice (membre de la famille Allabert ?). À garder en tête.',
    questionType: 'single_choice',
    options: [
      { id: 'fermage',  label: 'Fermage' },
      { id: 'gracious', label: 'Gracieux' },
      { id: 'owned',    label: 'À nous' },
      { id: 'unknown',  label: 'On ne sait plus' },
    ],
    order:        424,
  },
  {
    id:           'd4-q10-leasetype-rumeau',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« B975 — Marie Rumeau (542 m²) »',
    category:     'owner_confirm',
    question:     'Parcelle B975 (Marie Rumeau) — quel type de location ?',
    questionType: 'single_choice',
    options: [
      { id: 'fermage',  label: 'Fermage' },
      { id: 'gracious', label: 'Gracieux' },
      { id: 'owned',    label: 'À nous' },
      { id: 'unknown',  label: 'On ne sait plus' },
    ],
    order:        425,
  },
  {
    id:           'd4-q11-bordures-saisonnieres',
    sourceDoc:    'fichier/Fontrouge 957.docx',
    sourceQuote:  '« Parcelle 960 (Lucette-Jojo) et parcelle 954 (indivision Laffont) ouverture à partir du 3 février. · Parcelle 969 de Miquel, ouverture le 17 février 2025 et le tout haut de Allabert (Stop Fabrice!) »',
    category:     'narrative',
    question:     'Ces parcelles bordières (960, 954, 969, tout haut Allabert) — on en fait quoi ?',
    context:      'Elles ne font pas partie du parc principal mais s\'ouvrent saisonnièrement. 3 options.',
    questionType: 'single_choice',
    options: [
      { id: 'note',      label: 'Juste les noter dans la note du parc principal' },
      { id: 'parcels',   label: 'Les ajouter aux parcels[] avec une note saisonnière' },
      { id: 'subplot',   label: 'Créer un sous-parc "Fontrouge bordures saisonnières"' },
      { id: 'ignore',    label: 'Les ignorer (info plus à jour)' },
    ],
    order:        430,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ DOC 5 — Le Bergeret B2101 + B2102                                    ║
  // ╠══════════════════════════════════════════════════════════════════════╣
  // ║ Aucun plot en DB. Tout à créer.                                      ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  {
    id:           'd5-q1-plot-existe-deja',
    sourceDoc:    'fichier/Le Bergeret B21O1 et B2102.docx',
    sourceQuote:  '« Le Bergeret B2101 385 m² · B2102 12 415 m² »',
    category:     'plot_match',
    question:     'Le Bergeret existe-t-il déjà sur la carte sous un autre nom ?',
    context:      'Pas de "Bergeret" évident en DB. Si un autre plot existant correspond, choisis-le. Sinon "À créer".',
    questionType: 'plot_pick',
    order:        500,
  },
  {
    id:           'd5-q2-plot-creer',
    sourceDoc:    'fichier/Le Bergeret B21O1 et B2102.docx',
    sourceQuote:  '« Le Bergeret en bordures de la route des Cazals · îlot n°65 engagé à la Pac 2025 pour 1ha27 »',
    category:     'plot_create',
    question:     'Dessine le contour du Bergeret sur la carte (les 2 parcelles ensemble).',
    context:      'B2101 (385 m²) + B2102 (12 415 m²) = 12 700 m². En bordure de la route des Cazals. Permet la jonction de "Toni" au parc de la Roulotte.',
    questionType: 'polygon_on_map',
    order:        501,
  },
  {
    id:           'd5-q3-baignoire-place',
    sourceDoc:    'fichier/Le Bergeret B21O1 et B2102.docx',
    sourceQuote:  '« Baignoire fonte de Bérangère à remplir par la Fontaine »',
    category:     'water_match',
    question:     'Place le pin "Baignoire fonte" (water_manual) sur la carte.',
    context:      'C\'est une baignoire en fonte donnée par Bérangère, qui sert d\'abreuvoir et qu\'on remplit depuis la Fontaine. Si elle existe déjà comme pin, sélectionne-la dans la question suivante au lieu de la placer.',
    questionType: 'pin_on_map',
    order:        510,
  },
  {
    id:           'd5-q4-source-toni-place',
    sourceDoc:    'fichier/Le Bergeret B21O1 et B2102.docx',
    sourceQuote:  '« La source qui alimente Toni · Source au dessus de Toni · réservoir avec un couvercle plastique · ce réservoir alimentait au paravent le hameau du Cazal du Haut »',
    category:     'water_match',
    question:     'Place le pin "Source au dessus de Toni" (water_natural) sur la carte.',
    context:      'Réservoir avec couvercle plastique. Permet d\'immerger une pompe pour utiliser l\'eau pure quand la fontaine ne coule plus.',
    questionType: 'pin_on_map',
    order:        511,
  },
  {
    id:           'd5-q5-trois-pouliches',
    sourceDoc:    'fichier/Le Bergeret B21O1 et B2102.docx',
    sourceQuote:  '« 18/11/2025 au 18/12/2025 Diane, Violette, Roxane et 3 Pouliches · 27/04/2026 au Diane, Violette, Roxane et 3 Pouliches »',
    category:     'session_animals',
    question:     'Les "3 Pouliches" mentionnées — qui sont-elles dans le cheptel actuel ?',
    context:      'Probablement nées en 2025 (donc à peu près 1 an en novembre 2025). Sélectionne-les si elles ont des noms dans la DB, sinon laisse vide.',
    questionType: 'animals_pick',
    order:        520,
  },
  {
    id:           'd5-q6-kalinka-statut',
    sourceDoc:    'fichier/Le Bergeret B21O1 et B2102.docx',
    sourceQuote:  '« 25/02/2025 au 19/03/2025 Kastille, Kalinka, Michka, Ragazo et Quérus »',
    category:     'session_animals',
    question:     'Kalinka : où est-elle ? (elle est citée mais absente du cheptel actuel)',
    questionType: 'single_choice',
    options: [
      { id: 'sold',     label: 'Vendue / partie' },
      { id: 'died',     label: 'Décédée' },
      { id: 'missing',  label: 'Encore là, juste pas saisie dans l\'app — à créer' },
      { id: 'typo',     label: 'C\'est un autre nom (préciser en note)' },
      { id: 'unknown',  label: 'On ne se souvient plus' },
    ],
    order:        530,
  },
  {
    id:           'd5-q7-echange-carbone',
    sourceDoc:    'fichier/Le Bergeret B21O1 et B2102.docx',
    sourceQuote:  '« Permet la jonction de Toni au parc de la Roulotte grâce Echange Carbone acté le 25 Février 2025. »',
    category:     'narrative',
    question:     'L\'Echange Carbone a-t-il bien été acté le 25/02/2025 ?',
    context:      'C\'est important pour le leaseType (owned via échange foncier) et la note du plot.',
    questionType: 'yes_no',
    order:        540,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ DOC 6 — Larivière Nalzen                                             ║
  // ╠══════════════════════════════════════════════════════════════════════╣
  // ║ Plot 'Larivière' enrichi avec note + surfaceM2. 2 zones distinctes  ║
  // ║ (Parc 4ha + riveraines D117). Beaucoup de sessions à clarifier.     ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  {
    id:           'd6-q1-deux-zones',
    sourceDoc:    'fichier/Larivière Nalzen.docx',
    sourceQuote:  '« Calendrier Pacages [parcelles riveraines] » + « Calendrier de pacage Parc de 4ha »',
    category:     'plot_match',
    question:     'Larivière : un seul parc avec toutes les parcelles, ou 2 plots distincts (4ha + riveraines D117) ?',
    context:      'Le doc a 2 calendriers séparés ; les parcelles riveraines D117 (B2194, B2196, A70, A81, parcelle 81) sont de l\'autre côté de la rivière. À toi de décider la granularité voulue sur la carte.',
    questionType: 'single_choice',
    options: [
      { id: 'one',  label: '1 seul plot (toutes les parcelles dans parcels[])' },
      { id: 'two',  label: '2 plots distincts (Larivière 4ha + Larivière riveraines D117)' },
    ],
    order:        600,
  },
  {
    id:           'd6-q2-riveraines-creer',
    sourceDoc:    'fichier/Larivière Nalzen.docx',
    sourceQuote:  '« B2194 et B2196 de l\'autre rive en bordure D117 »',
    category:     'plot_create',
    question:     'Si 2 plots : trace le contour des parcelles riveraines D117 sur la carte.',
    context:      'À répondre seulement si question précédente = "2 plots distincts".',
    questionType: 'polygon_on_map',
    order:        601,
  },
  {
    id:           'd6-q3-riviere-existe',
    sourceDoc:    'fichier/Larivière Nalzen.docx',
    sourceQuote:  '« Le guet est plus facile à traverser (Tracteur) en août lorsqu\'il est asséché »',
    category:     'water_match',
    question:     'La rivière de Larivière (water_stream) existe-t-elle déjà sur la carte ?',
    context:      'Si oui : on lui attache les 6 observations de débit. Sinon : on la crée (question suivante).',
    questionType: 'plot_pick',
    order:        610,
  },
  {
    id:           'd6-q4-riviere-tracer',
    sourceDoc:    'fichier/Larivière Nalzen.docx',
    sourceQuote:  '« Le guet · le long de la rivière · le long du ruisseau »',
    category:     'water_match',
    question:     'Si la rivière doit être créée : trace-la sur la carte.',
    context:      'Polyligne. Mode permanent (se réduit en vasques en été mais ne s\'assèche pas totalement).',
    questionType: 'polygon_on_map',
    order:        611,
  },
  {
    id:           'd6-q5-sessions-avec-kalinka',
    sourceDoc:    'fichier/Larivière Nalzen.docx',
    sourceQuote:  '« 15/03/2024 Michka, Kalinka · 17/11/2024 Ragazzo, Querus, Kastille, Kalinka, Michka · 14/04/2025 Ragazzo, Querus, Kastille, Kalinka, Michka »',
    category:     'session_animals',
    question:     'Pour les 4 sessions où Kalinka est mentionnée : comment on les traite ?',
    context:      'Kalinka est absente du cheptel actuel. Pour importer ces sessions, il faut soit la créer (mais Nils a dit "aucun animal à ajouter"), soit ignorer Kalinka et garder les autres animaux, soit skipper les sessions entières.',
    questionType: 'single_choice',
    options: [
      { id: 'skip_session',  label: 'Skipper toutes ces sessions (perte d\'historique)' },
      { id: 'skip_kalinka',  label: 'Importer les sessions sans Kalinka (garder les autres animaux)' },
      { id: 'create_kalinka',label: 'Créer Kalinka dans la DB et importer normalement' },
    ],
    order:        620,
  },
  {
    id:           'd6-q6-fidji-vaina',
    sourceDoc:    'fichier/Larivière Nalzen.docx',
    sourceQuote:  '« 19/03/2024 Violette, Kastille, Fidji, Uguette, Vaina · 19/03/2023 14 jours Violette, Kastille, Fidji, Uguette, Vaina »',
    category:     'session_animals',
    question:     'Fidji et Vaina (citées en 2023-2024) : statut actuel ?',
    questionType: 'multi_choice',
    options: [
      { id: 'fidji_sold',     label: 'Fidji : vendue/partie' },
      { id: 'fidji_died',     label: 'Fidji : décédée' },
      { id: 'fidji_create',   label: 'Fidji : à créer dans la DB' },
      { id: 'vaina_sold',     label: 'Vaina : vendue/partie' },
      { id: 'vaina_died',     label: 'Vaina : décédée' },
      { id: 'vaina_create',   label: 'Vaina : à créer dans la DB' },
    ],
    order:        621,
  },
  {
    id:           'd6-q7-date-typo',
    sourceDoc:    'fichier/Larivière Nalzen.docx',
    sourceQuote:  '« 19/03/2023 au 01/04/2023 14 jours Violette, Kastille, Fidji, Uguette, Vaina »',
    category:     'session_dates',
    question:     'La date 19/03/2023 est-elle correcte ?',
    context:      'Ailleurs dans le doc on a 19/03/2024 (mêmes animaux). Possible typo 2023 → 2024. Confirme.',
    questionType: 'single_choice',
    options: [
      { id: '2023',  label: 'C\'est bien 2023' },
      { id: '2024',  label: 'C\'est en réalité 2024 (typo)' },
      { id: 'unknown',label: 'On ne sait plus' },
    ],
    order:        630,
  },
  {
    id:           'd6-q8-avril-2026-conflit',
    sourceDoc:    'fichier/Larivière Nalzen.docx',
    sourceQuote:  '« Avril 2026 Império, Saison et Uguette » (calendrier riveraines) + « 11/04/2026 au Império, Saison et Uguette » (Parc 4ha)',
    category:     'session_dates',
    question:     'Avril 2026 : les mêmes animaux apparaissent dans les 2 calendriers. C\'est 1 ou 2 sessions ?',
    questionType: 'single_choice',
    options: [
      { id: 'one',         label: '1 seule session — sur le Parc 4ha (riveraines = mention par erreur)' },
      { id: 'one_river',   label: '1 seule session — sur les riveraines (4ha = erreur)' },
      { id: 'two_seq',     label: '2 sessions séquentielles (d\'abord riveraines puis 4ha)' },
      { id: 'two_both',    label: 'Les 2 zones étaient ouvertes en même temps' },
    ],
    order:        631,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ DOC 7 — Grand Pré Castel 0166                                        ║
  // ╠══════════════════════════════════════════════════════════════════════╣
  // ║ Présentation .odp sans texte exploitable. Demande complète à la      ║
  // ║ famille.                                                              ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  {
    id:           'd7-q1-plot-match',
    sourceDoc:    'fichier/Grand pré du Castel 0166.odp',
    sourceQuote:  'Titre : « Grand pré du Castel 0166 » (slide unique, contenu visuel)',
    category:     'plot_match',
    question:     'Le "Grand Pré du Castel" — c\'est quel plot existant ?',
    context:      'En DB il y a "Le pré du Castel". Probable match, mais à confirmer. Sinon créer.',
    questionType: 'plot_pick',
    order:        700,
  },
  {
    id:           'd7-q2-cadastre',
    sourceDoc:    'fichier/Grand pré du Castel 0166.odp',
    sourceQuote:  'Le titre cite "0166" — probable référence cadastrale (parcelle 0166)',
    category:     'plot_match',
    question:     'Référence cadastrale du Grand Pré du Castel ?',
    context:      'Le titre du doc dit "0166". Format type : "B0166" ou juste "0166". Confirme la référence exacte.',
    questionType: 'text',
    order:        701,
  },
  {
    id:           'd7-q3-contenu-slide',
    sourceDoc:    'fichier/Grand pré du Castel 0166.odp',
    sourceQuote:  '(diapositive image — pas de texte extractible)',
    category:     'narrative',
    question:     'Décris ce qu\'il y a sur la slide du Grand Pré du Castel.',
    context:      'On ne peut pas lire le contenu de la présentation automatiquement (pas de texte, juste une image). Décris en quelques lignes : parcelles, animaux, eau, particularités. On l\'intégrera dans la note du plot.',
    questionType: 'long_text',
    order:        702,
  },
  {
    id:           'd7-q4-animaux-actuels',
    sourceDoc:    'fichier/Grand pré du Castel 0166.odp',
    sourceQuote:  '(diapositive image)',
    category:     'session_animals',
    question:     'Y a-t-il actuellement des animaux placés au Grand Pré du Castel ?',
    questionType: 'animals_pick',
    order:        703,
  },
  {
    id:           'd7-q5-points-eau',
    sourceDoc:    'fichier/Grand pré du Castel 0166.odp',
    sourceQuote:  '(diapositive image)',
    category:     'water_match',
    question:     'Y a-t-il un point d\'eau / source / ruisseau au Grand Pré du Castel ? Si oui place-le.',
    questionType: 'pin_on_map',
    order:        710,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ QUESTIONS TRANSVERSES (animaux fantômes, plots ambigus)             ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  {
    id:           'dT-q1-bois-plots-doublons',
    sourceDoc:    '(transverse)',
    sourceQuote:  '4 plots en DB nommés "bois" (sans cadastralRef)',
    category:     'plot_match',
    question:     'Il y a 4 plots "bois" sur la carte. Sont-ce vraiment 4 plots distincts, ou des doublons à nettoyer ?',
    context:      'On a vu : "bois", "bois", "bois", "bois cazalis", "bois mordor", "petit bois", "mordor", "Cazal". Certains sont peut-être créés en double par erreur.',
    questionType: 'long_text',
    order:        900,
  },
  {
    id:           'dT-q2-casalis-plots-doublons',
    sourceDoc:    '(transverse)',
    sourceQuote:  '4 plots "casalis", "lande casalis", "cazalis", "casalis prés de fauche" en DB',
    category:     'plot_match',
    question:     'Pareil pour les plots "casalis"/"cazalis" — précise leur rôle respectif.',
    context:      'On a "casalis" (×4), "lande casalis", "cazalis", "casalis prés de fauche". Possible doublons ou vraiment plusieurs zones distinctes.',
    questionType: 'long_text',
    order:        901,
  },
  {
    id:           'dT-q3-plots-mystere',
    sourceDoc:    '(transverse)',
    sourceQuote:  'plots existants : "a definir comme nom je connais pas", "afp", "j" (×2), "t"',
    category:     'plot_match',
    question:     'Ces plots ont des noms mystères ("a definir", "afp", "j", "t") — vous les renommez quoi ?',
    context:      'Probablement créés rapidement sans nom définitif. À renommer ou supprimer si doublons.',
    questionType: 'long_text',
    order:        902,
  },
]

// Petit récap chiffré pour faciliter le suivi (sera affiché en haut de la page)
export const PARCEL_QUESTIONS_BY_DOC = (() => {
  const groups: Record<string, ParcelQuestion[]> = {}
  for (const q of PARCEL_QUESTIONS) {
    if (!groups[q.sourceDoc]) groups[q.sourceDoc] = []
    groups[q.sourceDoc].push(q)
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.order - b.order)
  return groups
})()
