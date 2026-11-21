import type { DocPageContent } from '../../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Espaces de travail et stockage',
  description:
    'Comment fonctionne le dossier d’espace de travail, où se trouvent les fichiers, les autorisations et l’entretien des caches.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: 'Le modèle d’espace de travail',
      blocks: [
        {
          kind: 'list',
          items: [
            'Un **espace de travail** est un dossier unique sur le disque, dans lequel DroneClean Studio lit et écrit.',
            'Tout ce que DroneClean Studio génère s’y trouve : fichiers de projet, métadonnées des médias, vignettes, formes d’onde, transcriptions, données de scènes, ressources d’IA, caches et exports.',
            'Les médias sources importés ne sont pas copiés dans l’espace de travail : DroneClean Studio enregistre un lien vers chaque fichier là où il se trouve déjà sur le disque.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Comme l’espace de travail est un vrai dossier, vous pouvez le sauvegarder, le synchroniser ou le déplacer comme n’importe quel autre répertoire.',
        },
      ],
    },
    {
      title: 'Choisir et changer d’espace de travail',
      blocks: [
        {
          kind: 'list',
          items: [
            'Au premier lancement, DroneClean Studio vous demande de choisir un espace de travail avant d’ouvrir l’éditeur.',
            'Choisissez un dossier ordinaire dont vous êtes propriétaire, par exemple un dossier dans Documents. Évitez les emplacements système protégés.',
            'Utilisez le contrôle **Espaces de travail** pour ajouter, changer ou retirer des espaces de travail connus.',
            'Changer d’espace de travail modifie le dossier utilisé par DroneClean Studio ; vos médias sources ne sont pas déplacés.',
          ],
        },
      ],
    },
    {
      title: 'Autorisations et reconnexion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Par sécurité, les navigateurs peuvent faire expirer l’autorisation d’accès à un dossier d’une session à l’autre.',
        },
        {
          kind: 'list',
          items: [
            'Quand DroneClean Studio affiche **Reconnectez votre espace de travail**, choisissez **Reconnecter** et accordez l’accès en lecture et en écriture au même dossier.',
            'Si l’accès est refusé, choisissez de nouveau le dossier et autorisez l’accès lorsque le navigateur le demande.',
            'Si le dossier a été déplacé, renommé ou supprimé, choisissez plutôt un autre dossier.',
          ],
        },
      ],
    },
    {
      title: 'Médias manquants',
      blocks: [
        {
          kind: 'list',
          items: [
            'Médias manquants signifie que DroneClean Studio ne peut pas lire pour le moment un ou plusieurs fichiers sources liés.',
            'Utilisez **Autoriser l’accès** quand un fichier a seulement besoin d’une nouvelle autorisation du navigateur.',
            'Utilisez **Localiser** ou **Localiser le dossier** quand un fichier ou son dossier a été déplacé.',
            'Utilisez **Parcourir un autre dossier** pour indiquer à DroneClean Studio une nouvelle copie des médias.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Utilisez **Travailler hors ligne** seulement si vous prévoyez de relier les fichiers plus tard ; d’ici là, les clips restent des références rompues.',
        },
      ],
    },
    {
      title: 'Déplacer des projets et vider les caches',
      blocks: [
        {
          kind: 'list',
          items: [
            'Utilisez **Exporter le projet** pour empaqueter un projet et ses médias dans un lot portable qu’un autre espace de travail peut importer.',
            'Les actions de cache du projet effacent les données régénérables, comme les formes d’onde, les bandes de vignettes, les images de GIF et l’audio décodé.',
            'Les réglages de stockage permettent aussi de régénérer les vignettes, de générer les proxys manquants et de supprimer les proxys.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Vider les caches ne supprime jamais vos médias sources ; DroneClean Studio régénère les aperçus quand le projet en a besoin.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
