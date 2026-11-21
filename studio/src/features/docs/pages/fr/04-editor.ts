import type { DocPageContent } from '../../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Interface de l’éditeur et navigation',
  description:
    'La barre d’outils, la barre latérale des médias, le moniteur d’aperçu, la timeline, les propriétés et les espaces de travail Montage, Étalonnage et Motion.',
  category: 'Start',
  related: ['concepts', 'timeline', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Les surfaces principales',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Barre d’outils de l’éditeur** (en haut) : retour aux projets, onglets des espaces de travail, spécifications du projet, langue, Paramètres, Raccourcis clavier, Enregistrer, Exporter et la file de rendu.',
            '**Barre latérale des médias** (à gauche) : vos ressources et les outils de création.',
            '**Moniteur d’aperçu** : l’image courante avec ses surimpressions, masques, scopes et commandes de lecture.',
            '**Timeline** (en bas) : pistes, clips, marqueurs et outils de montage.',
            'Panneau **Propriétés** : modifie le ou les clips que vous avez sélectionnés.',
          ],
        },
      ],
    },
    {
      title: 'Les onglets de la barre latérale des médias',
      blocks: [
        {
          kind: 'table',
          headers: ['Onglet', 'Contenu'],
          rows: [
            [
              'Médias',
              'Ressources importées, infos des médias, proxys, transcriptions, sous-titres, clips composés, commandes des médias manquants',
            ],
            ['Texte', 'Clips de texte issus de modèles à un ou plusieurs segments'],
            ['Formes', 'Éléments de forme générés'],
            ['Effets', 'Effets GPU pour le clip sélectionné'],
            ['Transitions', 'Transitions à glisser sur les coupes'],
            ['IA', 'Synthèse vocale et génération de musique en local'],
          ],
        },
      ],
    },
    {
      title: 'Espaces de travail',
      blocks: [
        {
          kind: 'list',
          items: [
            'L’espace de travail **Montage** (`Alt+1`) est la disposition de coupe par défaut : agencement, ajustement, texte, formes, effets, transitions et aperçu.',
            'L’espace de travail **Étalonnage** (`Alt+2`) se concentre sur l’étalonnage, avec roues de couleur, courbes et scopes pour le clip sélectionné.',
            'L’espace de travail **Motion** réunit compositions en calques, images clés, graphiques, préréglages et animation procédurale ; voir [Espace de travail Motion](motion).',
            'Sélectionnez un clip visuel dans Montage et ouvrez **Animation** dans les Propriétés pour accéder aux préréglages courants, à l’état des animations appliquées, au mouvement de texte et à **Créer un clip Motion**.',
            'Changez d’espace de travail avec les onglets de la barre d’outils centrale, ou avec `Alt+1`, `Alt+2` et `Alt+3`.',
          ],
        },
      ],
    },
    {
      title: 'Obtenir de l’aide et travailler en sécurité',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ouvrez **Paramètres** pour les préférences générales, de la timeline, d’IA et de stockage.',
            'Ouvrez **Raccourcis clavier** pour rechercher des commandes, réaffecter des touches et importer ou exporter des préréglages.',
            'Enregistrez souvent avec `Ctrl+S` ; l’enregistrement automatique peut aussi s’exécuter à un intervalle que vous réglez dans les Paramètres.',
            'Annuler et Rétablir (`Ctrl+Z` et `Ctrl+Shift+Z`) couvrent les modifications de la timeline quand quelque chose tourne mal.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
