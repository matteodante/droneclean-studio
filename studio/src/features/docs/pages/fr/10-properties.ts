import type { DocPageContent } from '../../docs-content'

const page = {
  order: 10,
  slug: 'properties',
  title: 'Propriétés des clips',
  description:
    'Transformation, recadrage, opacité et fusion, ainsi que les commandes propres à chaque type de clip.',
  category: 'Core Editing',
  related: ['audio', 'text-captions-subtitles', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Comment la sélection pilote le panneau',
      blocks: [
        {
          kind: 'list',
          items: [
            'Sélectionnez un clip pour modifier l’ensemble de ses propriétés.',
            'Sélectionnez plusieurs clips pour changer d’un coup une propriété qu’ils partagent.',
            'Le panneau n’affiche que les onglets des groupes de propriétés qui s’appliquent à la sélection courante.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Une valeur **Mixte** signifie que les clips sélectionnés ne partagent pas ce réglage pour le moment ; la modifier applique une même valeur à tous.',
        },
      ],
    },
    {
      title: 'Commandes communes aux clips visuels',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Transformation** : position, taille, rotation et point d’ancrage.',
            '**Recadrage** : recadrez chaque bord vers l’intérieur, avec une commande d’adoucissement du bord de recadrage.',
            '**Opacité** et **Fusion** : estompez un clip et choisissez comment il se compose sur les calques situés en dessous.',
            '**Vidéo** : vitesse de lecture et timing associé pour les clips vidéo.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Beaucoup de commandes numériques peuvent être animées : cherchez la bascule d’image clé à côté de la valeur.',
        },
      ],
    },
    {
      title: 'Commandes propres à chaque type',
      blocks: [
        {
          kind: 'table',
          headers: ['Type de clip', 'Commandes'],
          rows: [
            [
              'Audio',
              'Gain, fondu d’entrée/de sortie, hauteur tonale, et un égaliseur par clip (voir Montage audio).',
            ],
            [
              'Texte',
              'Contenu, police, taille, couleur, alignement, arrière-plan, espacement, effets et animation (voir la page Texte).',
            ],
            ['Forme', 'Type de forme, tracé, remplissage, contour, masque et adoucissement.'],
            [
              'Sous-titre',
              'Timing et texte des répliques, ainsi que des préréglages de style de sous-titres.',
            ],
            ['Couleur', 'Roues, courbes et outils d’étalonnage (voir Effets et couleur).'],
          ],
        },
      ],
    },
    {
      title: 'Marqueurs',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Le panneau des propriétés liste tous les marqueurs du projet sous un titre **Marqueurs**, triés par temps. La liste est toujours disponible : elle s’affiche sous les réglages du canevas quand rien n’est sélectionné, et sous l’éditeur de marqueur quand un marqueur est sélectionné, si bien que vous pouvez parcourir vos marqueurs et les atteindre quelle que soit la sélection.',
        },
        {
          kind: 'list',
          items: [
            'Chaque ligne affiche la couleur du marqueur, son étiquette (ou un nom par défaut s’il n’en a pas) et son code temporel.',
            'Sélectionnez une ligne pour en faire le marqueur actif et amener la tête de lecture à ce point.',
            'Utilisez l’icône de corbeille d’une ligne pour supprimer ce seul marqueur.',
            '**Tout effacer** supprime tous les marqueurs d’un coup.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Appuyez sur `M` pour poser un marqueur à la tête de lecture. Quand la liste est vide, elle affiche cette astuce.',
        },
        {
          kind: 'paragraph',
          text: 'Sélectionner un marqueur ouvre son éditeur au-dessus de la liste, où vous pouvez changer la position **Image**, modifier l’**Étiquette**, et définir la **Couleur** à partir d’une pastille prédéfinie ou la remettre à la valeur par défaut. Le champ **Temps** affiche le code temporel du marqueur en lecture seule, et **Supprimer le marqueur** le supprime.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
