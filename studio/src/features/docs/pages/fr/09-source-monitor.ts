import type { DocPageContent } from '../../docs-content'

const page = {
  order: 9,
  slug: 'source-monitor',
  title: 'Flux de travail du moniteur source',
  description:
    'Prévisualiser une source, marquer une plage d’entrée/sortie, choisir les pistes cibles, puis insérer ou écraser sur la timeline.',
  category: 'Core Editing',
  related: ['media', 'timeline', 'scene-browser'],
  sections: [
    {
      title: 'Ouvrir une source',
      blocks: [
        {
          kind: 'list',
          items: [
            'Double-cliquez sur une carte de média, ou utilisez **Ouvrir dans le moniteur source** depuis les Infos du média, pour charger une source.',
            'L’en-tête du moniteur affiche le nom du fichier source, avec une commande de fermeture pour le quitter.',
            'La lecture de la source est indépendante de l’aperçu de la timeline : vous pouvez parcourir une source sans déplacer la tête de lecture de la timeline.',
            'Cliquez sur l’affichage du code temporel pour basculer entre code temporel et numéro d’image.',
          ],
        },
      ],
    },
    {
      title: 'Marquer une plage d’entrée/sortie',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Placez-vous sur la première image voulue et appuyez sur `I` (**Marquer le point d’entrée**).',
            'Placez-vous sur l’image qui suit votre dernière image voulue et appuyez sur `O` (**Marquer le point de sortie**) : le point de sortie est exclusif.',
            'Affinez en faisant glisser la poignée d’entrée, la poignée de sortie, ou la plage entière sur la bande.',
            'Utilisez **Lire de l’entrée à la sortie** pour revoir seulement la plage, ou `Alt+X` pour l’effacer et utiliser la source entière.',
          ],
        },
      ],
    },
    {
      title: 'Choisir les pistes cibles',
      blocks: [
        {
          kind: 'list',
          items: [
            'La bascule **V** active ou désactive la piste cible vidéo de la source ; la bascule **A** fait de même pour l’audio.',
            'Chaque bascule a un sélecteur de destination : **Auto**, une piste précise par son nom, ou **Créer au montage** pour créer une nouvelle piste.',
            'Une vidéo avec son place une paire vidéo et audio liée sur les pistes cibles V et A.',
            'La piste active de la timeline préremplit les destinations V et A correspondantes.',
          ],
        },
      ],
    },
    {
      title: 'Insérer et écraser',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Les deux modifications placent la plage marquée à l’image où se trouve la tête de lecture de la timeline, puis avancent la tête de lecture à la fin du nouveau clip.',
        },
        {
          kind: 'table',
          headers: ['Modification', 'Touche', 'Ce qu’elle fait'],
          rows: [
            [
              'Insérer',
              '`,`',
              'Place la plage et repousse vers la droite tout le matériel qui suit sur les pistes cibles.',
            ],
            [
              'Écraser',
              '`.`',
              'Remplace tout ce qui se trouve sous la plage sur la timeline, en laissant en place les clips environnants.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les images prennent par défaut une durée de **trois secondes** au montage, sauf si vous marquez une plage plus courte.',
        },
      ],
    },
    {
      title: 'Si une modification ne s’applique pas',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Activez d’abord au moins l’une des cibles **V** ou **A**. Pour modifier de l’audio, activez **A** ; pour modifier une vidéo muette ou une image, activez **V**. Une piste cible verrouillée bloque aussi la modification : déverrouillez-la et réessayez.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
