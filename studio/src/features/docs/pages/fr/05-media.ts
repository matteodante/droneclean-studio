import type { DocPageContent } from '../../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Médiathèque',
  description:
    'Importer des médias, inspecter les fichiers et générer des proxys, des transcriptions, des sous-titres et des données de scènes par IA.',
  category: 'Core Editing',
  related: ['source-monitor', 'timeline', 'scene-browser', 'export'],
  sections: [
    {
      title: 'Importer des médias',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ouvrez l’onglet **Médias** et utilisez **Importer** pour choisir des fichiers, ou glissez les fichiers directement dans la bibliothèque.',
            'DroneClean Studio gère la vidéo, l’audio, les images, les GIF, les SVG, les animations Lottie (`.json` et `.lottie`) et les ressources générées. Les GIF sont importés comme des éléments d’image.',
            'Utilisez **Importer un média depuis une URL** pour un lien direct vers un fichier média : l’URL doit pointer vers le fichier lui-même, pas vers une page qui l’intègre.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les vidéos Apple ProRes s’importent, s’affichent en aperçu et génèrent des vignettes comme n’importe quel autre clip, y compris dans des formats que les navigateurs ne savent pas décoder seuls. À l’exportation, les clips ProRes sont ré-encodés dans le codec de sortie que vous avez choisi ; il n’existe pas de format de sortie ProRes.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'L’importation de dossiers n’est pas encore prise en charge : déposez directement les fichiers média. Ce qui peut être décodé dépend de votre navigateur ; si un fichier ne s’importe pas, essayez un autre format ou transcodez-le d’abord.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Les images en log (S-Log3 et similaires) paraissent plates et délavées par construction : c’est ainsi qu’elles sont capturées. Ajoutez un LUT ou un étalonnage pour leur redonner du contraste ; le fichier n’a rien d’anormal.',
        },
      ],
    },
    {
      title: 'Inspecter un clip',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ouvrez **Infos du média** pour voir le codec, les dimensions, la durée, la cadence d’images, la taille du fichier, le type et l’état de la transcription.',
            'Double-cliquez sur une carte de média, ou utilisez **Ouvrir dans le moniteur source**, pour prévisualiser une source avant de la monter.',
            'Les cartes de média proposent des menus pour Fichier, Proxy, Transcription, Sous-titres intégrés et actions d’IA.',
            'Triez, filtrez et groupez les ressources par type quand la bibliothèque devient grande.',
          ],
        },
      ],
    },
    {
      title: 'Générer des données de support',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Ce qu’elle vous apporte'],
          rows: [
            [
              'Générer un proxy',
              'Une version plus légère d’une vidéo lourde pour monter plus fluidement ; l’exportation utilise toujours l’original.',
            ],
            [
              'Générer une transcription',
              'Un texte de la parole, modifiable, dans lequel vous pouvez chercher et que vous pouvez transformer en sous-titres.',
            ],
            [
              'Extraire les sous-titres intégrés',
              'Les pistes de sous-titres extraites du fichier, prêtes à être insérées dans la timeline.',
            ],
            [
              'Analyser avec l’IA',
              'Détection de scènes et légendage en local, pour que les clips deviennent consultables dans le navigateur de scènes.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Clips composés',
      blocks: [
        {
          kind: 'list',
          items: [
            'Regroupez une portion de la timeline en un **clip composé** qui se comporte comme un seul média réutilisable.',
            'Les clips composés apparaissent dans la médiathèque et peuvent être replacés comme n’importe quelle autre ressource.',
            'Faites un clic droit sur un clip composé et choisissez **Ouvrir comme onglet** pour le modifier comme une **séquence** autonome.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les clips composés peuvent être imbriqués, l’un pouvant en contenir un autre, tant que la chaîne ne reboucle jamais sur elle-même.',
        },
      ],
    },
    {
      title: 'Animations Lottie',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Importez des fichiers Lottie, `.json` bruts ou archives `.lottie` empaquetées, comme éléments de timeline rendus à l’image près dans l’aperçu et à l’exportation. Sélectionnez un clip Lottie pour faire apparaître ses commandes de modification dans la section **Lottie** du panneau des propriétés.',
        },
        {
          kind: 'list',
          items: [
            'Réglez la lecture avec **Vitesse**, **Inverser**, **Boucle** et **Ping-pong**.',
            'Définissez un segment **Image de début** / **Image de fin** pour ne lire qu’une partie de l’animation, ou choisissez un **Repère** nommé pour y caler le segment.',
            'Recolorez l’animation : les **Couleurs** nommées par l’auteur sont présentées en premier, les autres formes étant rangées dans une zone dépliable ; une couleur partagée modifie toutes les formes qui l’utilisaient, et **Tout réinitialiser** restaure les originales.',
            'Modifiez sur place les calques de **Texte** du modèle, et ajustez les emplacements de valeurs scalaires et vectorielles exposés sous **Propriétés**.',
            'Pour les archives `.lottie` qui regroupent plusieurs animations, passez de l’une à l’autre avec le sélecteur **Animation** ; changez de palette avec le sélecteur **Thème** quand le fichier fournit des thèmes.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Les modifications de couleur, de texte, d’emplacement et de segment s’affichent en direct sur le canevas pendant que vous faites glisser ou que vous saisissez, et s’enregistrent en une seule étape d’annulation. La modification de l’animation, du thème, du repère, du segment et du modèle s’applique à un seul clip Lottie sélectionné à la fois.',
        },
      ],
    },
    {
      title: 'Réparer les médias manquants',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Médias manquants apparaît quand un fichier lié a été déplacé, renommé, supprimé, ou a besoin d’une nouvelle autorisation. Utilisez **Autoriser l’accès**, **Localiser**, **Localiser le dossier** ou **Parcourir un autre dossier** pour rétablir le lien. Utilisez **Travailler hors ligne** seulement si vous comptez relier les fichiers plus tard.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
