import type { DocPageContent } from '../../docs-content'

const page = {
  order: 11,
  slug: 'text-captions-subtitles',
  title: 'Texte, légendes et sous-titres',
  description:
    'Ajouter et styliser des clips de texte, générer des sous-titres à partir d’une transcription et importer des pistes de sous-titres intégrées.',
  category: 'Creative Tools',
  related: ['motion-library', 'motion', 'shapes-masks', 'properties', 'local-ai'],
  sections: [
    {
      title: 'Trois notions voisines',
      blocks: [
        {
          kind: 'table',
          headers: ['Type', 'Ce que c’est', 'Point de départ'],
          rows: [
            [
              'Clip de texte',
              'Un élément de timeline autonome dans lequel vous tapez',
              'L’onglet Texte',
            ],
            [
              'Légendes',
              'Des lignes générées qui accompagnent un clip vidéo ou audio',
              'La transcription d’un clip',
            ],
            [
              'Sous-titres',
              'Une piste de répliques sur la timeline',
              'Une piste intégrée, ou des légendes consolidées',
            ],
          ],
        },
      ],
    },
    {
      title: 'Ajouter et styliser un clip de texte',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Ouvrez l’onglet **Texte**, puis cliquez sur **Ajouter du texte** ou sur un modèle pour placer du texte à la tête de lecture, ou glissez un modèle sur la timeline ou le canevas.',
            'Choisissez une disposition (**Simple**, **2 segments**, **3 segments**) et un préréglage de style comme Clean, Lower Third, Cinematic ou Neon.',
            'Dans la section **Texte**, réglez la police, la taille (8 à 500 px), la graisse, la couleur, l’arrière-plan, l’alignement, l’espacement, l’interligne, la marge intérieure et le rayon.',
            'Ajoutez une ombre ou un contour sous **Effets**, et animez le texte sous **Animation du texte**.',
          ],
        },
      ],
    },
    {
      title: 'Animation du texte',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Dans la section **Animation du texte** (dans les propriétés du texte ou la bibliothèque **Motion** du calque sélectionné), chaque caractère, mot ou ligne peut s’animer indépendamment. L’animation du texte reste vivante et procédurale : il n’y a donc aucune image clé de calque à gérer.',
        },
        {
          kind: 'steps',
          items: [
            'Sélectionnez un clip de texte et ouvrez la section **Animation du texte**.',
            'Choisissez un préréglage dans la ligne **Entrée**, **Sortie** ou **Boucle**. **Entrée** joue au début du clip, **Sortie** à la fin du clip, et **Boucle** tourne en continu entre les deux.',
            'Cliquez de nouveau sur le préréglage actif (ou sur son ✕) pour le retirer : un seul préréglage par ligne.',
            'Réglez les commandes qui apparaissent sous le préréglage actif.',
            'Dans Motion, faites glisser le bord d’une bande de mouvement de texte pour changer sa durée, ou faites glisser une bande Entrée ou Sortie loin du bord du clip pour la décaler.',
          ],
        },
        {
          kind: 'table',
          headers: ['Commande', 'Ce qu’elle fait'],
          rows: [
            [
              'Appliquer à',
              'L’unité que chaque préréglage anime : Caractère, Mot, Ligne ou Clip entier.',
            ],
            ['Durée', 'Longueur, en images, de l’animation de chaque unité.'],
            ['Décalage', 'Nombre d’images de retard entre chaque unité, pour un effet en cascade.'],
            [
              'Ordre',
              'Quelle unité s’anime en premier : Vers l’avant, Vers l’arrière, Depuis le centre ou Aléatoire.',
            ],
            ['Intensité', 'Ajuste la force de l’effet, de 0 à 200 %.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'La liste **Appliqué** montre chaque emplacement de mouvement de texte actif. Sélectionnez une entrée pour amener la tête de lecture sur sa bande de la timeline.',
        },
      ],
    },
    {
      title: 'Légendes à partir d’une transcription',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Générez une transcription du clip depuis la médiathèque ou le panneau Transcription.',
            'Utilisez **Générer les sous-titres** (ou laissez DroneClean Studio activer automatiquement les légendes de transcription) depuis le menu contextuel du clip.',
            'Modifiez le timing et le texte des répliques, et choisissez un préréglage de style (Netflix, YouTube, Bold Yellow, Outlined, TikTok) dans la section **Sous-titre**.',
            'Ajustez la couleur, la taille et la position verticale des légendes, ainsi qu’un arrière-plan facultatif.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Utilisez **Consolider les sous-titres en segment** pour transformer les légendes de transcription en un segment de sous-titres autonome.',
        },
      ],
    },
    {
      title: 'Sous-titres intégrés et importés',
      blocks: [
        {
          kind: 'list',
          items: [
            'Utilisez **Extraire les sous-titres intégrés** sur une carte de média pour analyser un fichier à la recherche de pistes de sous-titres.',
            'Dans la boîte de dialogue **Sous-titres intégrés**, choisissez une piste : chaque ligne indique sa langue, son codec et son nombre de répliques.',
            'Insérez la piste pour ajouter ses répliques à la timeline sous forme de segment de sous-titres.',
            'Modifiez le début, la fin et le texte de chaque réplique dans la section **Sous-titre**, et appliquez à toute la réplique l’italique, le gras ou le soulignement.',
          ],
        },
      ],
    },
    {
      title: 'Sous-titres à l’exportation',
      blocks: [
        {
          kind: 'note',
          tone: 'info',
          text: 'Activez **Intégrer les sous-titres** dans les réglages d’exportation pour inclure les légendes de transcription comme piste de sous-titres (MP4, MKV, WebM). Certains lecteurs masquent les pistes de sous-titres par défaut : les spectateurs devront peut-être les activer.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
