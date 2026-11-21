import type { DocPageContent } from '../../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Montage audio',
  description:
    'Enregistrer une voix off, régler le gain et les fondus d’un clip, la hauteur tonale, l’égaliseur par clip, le mixeur et les vu-mètres, et nettoyer les silences et les mots parasites.',
  category: 'Creative Tools',
  related: ['properties', 'local-ai'],
  sections: [
    {
      title: 'Ajuster un clip',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Sélectionnez un clip et ouvrez l’onglet **Audio** dans les Propriétés.',
        },
        {
          kind: 'table',
          headers: ['Commande', 'Plage'],
          rows: [
            ['Gain', 'De -60 dB à +12 dB (−60 dB coupe pratiquement le son du clip)'],
            ['Fondu d’entrée / Fondu de sortie', 'De 0 à 5 secondes chacun'],
            ['Hauteur', 'Demi-tons et centièmes, indépendamment de la vitesse'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Vous pouvez aussi faire glisser la ligne de volume et les poignées de fondu directement sur le clip dans la timeline, et le **Gain** peut être animé par images clés pour monter ou descendre au fil d’un clip.',
        },
      ],
    },
    {
      title: 'Hauteur et timbre',
      blocks: [
        {
          kind: 'list',
          items: [
            'Les commandes de **Hauteur** décalent la hauteur tonale sans changer la vitesse du clip. Pour changer la vitesse à la place, utilisez **Vitesse** dans l’onglet Vidéo.',
            'La section **Égaliseur** donne à chaque clip un éditeur de courbe pour façonner le timbre.',
          ],
        },
      ],
    },
    {
      title: 'Mixeur et vu-mètres',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ouvrez les **Vu-mètres** audio pour suivre les niveaux stéréo et repérer l’écrêtage pendant la lecture.',
            'Utilisez le **Mixeur** pour équilibrer les niveaux dans tout le projet.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le volume du moniteur dans l’aperçu n’agit que sur la lecture locale et ne change jamais le mixage exporté.',
        },
      ],
    },
    {
      title: 'Enregistrer une voix off',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Le bouton **Enregistrer une voix off** (microphone) de la barre d’outils de la timeline enregistre un commentaire en rythme avec votre projet. La capture s’effectue **pendant que la timeline est lue**, et la prise terminée arrive sur une nouvelle piste audio ancrée à la position de la tête de lecture où vous avez commencé.',
        },
        {
          kind: 'steps',
          items: [
            'Placez la tête de lecture à l’endroit où la voix off doit commencer.',
            'Cliquez sur le bouton **microphone** : la timeline se met en lecture et l’enregistrement commence.',
            'Utilisez **Mettre l’enregistrement en pause** pour arrêter ensemble la tête de lecture et le micro, **Reprendre l’enregistrement** pour continuer, et **Arrêter et enregistrer** pour terminer et déposer le clip sur une nouvelle piste audio.',
            'Cliquez sur **Annuler l’enregistrement** (le ✕) pour abandonner la prise sans rien ajouter.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Ouvrez les **Paramètres du microphone** (le ▾ à côté du bouton) pour choisir un périphérique d’entrée et régler la capture. L’indicateur de niveau y est en direct : vous pouvez donc vérifier votre micro avant d’enregistrer.',
        },
        {
          kind: 'table',
          headers: ['Réglage', 'Ce qu’il fait'],
          rows: [
            ['Suppression du bruit', 'Réduit le bruit de fond constant. Activée par défaut.'],
            ['Gain automatique', 'Maintient votre voix à un niveau constant. Activé par défaut.'],
            [
              'Couper le son de la timeline pendant l’enregistrement',
              'Coupe le son du moniteur de la timeline pour que l’audio des haut-parleurs ne passe pas dans le micro. Activé par défaut.',
            ],
            [
              'Décalage de synchronisation',
              'Avance ou retarde le clip enregistré pour compenser la latence d’entrée (jusqu’à ±1000 ms).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Utilisez un casque pour que l’audio de votre projet ne soit jamais capté par le micro ; vous pouvez alors désactiver **Couper le son de la timeline pendant l’enregistrement** pour entendre le mixage pendant que vous commentez.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Le déplacement dans la timeline est désactivé pendant l’enregistrement, et appuyer sur `Space` ou atteindre la fin de la timeline termine la prise. Cela garde l’enregistrement verrouillé sur la tête de lecture, de sorte qu’il ne peut jamais se désynchroniser.',
        },
      ],
    },
    {
      title: 'Nettoyer les dialogues',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Supprimer les silences** repère les plages silencieuses et les coupe ; le réglage **Silence minimum** détermine la longueur qu’un blanc doit avoir, et la boîte de dialogue estime la quantité qui sera supprimée.',
            '**Supprimer les hésitations** détecte dans la transcription et l’audio des mots comme « euh » et les supprime.',
            'Les deux outils affichent les plages qu’ils vont supprimer, pour que vous puissiez les prévisualiser avant d’appliquer la modification.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Une transcription améliore la détection des hésitations : générez-en une d’abord pour de meilleurs résultats.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
