import type { DocPageContent } from '../../docs-content'

const page = {
  order: 22,
  slug: 'troubleshooting',
  title: 'Dépannage',
  description:
    'Solutions aux problèmes de navigateur, d’espace de travail, de médias, de WebGPU, d’IA locale et d’exportation.',
  category: 'Reference',
  related: ['workspaces', 'export'],
  sections: [
    {
      title: 'Navigateur et espace de travail',
      blocks: [
        {
          kind: 'table',
          headers: ['Symptôme', 'Solution'],
          rows: [
            [
              'Navigateur non pris en charge, ou pas de sélecteur d’espace de travail',
              'Utilisez Chrome ou Edge 113+, qui prennent en charge les API dont DroneClean Studio a besoin.',
            ],
            [
              'Brave ne peut pas choisir un dossier',
              'Activez `brave://flags/#file-system-access-api` et relancez Brave.',
            ],
            [
              'Autorisation refusée',
              'Choisissez un dossier ordinaire que vous pouvez modifier, puis autorisez l’accès en lecture et en écriture.',
            ],
            [
              'Demande de reconnexion à la réouverture',
              'Choisissez **Reconnecter** pour le même dossier ; s’il a été déplacé, choisissez-en un autre.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Médias et importation',
      blocks: [
        {
          kind: 'table',
          headers: ['Symptôme', 'Solution'],
          rows: [
            [
              'Médias manquants',
              'Reliez avec **Autoriser l’accès**, **Localiser**, **Localiser le dossier** ou **Parcourir un autre dossier**.',
            ],
            [
              'Échec de l’importation ou codec non pris en charge',
              'Essayez un autre format pris en charge par le navigateur, ou transcodez d’abord le fichier.',
            ],
            [
              'L’importation depuis une URL échoue',
              'Vérifiez que le lien pointe vers le fichier média lui-même, et non vers une page qui l’intègre.',
            ],
            [
              'Aperçus ou formes d’onde périmés',
              'Régénérez les vignettes ou les proxys, ou videz le cache du projet dans les réglages Stockage.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Utilisez **Travailler hors ligne** seulement si vous comptez relier les fichiers plus tard : d’ici là, les clips restent des références rompues.',
        },
      ],
    },
    {
      title: 'WebGPU et IA locale',
      blocks: [
        {
          kind: 'table',
          headers: ['Symptôme', 'Solution'],
          rows: [
            [
              'Effets, scopes ou IA indisponibles',
              'WebGPU est peut-être désactivé : utilisez un Chrome ou un Edge récent, mettez à jour les pilotes de GPU et gardez l’accélération matérielle activée.',
            ],
            [
              'Le téléchargement d’un modèle est lent ou échoue',
              'Gardez l’onglet ouvert, réessayez sur une connexion stable et videz le **Cache des modèles d’IA locaux** si un téléchargement est corrompu.',
            ],
            [
              'Mémoire insuffisante pendant un travail d’IA',
              'Utilisez **Décharger les modèles locaux** pour libérer les environnements d’exécution.',
            ],
            [
              'Importation de LUT bloquée',
              'L’importation de LUT (.cube) nécessite un navigateur basé sur Chromium.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Exportation',
      blocks: [
        {
          kind: 'table',
          headers: ['Symptôme', 'Solution'],
          rows: [
            [
              'Codec indisponible dans la vérification préalable',
              'Choisissez un autre codec ou format, ou réduisez la résolution ou la qualité.',
            ],
            [
              'Exportation par worker indisponible',
              'Gardez l’onglet au premier plan et évitez les interactions lourdes ; remplacer les éléments d’image animée par des clips vidéo peut aider.',
            ],
            [
              'Exportation volumineuse ou lente',
              'Exportez une plage d’entrée/sortie plus courte, réduisez la résolution ou la qualité, et libérez d’abord de l’espace disque.',
            ],
            [
              'L’exportation ne démarre pas',
              'Levez tout avertissement bloquant de la vérification préalable, puis essayez une courte plage pour confirmer que la chaîne de traitement fonctionne.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
