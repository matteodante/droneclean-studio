import type { DocPageContent } from '../../docs-content'

// order 1.5 places this right after Getting Started in the Start group.
const page = {
  order: 1.5,
  slug: 'concepts',
  title: 'Comment fonctionne DroneClean Studio',
  description:
    'Le modèle mental : stockage local-first, projets et médias liés, images et code temporel, et chaîne de traitement GPU.',
  category: 'Start',
  related: ['workspaces', 'getting-started', 'editing-tools'],
  sections: [
    {
      title: 'Local-first, par conception',
      blocks: [
        {
          kind: 'list',
          items: [
            'DroneClean Studio s’exécute dans votre navigateur et stocke tout dans un **dossier d’espace de travail** sur votre disque.',
            'Vos vidéos et sons d’origine sont **liés**, pas copiés ni téléversés : DroneClean Studio pointe vers les fichiers là où ils se trouvent déjà.',
            'Les projets, les caches, les ressources générées et les exports sont écrits dans l’espace de travail : vous pouvez donc le sauvegarder ou le déplacer comme n’importe quel dossier.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Comme les médias sont liés, déplacer ou renommer un fichier source fait apparaître **Médias manquants** jusqu’à ce que vous le reliiez. Voir [Espaces de travail et stockage](workspaces).',
        },
      ],
    },
    {
      title: 'Projets, pistes et clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Un **projet** contient une timeline, ses réglages (résolution et cadence d’images) et des références aux médias que vous utilisez.',
            'La timeline empile des **pistes** ; les pistes supérieures sont rendues par-dessus les inférieures.',
            'Un **clip** sur la timeline est une fenêtre sur un fichier source : rogner un clip change la partie de la source qui est lue, sans modifier le fichier.',
            'Un **calque d’ajustement** est un clip qui ne porte aucun média propre : il applique ses effets et sa couleur à tous les clips situés en dessous.',
          ],
        },
      ],
    },
    {
      title: 'Séquences et clips composés',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio a une seule primitive pour **une timeline dans votre projet** : la composition. Elle se présente de deux façons, selon l’usage que vous en faites.',
        },
        {
          kind: 'list',
          items: [
            'Une **composition Motion** s’ouvre dans **Motion**, où l’éditeur partagé garde en place vos médias, votre aperçu et vos propriétés pendant que le dock inférieur devient une timeline de calques.',
            'Une **séquence** est une timeline autonome du même projet, ouverte depuis un onglet de la barre d’onglets. Chaque séquence a ses propres pistes, clips et historique de modifications ; la timeline principale est elle-même une séquence.',
            'Un **clip composé** prend une section de la timeline et la replie en un seul média réutilisable. Sur la timeline, il se comporte comme un seul clip (déplacer, rogner, ajouter des effets) tandis que son contenu vit dans sa propre timeline.',
            'Les deux sont la même chose vue différemment : ouvrez un clip composé pour modifier son contenu comme une séquence, et toute séquence peut être déposée dans une autre timeline comme clip composé.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Une composition peut contenir d’autres compositions, mais jamais elle-même : DroneClean Studio bloque les références circulaires, si bien qu’un clip composé ne peut jamais se retrouver imbriqué dans son propre contenu.',
        },
      ],
    },
    {
      title: 'Images et code temporel',
      blocks: [
        {
          kind: 'list',
          items: [
            'Le timing se mesure en **images**. Un clip a une image de début et une longueur en images, à la cadence d’images du projet.',
            'L’aperçu affiche le **code temporel** ; cliquez sur l’affichage dans certaines vues pour passer aux numéros d’image.',
            'Les médias sources peuvent avoir une cadence d’images différente de celle du projet : DroneClean Studio convertit donc les images source en images du projet quand vous montez.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Réglez la résolution et la cadence d’images du projet en fonction de votre cible de livraison au moment de créer le projet.',
        },
      ],
    },
    {
      title: 'Tout est rendu sur votre machine',
      blocks: [
        {
          kind: 'list',
          items: [
            'La lecture, les effets, la couleur et les outils d’IA s’exécutent en local avec votre GPU (WebGPU) et votre CPU (WebCodecs).',
            'Les **proxys** sont des copies plus légères de médias lourds qui rendent le montage fluide ; l’exportation finale utilise toujours les originaux.',
            'Comme il n’y a pas de rendu dans le cloud, garder l’onglet ouvert pendant l’exportation compte : le rendu se fait directement dans le navigateur.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
