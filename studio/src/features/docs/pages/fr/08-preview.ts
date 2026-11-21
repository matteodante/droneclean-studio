import type { DocPageContent } from '../../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Aperçu et lecture',
  description:
    'Lire, avancer image par image, zoomer le moniteur, passer en plein écran, enregistrer des images, utiliser la lecture proxy, baisser la résolution de lecture et rendre une plage à l’avance pour une lecture fluide.',
  category: 'Core Editing',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Lire et naviguer',
      blocks: [
        {
          kind: 'list',
          items: [
            'Lancez et mettez en pause la lecture avec les commandes de l’aperçu ou `Space`.',
            'Avancez ou reculez d’une image à la fois avec `Left` et `Right` pour des vérifications à l’image près.',
            'Allez au début de la timeline avec `Home` et à la fin avec `End`.',
            'Consultez l’affichage du code temporel pour confirmer la position exacte de la tête de lecture.',
          ],
        },
      ],
    },
    {
      title: 'Cadrer la vue',
      blocks: [
        {
          kind: 'list',
          items: [
            'Réglez le zoom de l’aperçu pour inspecter les détails\u00a0; cela ne change pas le canevas d’exportation.',
            'Utilisez **Plein écran** pour vérifier le mouvement ou le cadrage, puis Quitter le plein écran pour revenir.',
            'Utilisez **Enregistrer l’image** pour écrire l’image courante dans un fichier image.',
            'Les surimpressions de transformation, de masque et de modification apparaissent sur le moniteur quand un élément correspondant est sélectionné.',
          ],
        },
      ],
    },
    {
      title: 'Performances de lecture et audio',
      blocks: [
        {
          kind: 'list',
          items: [
            'Quand des proxys existent, DroneClean Studio les utilise pour lire plus fluidement les médias lourds\u00a0; les exports utilisent toujours les originaux.',
            'Le contrôle de volume du moniteur n’agit que sur la lecture locale.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les exports utilisent le mixage du projet\u00a0: le volume du moniteur ne change donc jamais l’audio rendu.',
        },
      ],
    },
    {
      title: 'Résolution de lecture',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Le bouton à côté de l’interrupteur des proxys, dans la barre de transport, règle la résolution de lecture\u00a0: **Intégrale**, **1/2** ou **1/4**. Une résolution plus basse dessine moins de pixels pour chaque image que l’aperçu calcule lui-même (clips avec effets, stabilisation, rampes de vitesse, flou de mouvement), donc les passages lourds se lisent plus vite\u00a0; l’image est plus douce. Le réglage vaut pour toute l’app et ne change jamais une exportation.',
        },
      ],
    },
    {
      title: 'Rendre une plage à l’avance',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Les clips stabilisés avec ralenti par flux optique et flou de mouvement peuvent être trop lourds pour un aperçu en temps réel. Rendez-les à l’avance, comme dans After Effects, et ils se lisent à pleine fréquence d’images.',
        },
        {
          kind: 'steps',
          items: [
            'Délimitez la plage avec l’entrée et la sortie (`I` et `O`), ou n’en marquez aucune pour rendre toute la timeline.',
            "Ouvrez le menu **Rendu de l'aperçu** dans la barre de la timeline, à côté des boutons d’entrée et de sortie, et choisissez **Rendu de l'entrée à la sortie**, ou appuyez sur `Enter`.",
            'Suivez la progression dans la barre de transport\u00a0; le X qui s’y trouve annule et garde ce qui est déjà rendu.',
            'Une ligne verte le long du bord inférieur de la règle marque les images qui se lisent désormais depuis l’aperçu rendu.',
          ],
        },
        {
          kind: 'list',
          items: [
            'Les images sont rendues à la résolution de lecture actuelle et gardées en mémoire (jusqu’à 1\u00a0Go, environ quatre minutes et demie en 1080p à 60\u00a0fps) jusqu’à la fermeture du projet.',
            'Toute modification qui change une image (un clip, un effet, une image clé, une transition, la stabilisation, la vitesse, la taille ou la fréquence du projet, la résolution de lecture ou l’interrupteur des proxys) retire aussitôt ces images de la ligne verte\u00a0: l’aperçu les recalcule en direct, jamais une image ancienne.',
            "Un nouveau rendu ne calcule que les images manquantes. **Supprimer l'aperçu rendu**, dans le même menu, libère la mémoire.",
            'Les exportations n’utilisent jamais l’aperçu rendu\u00a0: elles rendent toujours à partir du projet.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Si l’ordinateur ne peut pas encoder les images à la taille de l’aperçu, ou si la limite de mémoire est atteinte, un message le signale et l’aperçu reste en direct.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
