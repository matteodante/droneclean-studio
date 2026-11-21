import type { DocPageContent } from '../../docs-content'

const page = {
  order: 7,
  slug: 'editing-tools',
  title: 'Outils de montage',
  description:
    'Sélection, rasoir, rognage, slip, slide, étirement de vitesse, et les comportements de rognage en cascade et rolling.',
  category: 'Core Editing',
  related: ['timeline', 'keyboard-shortcuts', 'properties'],
  sections: [
    {
      title: 'Les outils de base',
      blocks: [
        {
          kind: 'table',
          headers: ['Outil', 'Touche', 'Usage'],
          rows: [
            ['Sélection', '`V`', 'Sélectionner, déplacer et agencer les clips.'],
            ['Rognage', '`T`', 'Faire glisser le bord d’un clip pour changer son début ou sa fin.'],
            ['Rasoir', '`C`', 'Couper un clip à l’endroit où vous cliquez.'],
            ['Étirement de vitesse', '`R`', 'Changer la durée en changeant la vitesse de lecture.'],
            ['Slip', '`Y`', 'Changer les images source à l’intérieur d’un clip sans le déplacer.'],
            ['Slide', '`U`', 'Déplacer un clip en ajustant les coupes voisines.'],
          ],
        },
      ],
    },
    {
      title: 'Comportements de rognage',
      blocks: [
        {
          kind: 'list',
          items: [
            'Un rognage **en cascade** (ripple) modifie un montage et décale tout le matériel qui suit : la durée totale change.',
            'Un rognage **rolling** déplace la coupe entre deux clips voisins, sans changer la durée globale.',
            'Une modification **slip** change les images source qui apparaissent dans un clip sans déplacer le clip ni ses voisins.',
            'Une modification **slide** déplace un clip le long de la piste en ajustant automatiquement les coupes voisines.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le rognage en cascade et le rognage rolling sont des comportements de l’outil de **rognage**, et non des outils distincts avec leur propre raccourci.',
        },
      ],
    },
    {
      title: 'Garder les clips synchronisés',
      blocks: [
        {
          kind: 'list',
          items: [
            'La **sélection liée** déplace ensemble un clip vidéo et son audio ; activez-la ou désactivez-la avec `Shift+L`.',
            'Liez des clips avec `Ctrl+Alt+L` et déliez-les avec `Alt+Shift+L` quand une relation doit changer.',
            'Le **verrouillage de synchronisation** d’une piste garde le timing aligné pendant les modifications en cascade.',
          ],
        },
      ],
    },
    {
      title: 'Modifications structurelles',
      blocks: [
        {
          kind: 'list',
          items: [
            'Insérez un **arrêt sur image** à la tête de lecture avec `Shift+F` pour figer une seule image.',
            'Regroupez une suite de clips en un **clip composé** pour réutiliser ou simplifier une section chargée, ou ouvrez-le comme onglet de **séquence** pour le modifier comme une timeline autonome.',
            'Utilisez la boîte de dialogue **Mise en page bento** pour disposer les clips visuels sélectionnés dans une grille structurée.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
