import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.5,
  slug: 'motion-library',
  title: 'Appliquer et réutiliser le mouvement',
  description:
    'Appliquer des préréglages modifiables, ajouter des comportements en direct, ajuster le mouvement de texte et enregistrer une animation pour la réutiliser.',
  category: 'Creative Tools',
  related: ['motion', 'keyframes', 'properties', 'text-captions-subtitles'],
  sections: [
    {
      title: 'Choisir la bonne surface d’animation',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio utilise un seul système d’animation à deux endroits. Utilisez l’onglet compact **Animation** en montant un clip de séquence, ou ouvrez **Motion** pour un travail de composition en calques.',
        },
        {
          kind: 'table',
          headers: ['Surface', 'À utiliser pour'],
          rows: [
            [
              'Montage > Animation',
              'Les préréglages courants, l’état des animations appliquées, le mouvement de texte, et la création ou la réouverture d’un clip Motion',
            ],
            [
              'Motion > Bibliothèque de mouvements',
              'Le catalogue complet des préréglages, les comportements en direct, les animations enregistrées et les commandes du calque sélectionné',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Sélectionnez un ou plusieurs clips dans Montage et choisissez **Créer un clip Motion** pour les conserver dans une composition en calques. Sélectionnez un clip Motion existant et choisissez **Ouvrir dans Motion** pour modifier ses calques.',
        },
      ],
    },
    {
      title: 'Appliquer un préréglage modifiable',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Sélectionnez un ou plusieurs clips ou calques Motion.',
            'Choisissez un préréglage sous **Entrée**, **Sortie** ou **Accent**.',
            'Réglez **À l’application** sur **Remplacer** pour échanger un mouvement de même intention, ou sur **Ajouter** pour conserver les images clés existantes.',
            'Ouvrez les lignes de propriétés ou le graphique de valeurs pour ajuster les images clés générées.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La section **Appliqué** liste séparément les images clés manuelles et chaque application de préréglage. Sélectionnez une entrée pour amener la tête de lecture sur sa première image clé.',
        },
      ],
    },
    {
      title: 'Ajouter un comportement en direct',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Les comportements en direct s’évaluent pendant la lecture sans créer d’images clés. Laissez-les en direct pour un mouvement ajustable, ou cuisez-les quand vous avez besoin d’un contrôle image par image.',
        },
        {
          kind: 'table',
          headers: ['Comportement', 'Résultat'],
          rows: [
            ['Float drift', 'Décale la position et la rotation'],
            ['Sway', 'Oscille d’un côté à l’autre'],
            ['Breath pulse', 'Change la taille et l’opacité'],
            ['Spin', 'Tourne en continu'],
            ['Micro shake', 'Ajoute un tremblement de position et de rotation à germe fixe'],
          ],
        },
        {
          kind: 'list',
          items: [
            'Sélectionnez une vignette de comportement pour l’appliquer avec ses réglages par défaut.',
            'Ajustez **Intensité** et **Durée** depuis ses commandes appliquées.',
            'Lisez la bande hachurée dans la timeline Motion pour voir où s’exécute le mouvement procédural.',
            'Appliquez un comportement à plusieurs clips pour décaler leurs phases au lieu de déplacer tous les clips à l’unisson.',
          ],
        },
      ],
    },
    {
      title: 'Ajuster le mouvement de texte sur la timeline',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Le mouvement de texte anime les caractères, les mots, les lignes ou le clip entier au travers d’emplacements en direct **Entrée**, **Sortie** et **Boucle**.',
        },
        {
          kind: 'list',
          items: [
            'Sélectionnez un clip de texte, puis choisissez un préréglage pour chaque emplacement dans l’onglet **Animation** ou la Bibliothèque de mouvements.',
            'Dans Motion, faites glisser le bord d’une bande de mouvement de texte pour changer sa durée.',
            'Faites glisser une bande **Entrée** ou **Sortie** loin du bord du clip pour décaler son début ou sa fin.',
            'Sélectionnez son entrée **Appliqué** pour amener la tête de lecture sur la bande.',
          ],
        },
      ],
    },
    {
      title: 'Passer en revue et nettoyer l’animation appliquée',
      blocks: [
        {
          kind: 'list',
          items: [
            'Utilisez **Appliqué** pour distinguer les images clés manuelles, les images clés générées, les comportements en direct et le mouvement de texte.',
            'Supprimez l’application d’un préréglage sans effacer les images clés qui n’y sont pas liées.',
            'Supprimez un comportement en direct ou un emplacement de mouvement de texte depuis sa propre ligne.',
            'Quand un rognage laisse des clés en dehors du clip, utilisez **Rogner l’animation** pour supprimer seulement ces images clés en attente.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '**Rogner l’animation** modifie l’animation stockée. Utilisez l’action de la notification ou Annuler si vous avez besoin de récupérer les clés supprimées.',
        },
      ],
    },
    {
      title: 'Cuire, enregistrer et réutiliser le mouvement',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Choisissez **Cuire en images clés** pour échantillonner les comportements de calque en direct en clés de propriété modifiables.',
            'Sélectionnez un clip portant l’animation que vous voulez garder.',
            'Choisissez **Enregistrer l’animation**, saisissez un nom et enregistrez-la dans la bibliothèque du projet.',
            'Appliquez l’animation enregistrée à un autre clip ou calque compatible.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les animations enregistrées peuvent contenir des images clés modifiables, des comportements de calque en direct, du mouvement de texte, ou une combinaison. Les projets exportés emportent leur bibliothèque d’animations enregistrées.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
