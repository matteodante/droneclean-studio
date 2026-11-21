import type { DocPageContent } from '../../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: 'Exportation',
  description:
    'Rendre une vidéo ou de l’audio dans le navigateur, choisir les formats et la plage, et lever les avertissements de la vérification préalable.',
  category: 'Output',
  related: ['render-queue', 'text-captions-subtitles', 'troubleshooting'],
  sections: [
    {
      title: 'Préparer une exportation',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Ouvrez **Exporter** (`Ctrl+Shift+E`) et choisissez **Exporter la vidéo** ou **Exporter l’audio**.',
            'Rendez le projet entier, ou la plage d’entrée/sortie courante quand vous n’avez besoin que d’une section.',
            'Réglez **Résolution** et **Qualité** selon l’objectif : une relecture rapide, un fichier à partager ou un master final.',
            'Levez les éventuels avertissements de la vérification préalable, puis lancez le rendu.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Une résolution et une qualité plus élevées demandent plus de temps et produisent des fichiers plus volumineux.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Quand un projet compte plus que la timeline principale, un menu **Séquence** en haut de la boîte de dialogue permet de choisir la timeline à exporter, avec sa propre résolution et sa propre plage.',
        },
      ],
    },
    {
      title: 'Formats',
      blocks: [
        {
          kind: 'table',
          headers: ['Sortie', 'Formats'],
          rows: [
            ['Conteneurs vidéo', 'MP4, MOV, WebM, MKV'],
            ['Audio seul', 'MP3, AAC, WAV'],
            ['Piste de sous-titres désactivable', 'WebM, MKV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les codecs disponibles dépendent de votre navigateur ; DroneClean Studio vous avertit ou se replie sur un autre quand l’un d’eux manque.',
        },
      ],
    },
    {
      title: 'Sous-titres',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Quand une exportation vidéo dispose d’une transcription, la commande **Sous-titres** choisit la façon dont les légendes sont incluses. Les options s’adaptent au conteneur que vous avez choisi.',
        },
        {
          kind: 'table',
          headers: ['Mode', 'Ce qu’il fait'],
          rows: [
            ['**Désactivé**', 'Aucune légende dans la vidéo exportée.'],
            [
              '**Incrustés**',
              'Les légendes sont dessinées dans l’image : elles s’affichent donc dans tous les lecteurs.',
            ],
            [
              '**Fichier** `.srt`',
              'Une vidéo propre, plus un fichier de sous-titres `.srt` séparé, téléchargé en même temps.',
            ],
            [
              '**Piste intégrée**',
              'Une piste de sous-titres désactivable, transportée à l’intérieur du conteneur.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'L’option de piste intégrée n’apparaît que pour `WebM` et `MKV`. Avec `MP4` et `MOV`, choisissez l’incrustation ou un fichier séparé, ou changez de conteneur pour obtenir une piste désactivable.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Certains lecteurs masquent les pistes de sous-titres par défaut : les spectateurs devront peut-être les activer.',
        },
      ],
    },
    {
      title: 'Vérifications préalables',
      blocks: [
        {
          kind: 'paragraph',
          text: 'La vérification préalable s’exécute avant le rendu et signale les blocages courants : une plage vide, des médias manquants, un codec indisponible, un repli de l’exportation par worker, un fichier volumineux ou un rendu long.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Pour un contrôle rapide, exportez d’abord une courte plage d’entrée/sortie avant de vous engager dans le rendu complet.',
        },
      ],
    },
    {
      title: 'Rendre et télécharger',
      blocks: [
        {
          kind: 'list',
          items: [
            'La progression passe par la préparation, le rendu, l’encodage et la finalisation, et vous pouvez **Annuler** à tout moment.',
            'L’exportation par worker s’exécute en arrière-plan quand c’est possible ; un repli sur le thread principal demande que l’onglet reste au premier plan et au calme.',
            'Une fois terminée, choisissez **Télécharger** pour enregistrer le fichier, qui est aussi écrit dans le dossier des exports de votre espace de travail.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Gardez l’onglet du projet ouvert jusqu’à la fin de l’exportation. Pour enchaîner plusieurs rendus, ajoutez-les à la **File de rendu** au lieu d’exporter un par un.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
