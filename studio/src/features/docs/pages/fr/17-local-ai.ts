import type { DocPageContent } from '../../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Outils d’IA locale',
  description:
    'Synthèse vocale, génération de musique et transcription dans le navigateur, avec mise en cache locale des modèles.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: 'Comment fonctionne l’IA locale',
      blocks: [
        {
          kind: 'list',
          items: [
            'Les outils d’IA s’exécutent dans votre navigateur avec votre propre matériel : rien n’est envoyé à un serveur.',
            'La première fois que vous utilisez un modèle, il est téléchargé une seule fois, puis mis en cache localement pour être réutilisé.',
            'Une pastille d’état indique les états chargement, actif, prêt et erreur pendant l’exécution d’un modèle.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Certains outils nécessitent Chrome ou Edge 113+ (ou Safari 26+) et la prise en charge de WebGPU. Le premier téléchargement d’un modèle peut être volumineux.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Les licences des modèles vous engagent, pas nous : la musique générée avec MusicGen est réservée à un usage non commercial (CC BY-NC 4.0), et la voix Supertonic relève de la licence OpenRAIL-M, qui interdit certains usages. L’onglet IA le rappelle avant que vous ne génériez quoi que ce soit.',
        },
      ],
    },
    {
      title: 'Synthèse vocale',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Ouvrez l’onglet **IA** et déployez **Texte vers voix**, puis tapez ou collez votre texte.',
            'Choisissez un moteur (voir le tableau), puis une voix et, quand c’est pris en charge, la vitesse, la langue et les balises expressives.',
            'Écoutez le résultat, puis **Enregistrer et insérer** pour déposer l’audio lié à la tête de lecture, ou **Enregistrer dans la bibliothèque**.',
          ],
        },
        {
          kind: 'table',
          headers: ['Moteur', 'Langues', 'S’exécute sur'],
          rows: [
            ['Kokoro', 'Anglais', 'WebGPU'],
            ['MOSS Nano', '20 langues', 'CPU'],
            ['Supertonic 3', '31 langues', 'ONNX local'],
          ],
        },
      ],
    },
    {
      title: 'Génération de musique',
      blocks: [
        {
          kind: 'list',
          items: [
            'Déployez **Génération musicale** et décrivez le morceau avec un prompt, ou partez d’un préréglage comme Lo-fi chill ou Upbeat EDM.',
            'Réglez la durée en secondes, puis **Générer la musique** ; la première exécution télécharge le modèle et le met en cache.',
            'Écoutez le clip, puis **Enregistrer et insérer** dans la timeline ou **Enregistrer dans la bibliothèque**.',
          ],
        },
      ],
    },
    {
      title: 'Transcription',
      blocks: [
        {
          kind: 'list',
          items: [
            'La transcription se trouve dans la médiathèque et dans le flux Transcription, séparément de l’onglet IA.',
            '**Parakeet** est le moteur rapide par défaut et couvre de nombreuses langues européennes.',
            'Les modèles Whisper (Tiny, Base, Small, Large v3 Turbo) sont aussi disponibles, et DroneClean Studio se replie sur Whisper quand c’est nécessaire.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Une transcription alimente les légendes, la recherche dans la transcription et la suppression des hésitations : générez-en une tôt.',
        },
      ],
    },
    {
      title: 'Gérer les modèles et les environnements d’exécution',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ouvrez les réglages **Stockage** pour gérer l’IA locale.',
            'Utilisez **Cache des modèles d’IA locaux** pour inspecter ou vider les modèles téléchargés, utile si un téléchargement est corrompu.',
            'Utilisez **Décharger les modèles locaux** pour libérer les environnements d’exécution et la mémoire.',
            'Les longues tâches peuvent être annulées si vous n’avez plus besoin du résultat.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
