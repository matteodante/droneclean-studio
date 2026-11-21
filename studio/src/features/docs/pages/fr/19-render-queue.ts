import type { DocPageContent } from '../../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: 'File de rendu',
  description:
    'Mettre plusieurs exportations en file, découper un rendu en segments, gérer la file et retrouver les fichiers enregistrés.',
  category: 'Output',
  related: ['export'],
  sections: [
    {
      title: 'Mettre des exportations en file',
      blocks: [
        {
          kind: 'list',
          items: [
            'Depuis la boîte de dialogue d’exportation, choisissez **Ajouter à la file** au lieu de lancer le rendu tout de suite.',
            'Mettez en file le projet entier ou la plage courante.',
            'Ouvrez la file à tout moment avec le bouton **File de rendu** de la barre d’outils, qui affiche le nombre de tâches en direct.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les exportations en file sont rendues une à la fois et enregistrées dans le dossier des exports de votre espace de travail.',
        },
      ],
    },
    {
      title: 'Diviser en segments',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Diviser en segments** transforme un rendu en plusieurs tâches.',
            'Utilisez **Un segment par marqueur** pour couper le rendu à vos marqueurs de timeline.',
            'Ou découpez en tronçons fixes d’un nombre de secondes donné.',
          ],
        },
      ],
    },
    {
      title: 'Gérer la file',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Pause** et **Reprendre** la file pour contrôler quand le rendu a lieu.',
            'Déplacez une tâche en file vers le **Haut** ou le **Bas** pour changer son ordre.',
            '**Annuler** une tâche en cours ou en file, **Réessayer** une tâche échouée, et **Supprimer** les tâches terminées.',
            'L’état d’une tâche est En file, En rendu, Terminée, Échouée ou Annulée ; utilisez **Effacer les terminées** ou **Tout effacer** pour faire le ménage.',
          ],
        },
      ],
    },
    {
      title: 'Exports enregistrés',
      blocks: [
        {
          kind: 'list',
          items: [
            'Passez à l’onglet **Exports enregistrés** pour voir les fichiers terminés.',
            'Téléchargez ou supprimez un export enregistré depuis cet onglet.',
            'Les fichiers se trouvent dans ce dossier de projet, à l’intérieur de votre espace de travail.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
