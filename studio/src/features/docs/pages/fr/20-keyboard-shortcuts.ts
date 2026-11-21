import type { DocPageContent } from '../../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Raccourcis clavier',
  description:
    'Les raccourcis par défaut par groupe, et comment les rechercher, les réaffecter et les réinitialiser.',
  category: 'Reference',
  sections: [
    {
      title: 'Lecture',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Raccourci'],
          rows: [
            ['Lecture / Pause', '`Space`'],
            ['Image précédente / suivante', '`Left` / `Right`'],
            ['Point d’aimantation précédent / suivant', '`Up` / `Down`'],
            ['Aller au début / à la fin', '`Home` / `End`'],
          ],
        },
      ],
    },
    {
      title: 'Montage',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Raccourci'],
          rows: [
            ['Couper à la tête de lecture', '`Alt+C`'],
            ['Couper au curseur', '`Shift+C`'],
            ['Joindre', '`Shift+J`'],
            ['Supprimer / Suppression en cascade', '`Delete` / `Ctrl+Delete`'],
            ['Insérer un arrêt sur image', '`Shift+F`'],
            ['Lier / Délier les clips', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['Activer/désactiver la sélection liée', '`Shift+L`'],
            ['Déplacer de 1 px / 10 px', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: 'Outils',
      blocks: [
        {
          kind: 'table',
          headers: ['Outil', 'Raccourci'],
          rows: [
            ['Sélection', '`V`'],
            ['Rognage', '`T`'],
            ['Rasoir', '`C`'],
            ['Étirement de vitesse', '`R`'],
            ['Slip', '`Y`'],
            ['Slide', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le rognage en cascade et le rognage rolling sont des comportements de l’outil de **rognage**, et non des outils distincts avec leur propre raccourci.',
        },
      ],
    },
    {
      title: 'Historique, vue et presse-papiers',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Raccourci'],
          rows: [
            ['Annuler / Rétablir', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['Copier / Couper / Coller', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['Activer/désactiver l’aimantation / l’aimantation du canevas', '`S` / `Shift+S`'],
            ['Zoom avant / arrière', '`Ctrl+=` / `Ctrl+-`'],
            ['Ajuster à la fenêtre / 100\u00a0%', '`\\` / `Shift+\\`'],
            ['Espace de travail Montage / Étalonnage / Motion', '`Alt+1` / `Alt+2` / `Alt+3`'],
          ],
        },
      ],
    },
    {
      title: 'Marqueurs et images clés',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Raccourci'],
          rows: [
            ['Ajouter / Supprimer un marqueur', '`M` / `Shift+M`'],
            ['Marqueur précédent / suivant', '`[` / `]`'],
            ['Effacer les images clés', '`Shift+A`'],
            ['Ajouter une image clé au calque Montage sélectionné', '`K`'],
            ['Vue graphique / feuille / partagée des images clés', '`1` / `2` / `3`'],
            ['Image clé précédente / suivante de la propriété', '`Alt+[` / `Alt+]`'],
            ['Activer/désactiver la clé automatique de la propriété active', '`A`'],
            ['Ajuster les images clés sélectionnées', '`F`'],
          ],
        },
      ],
    },
    {
      title: 'Moniteur source et projet',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Raccourci'],
          rows: [
            ['Marquer l’entrée / la sortie', '`I` / `O`'],
            ['Effacer l’entrée/sortie', '`Alt+X`'],
            ["Rendu de l'aperçu (de l'entrée à la sortie, ou toute la timeline)", '`Enter`'],
            ['Insérer / Écraser', '`,` / `.`'],
            ['Enregistrer', '`Ctrl+S`'],
            ['Exporter', '`Ctrl+Shift+E`'],
            ['Ouvrir le navigateur de scènes', '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: 'Personnaliser les raccourcis',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Chaque affectation ci-dessus est un réglage par défaut livré avec l’application. Ouvrez l’éditeur de raccourcis repensé avec le bouton **Raccourcis clavier** (icône de clavier) de la barre d’outils de l’éditeur pour réaffecter n’importe quelle commande aux touches que vous préférez.',
        },
        {
          kind: 'steps',
          items: [
            'Recherchez les commandes par nom, ou filtrez sur les groupes **Personnalisé**, **Conflits** ou **Non attribué**.',
            'Choisissez une commande et appuyez sur **Enregistrer**, puis maintenez vos touches de modification et appuyez sur la touche finale.',
            'Si la combinaison est déjà utilisée, l’éditeur signale le conflit\u00a0: choisissez **Écraser** pour la réaffecter, ou prenez d’autres touches.',
            'Utilisez **Dissocier** pour effacer une affectation, ou ajoutez une affectation alternative à côté de la principale.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Utilisez **Réinitialiser** pour restaurer une seule commande, ou **Tout réinitialiser** pour remettre chaque raccourci à sa valeur par défaut. Vous pouvez aussi **Exporter** vos affectations dans un fichier de préréglage et l’**Importer** sur une autre machine.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
