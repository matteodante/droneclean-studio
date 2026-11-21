import type { DocPageContent } from '../../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Montage de base sur la timeline',
  description:
    'Pistes, ajout de clips, sélection, coupe et jonction, suppression, aimantation, marqueurs, plages, séquences et zoom.',
  category: 'Core Editing',
  related: ['editing-tools', 'preview', 'media', 'export', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Pistes',
      blocks: [
        {
          kind: 'list',
          items: [
            'Les **pistes vidéo** contiennent les éléments visuels : vidéo, images, texte, formes, sous-titres et calques d’ajustement.',
            'Les **pistes audio** contiennent les clips audio et l’audio lié aux fichiers vidéo.',
            'Ajoutez des pistes avec **Ajouter une piste vidéo** ou **Ajouter une piste audio** quand vous avez besoin de plus de place.',
            'Les commandes d’une piste comprennent **Verrouiller**, **Solo**, **Activer/Désactiver** (visibilité) et le verrouillage de synchronisation.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les groupes de pistes n’ont qu’un seul niveau de profondeur et servent d’en-têtes : la coupure du son, la visibilité et le verrouillage se transmettent d’un groupe à ses pistes.',
        },
      ],
    },
    {
      title: 'Ajouter et agencer des clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Glissez un clip du panneau Médias vers une piste vidéo ou audio.',
            'Utilisez l’outil de **sélection** (`V`) pour déplacer et réorganiser les clips.',
            'La **sélection liée** fait avancer ensemble un clip vidéo et son audio ; déliez-les pour modifier l’un sans l’autre.',
            'Déplacez légèrement un élément sélectionné avec `Shift+Arrow` (1 px) ou `Ctrl+Shift+Arrow` (10 px).',
          ],
        },
      ],
    },
    {
      title: 'Couper, joindre et supprimer',
      blocks: [
        {
          kind: 'list',
          items: [
            'Coupez à la tête de lecture avec `Alt+C`, ou utilisez l’outil **rasoir** (`C`) pour couper à l’endroit où vous cliquez.',
            'Joignez des sections adjacentes d’un même clip avec `Shift+J`.',
            '**Supprimer** laisse un vide ; **Suppression en cascade** (`Ctrl+Delete`) retire le clip et referme le vide.',
            'Utilisez **Fermer tous les écarts** pour rapprocher les clips et supprimer l’espace vide sur une piste.',
          ],
        },
      ],
    },
    {
      title: 'Aimantation, marqueurs et plages',
      blocks: [
        {
          kind: 'list',
          items: [
            'Activez ou désactivez l’aimantation avec `S` pour que les clips s’aimantent aux coupes proches, aux marqueurs et à la tête de lecture.',
            'Ajoutez un marqueur avec `M` pour des notes et des repères de timing ; passez d’un marqueur à l’autre avec `[` et `]`.',
            'Définissez un point d’entrée (`I`) et un point de sortie (`O`) pour délimiter une plage d’aperçu et d’exportation ; effacez-les avec `Alt+X`.',
          ],
        },
      ],
    },
    {
      title: 'Séquences (multi-timeline)',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Une **séquence** est une timeline autonome, avec ses propres pistes, clips, marqueurs et plage d’entrée/sortie. La barre d’onglets au-dessus de la timeline liste la timeline **principale** et chaque séquence : cliquez sur un onglet pour choisir celle que vous modifiez.',
        },
        {
          kind: 'list',
          items: [
            'Créez une séquence avec le bouton **+** à la fin de la barre d’onglets ; elle s’ouvre dans son propre onglet.',
            'Changez de séquence en cliquant sur un onglet ; l’onglet **principal** est toujours le premier.',
            'Double-cliquez sur un onglet pour le **renommer**, ou utilisez le menu d’options de l’onglet (⋮) pour **Renommer**, **Fermer l’onglet** et **Supprimer la séquence**.',
            '**Fermer l’onglet** ne retire que l’onglet : la séquence reste disponible dans le panneau Médias et dans tous les clips qui la référencent. **Supprimer la séquence** la retire entièrement (annulable), avec tous les clips qui la référencent.',
            'Un **clip composé** peut être ouvert comme onglet de séquence : dans le panneau Médias, faites un clic droit sur un clip composé et choisissez **Ouvrir comme onglet** pour le modifier comme une timeline autonome.',
            'Déposez une séquence sur la timeline pour l’imbriquer comme un clip (étiqueté **Séquence**) ; double-cliquez sur ce clip pour aller à son onglet.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Chaque séquence conserve ses propres marqueurs, sa plage d’entrée/sortie, sa vue et son historique d’annulation : changer d’onglet ne les mélange jamais.',
        },
      ],
    },
    {
      title: 'Zoom et annulation',
      blocks: [
        {
          kind: 'list',
          items: [
            'Zoomez avec `Ctrl+=` et `Ctrl+-`, ajustez tout le montage avec `\\`, et revenez à 100 % avec `Shift+\\`.',
            'Le zoom ne change que la vue, jamais le timing des clips.',
            'Annulez avec `Ctrl+Z` et rétablissez avec `Ctrl+Shift+Z` ; la profondeur de l’historique d’annulation se règle dans les Paramètres.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
