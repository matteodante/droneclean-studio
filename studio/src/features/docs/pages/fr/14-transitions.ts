import type { DocPageContent } from '../../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: 'Transitions',
  description:
    'Appliquer une transition à une coupe et en régler le style, la durée, le placement, l’accélération et la direction.',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Appliquer une transition',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Ouvrez l’onglet **Transitions** dans la barre latérale des médias.',
            'Glissez une carte de transition sur une coupe entre deux clips adjacents, ou sélectionnez une coupe valide et cliquez sur une carte.',
            'Sélectionnez la transition sur la timeline pour ouvrir la section **Transition** dans les Propriétés.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Une coupe est valide quand deux clips se touchent bord à bord et disposent d’assez d’images source en réserve pour se chevaucher. Appliquer une transition sur une transition existante la remplace sur place.',
        },
      ],
    },
    {
      title: 'Choisir un style',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Les cartes sont regroupées par catégorie : **Basique**, **Fondu enchaîné**, **Mouvement**, **Balayage**, **Glissement**, **Retournement**, **Masque**, **Iris**, **Forme**, **Lumière** et **Chromatique**.',
        },
        {
          kind: 'list',
          items: [
            'Les styles de fondu vont d’un simple Cross Dissolve aux variantes Additive, Blur et Dip To Color.',
            'Les styles de mouvement et personnalisés comprennent Flip, Light Leak, Pixelate, Chromatic, Radial Blur, Glitch et Sparkles.',
            'Les styles directionnels comme Wipe, Slide et Flip apparaissent sous forme de plusieurs cartes, une par direction.',
          ],
        },
      ],
    },
    {
      title: 'Régler une transition',
      blocks: [
        {
          kind: 'table',
          headers: ['Commande', 'Ce qu’elle fait'],
          rows: [
            ['Préréglage', 'Change le style de la transition sans refaire la coupe.'],
            [
              'Durée',
              'Définit la durée de la transition ; la réinitialisation la ramène à 1 seconde.',
            ],
            [
              'Placement',
              'Centrer sur la coupe, ou décaler la transition avant ou après celle-ci.',
            ],
            ['Accélération', 'Linéaire, Entrée, Sortie, ou Entrée et sortie.'],
            ['Direction', 'Gauche, Droite, Haut ou Bas, pour les styles directionnels.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Vous pouvez aussi redimensionner une transition en faisant glisser son bord directement sur la timeline.',
        },
      ],
    },
    {
      title: 'Quand une transition ne s’applique pas',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Il vous faut une vraie coupe entre deux clips, et assez de **marge source** du côté concerné. Si un placement est bloqué, choisissez un autre placement ou rognez moins. Glisser sur une coupe valide fonctionne toujours, même quand l’application par clic n’est pas disponible.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
