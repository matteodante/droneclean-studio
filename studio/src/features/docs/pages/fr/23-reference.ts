import type { DocPageContent } from '../../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: 'Référence',
  description: 'Les formats pris en charge et un glossaire des termes employés dans ce guide.',
  category: 'Reference',
  related: ['concepts', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Formats',
      blocks: [
        {
          kind: 'table',
          headers: ['Usage', 'Types'],
          rows: [
            ['Importation', 'Vidéo, audio, image, GIF, SVG, ressources générées, clips composés'],
            ['Exportation vidéo', 'MP4, MOV, WebM, MKV'],
            ['Exportation audio', 'MP3, AAC, WAV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La prise en charge des codecs dépend de ce que votre navigateur peut décoder et encoder.',
        },
      ],
    },
    {
      title: 'Termes de montage',
      blocks: [
        {
          kind: 'table',
          headers: ['Terme', 'Signification'],
          rows: [
            [
              'Plage d’entrée/sortie',
              'Un début et une fin marqués, utilisés pour les montages à partir d’une source et les plages d’exportation.',
            ],
            [
              'Marge source',
              'Images de réserve au-delà du bord d’un clip, nécessaires aux rognages et aux transitions.',
            ],
            [
              'Montage en cascade (ripple)',
              'Une modification qui décale le matériel suivant pour ouvrir ou refermer de l’espace sur la timeline.',
            ],
            ['Montage rolling', 'Une modification qui déplace la coupe entre deux clips voisins.'],
            [
              'Montage slip',
              'Change les images source à l’intérieur d’un clip sans déplacer le clip.',
            ],
            ['Montage slide', 'Déplace un clip en ajustant les coupes voisines.'],
          ],
        },
      ],
    },
    {
      title: 'Termes des fonctions',
      blocks: [
        {
          kind: 'table',
          headers: ['Terme', 'Signification'],
          rows: [
            ['Espace de travail', 'Le dossier dans lequel DroneClean Studio lit et écrit.'],
            [
              'Proxy',
              'Une copie générée plus légère d’un média lourd, utilisée pour une lecture plus fluide.',
            ],
            ['Clip composé', 'Une section de timeline regroupée en un seul média réutilisable.'],
            [
              'Calque d’ajustement',
              'Un calque dont les effets et l’étalonnage s’appliquent aux clips situés en dessous.',
            ],
            ['Image clé', 'Une valeur définie à un instant précis pour animer une propriété.'],
            [
              'LUT',
              'Une table de correspondance (.cube) qui applique une transformation de couleur.',
            ],
            [
              'Piste cible',
              'La piste de la timeline vers laquelle est envoyée une modification du moniteur source.',
            ],
            ['File de rendu', 'Une liste ordonnée d’exportations rendues une à la fois.'],
            [
              'Vérification préalable',
              'Le contrôle de disponibilité qui s’exécute avant le début d’une exportation.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
