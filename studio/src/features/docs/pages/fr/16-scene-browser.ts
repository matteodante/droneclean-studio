import type { DocPageContent } from '../../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: 'Navigateur de scènes et analyse par IA',
  description:
    'Analyser les médias en local pour légender les scènes, puis rechercher par mot-clé, par sens ou par couleur.',
  category: 'Creative Tools',
  related: ['media', 'local-ai', 'source-monitor'],
  sections: [
    {
      title: 'Analyser avec l’IA',
      blocks: [
        {
          kind: 'list',
          items: [
            'Lancez **Analyser avec l’IA** sur un clip depuis la médiathèque, ou depuis le menu **Analyser** du navigateur de scènes.',
            'L’analyse s’exécute entièrement sur votre machine : elle détecte les scènes, légende chacune d’elles, extrait une palette de couleurs et construit des embeddings de texte et d’image.',
            'Choisissez **Analyser les nouveaux médias** pour les clips sans légendes, ou **Tout réanalyser** pour tout rafraîchir.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les résultats sont mis en cache selon le contenu : un média identique est donc réutilisé au lieu d’être analysé de nouveau.',
        },
      ],
    },
    {
      title: 'Ouvrir le navigateur de scènes',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ouvrez le navigateur de scènes depuis la médiathèque, ou avec `Ctrl+Shift+F`.',
            'Il recherche dans les légendes d’IA et les données de scènes produites par Analyser avec l’IA.',
            'Définissez la portée sur tous les médias analysés ou sur un seul clip, et triez par **Pertinence**, **Horodatage** ou **Nom du média**.',
            'Passez de la **Vue liste** à la **Vue grille** selon que vous voulez parcourir ou balayer les résultats.',
          ],
        },
      ],
    },
    {
      title: 'Modes de recherche',
      blocks: [
        {
          kind: 'table',
          headers: ['Mode', 'Correspondance par'],
          rows: [
            [
              'Mot-clé',
              'Les mots exacts d’une légende : idéal pour un objet ou une étiquette précis.',
            ],
            [
              'Sémantique',
              'Le sens : « coucher de soleil sur l’eau » trouve donc des scènes apparentées (la première utilisation télécharge un petit modèle, environ 22 Mo).',
            ],
            [
              'Couleur',
              'Une palette similaire : choisissez une pastille dans la palette de la bibliothèque.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les résultats portent des badges de correspondance (Forte, Bonne ou Moyenne) et indiquent si la correspondance s’est faite par mot-clé, par sens, par similarité visuelle ou par couleur.',
        },
      ],
    },
    {
      title: 'Utiliser un résultat',
      blocks: [
        {
          kind: 'list',
          items: [
            'Cliquez sur une scène pour la prévisualiser dans le moniteur source.',
            'Glissez une scène sur la timeline pour ajouter ce moment à votre montage.',
            'Si rien n’est trouvé, vérifiez que le clip a été analysé : seuls les médias analysés sont consultables.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
