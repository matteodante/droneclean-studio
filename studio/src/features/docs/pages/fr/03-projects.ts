import type { DocPageContent } from '../../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Projets',
  description:
    'Créer, configurer, dupliquer, organiser, mettre à la corbeille, restaurer et déplacer des projets.',
  category: 'Start',
  related: ['workspaces', 'editor'],
  sections: [
    {
      title: 'Créer et configurer un projet',
      blocks: [
        {
          kind: 'list',
          items: [
            'Créez un projet depuis la page Projets avec **Nouveau projet**.',
            'Définissez le nom du projet, sa description, sa résolution, sa cadence d’images et sa couleur d’arrière-plan.',
            'La résolution et la cadence d’images déterminent le canevas d’exportation et le rythme de la timeline : choisissez-les en fonction de votre livraison finale.',
            'Vous pouvez revoir les spécifications du projet plus tard depuis la barre d’outils de l’éditeur.',
          ],
        },
      ],
    },
    {
      title: 'Taille du canevas et format d’image',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Le canevas définit le cadre dans lequel votre vidéo est composée et exportée. Choisissez une taille à la création du projet, ou modifiez-la à tout moment depuis le panneau **Canevas** pendant le montage.',
        },
        {
          kind: 'paragraph',
          text: 'Dans **Nouveau projet**, la section **Résolution** propose des préréglages prêts à l’emploi pour les plateformes courantes. Chaque carte de préréglage indique sa taille en pixels et son format d’image. Choisissez **Personnalisé** pour saisir une largeur et une hauteur exactes.',
        },
        {
          kind: 'table',
          headers: ['Préréglage', 'Résolution', 'Format d’image'],
          rows: [
            ['YouTube 1080p', '`1920x1080`', '`16:9` paysage'],
            ['Shorts / TikTok / Reels', '`1080x1920`', '`9:16` vertical'],
            ['Instagram carré', '`1080x1080`', '`1:1` carré'],
            ['Instagram portrait', '`1080x1350`', '`4:5` portrait'],
            ['Twitter/X', '`1200x675`', '`16:9` paysage'],
            ['LinkedIn', '`1200x627`', 'paysage'],
            ['Personnalisé', 'Vos propres valeurs', 'Tout ce que vous saisissez'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Pour changer la taille une fois le projet créé :',
        },
        {
          kind: 'steps',
          items: [
            'Désélectionnez tout clip pour que la barre latérale des propriétés affiche le panneau **Canevas**.',
            'Modifiez les champs **W** et **H** pour définir la largeur et la hauteur du cadre en pixels.',
            'Utilisez **Échanger** pour inverser la largeur et la hauteur, par exemple pour transformer un projet paysage en projet vertical.',
            'Utilisez **Réinitialiser** pour remettre le canevas à `1920x1080`.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les dimensions sont arrondies à des nombres pairs et vont de `320x240` à `7680x4320`. Les clips existants gardent leur position et leur échelle quand le canevas change : repositionnez donc tout ce qui se trouve désormais hors du nouveau cadre.',
        },
      ],
    },
    {
      title: 'Organiser la liste des projets',
      blocks: [
        {
          kind: 'list',
          items: [
            'Recherchez les projets par nom, puis triez ou filtrez la liste à mesure qu’elle s’allonge.',
            'Servez-vous des vignettes et des métadonnées pour repérer le projet sur lequel vous avez travaillé en dernier.',
            'L’espace de travail actif est affiché sur la page Projets : vous savez toujours où sont stockés vos projets.',
            'Utilisez **Dupliquer** pour créer une variante sans toucher à l’original.',
          ],
        },
      ],
    },
    {
      title: 'Corbeille et restauration',
      blocks: [
        {
          kind: 'list',
          items: [
            'Supprimer un projet le déplace dans la **Corbeille** au lieu de l’effacer immédiatement.',
            'Restaurez un projet depuis la section Corbeille tant qu’il s’y trouve.',
            '**Vider la corbeille** supprime définitivement les projets mis à la corbeille ainsi que les médias qu’ils sont seuls à référencer.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Une suppression définitive est irréversible : vérifiez le nom avant de vider la corbeille.',
        },
      ],
    },
    {
      title: 'Déplacer son travail entre espaces de travail',
      blocks: [
        {
          kind: 'list',
          items: [
            'Utilisez **Exporter le projet** pour créer un lot qui empaquette le projet avec ses médias.',
            'Importez un lot dans un autre espace de travail pour poursuivre le même montage sur une autre machine ou dans un autre dossier.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Les lots sont le moyen sûr de transmettre un projet à quelqu’un d’autre, car ils emportent les médias liés avec la timeline.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
