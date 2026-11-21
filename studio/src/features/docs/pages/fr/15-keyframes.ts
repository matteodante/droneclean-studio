import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Animer avec des images clés',
  description:
    'Animer les valeurs de transformation, de recadrage, de texte, d’effet et d’audio avec des images clés, l’accélération et l’éditeur de courbes.',
  category: 'Creative Tools',
  related: ['motion', 'motion-library', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Choisir où modifier les images clés',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Montage garde le travail sur les images clés compact. Motion expose le dope sheet et le graphique complets des calques pour un travail plus fin sur le timing et les courbes.',
        },
        {
          kind: 'table',
          headers: ['Surface', 'Flux de travail des images clés'],
          rows: [
            [
              'Montage',
              'Sélectionnez un clip et appuyez sur `K` pour ajouter une clé à sa propriété active. Ouvrez **Animation** dans les Propriétés pour les préréglages et l’état appliqué.',
            ],
            [
              'Motion',
              'Dépliez un calque pour voir les lignes de propriétés, les losanges d’images clés, l’accélération par segment et un graphique de valeurs intégré.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Dans Motion, la tête de lecture partagée, la sélection, l’aimantation, la règle, les pistes de propriétés et le graphique utilisent le même axe de temps.',
        },
      ],
    },
    {
      title: 'Ajouter une image clé',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Placez la tête de lecture sur l’image où vous voulez poser la clé.',
            'Saisissez une valeur à côté d’un paramètre et appuyez sur `Enter`, ou cliquez sur le **losange** de la ligne du paramètre.',
            'Allez sur une autre image et définissez une seconde valeur pour créer un mouvement entre les deux.',
            'Activez la **clé automatique** avec l’icône de minuteur, ou appuyez sur `A`, pour enregistrer automatiquement les changements de valeur suivants.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Vous ne pouvez pas ajouter d’image clé dans une zone de transition, ni avec la tête de lecture en dehors des limites du clip : le losange y est désactivé.',
        },
      ],
    },
    {
      title: 'Ce que vous pouvez animer',
      blocks: [
        {
          kind: 'table',
          headers: ['Type de clip', 'Valeurs animables'],
          rows: [
            [
              'Tous les clips visuels',
              'Position X / Y, largeur, hauteur, rotation, opacité, rayon des coins',
            ],
            [
              'Vidéo',
              'Ajoute le point d’ancrage, les quatre bords de recadrage, l’adoucissement du recadrage et le volume',
            ],
            [
              'Texte',
              'Ajoute l’échelle du préréglage, la taille de police, l’interligne, la marge intérieure, le rayon de l’arrière-plan, l’ombre et le contour',
            ],
            ['Audio', 'Volume en décibels'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les effets apportent aussi leurs propres paramètres animables : cherchez la bascule d’image clé à côté de chaque curseur.',
        },
      ],
    },
    {
      title: 'Façonner le mouvement',
      blocks: [
        {
          kind: 'list',
          items: [
            'Cliquez sur le **connecteur** entre deux images clés pour ouvrir l’**éditeur d’accélération**.',
            'Parcourez les courbes prédéfinies sous **Cubique** et **Ressort**. Filtrez par **Toutes**, **Entrée**, **Sortie** ou **Entrée/Sortie**.',
            'Choisissez **Maintien** pour garder la valeur précédente jusqu’à la clé suivante.',
            'Passez à **Modifier** pour façonner directement la courbe : faites glisser les deux poignées de contrôle sur le graphique, ou saisissez des valeurs exactes. Les ressorts exposent la **tension**, la **friction** et la **masse**, et prévisualisent leur vrai rebond.',
            'Sentez le timing sur **Position**, **Échelle**, **Rotation** ou **Opacité** dans l’aperçu en direct, et mettez la boucle en **Pause**.',
            'Enregistrez une courbe retouchée comme **préréglage personnalisé** avec **Enregistrer sous**, **Mettre à jour** ensuite, ou **Réinitialiser** pour revenir au préréglage d’origine. Les préréglages personnalisés sont stockés sur votre appareil et apparaissent dans tous les projets.',
            'Copiez, coupez, collez et supprimez des images clés, sélectionnez des groupes au cadre de sélection, faites glisser pour recaler le timing, et faites glisser avec `Alt` pour dupliquer.',
          ],
        },
      ],
    },
    {
      title: 'Travailler dans le graphique de valeurs',
      blocks: [
        {
          kind: 'list',
          items: [
            'Choisissez une propriété dans la liste déroulante pour modifier sa courbe, ou laissez sur toutes pour voir les autres en courbes superposées estompées. Le nombre d’images clés de la propriété active s’affiche à côté.',
            'Le graphique trace une **grille** étiquetée (images ou secondes en abscisse, valeurs en ordonnée) pour que vous lisiez les positions d’un coup d’œil.',
            'Cadrez la courbe avec **Ajuster au contenu**, ou déplacez la vue avec **Zoom avant** / **Zoom arrière** et la molette de la souris. **Réinitialiser la vue** revient à l’ajustement par défaut.',
            'Parcourez les clés avec les flèches **précédente** / **suivante**, puis saisissez une image exacte (**F**) et une valeur (**V**) pour l’image clé sélectionnée.',
            'Pendant que vous faites glisser une image clé, maintenez **Shift** pour la verrouiller sur un axe, ou **Alt** pour un réglage fin.',
          ],
        },
      ],
    },
    {
      title: 'Convertir et nettoyer le mouvement généré',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Les comportements en direct comme la dérive, la respiration, la secousse et la rotation s’évaluent pendant la lecture sans créer de clés de propriété.',
        },
        {
          kind: 'list',
          items: [
            'Choisissez **Cuire en images clés** pour convertir les comportements de calque en direct en clés modifiables.',
            'Utilisez **Appliqué** pour naviguer vers des clés manuelles ou vers la première image d’un préréglage généré.',
            'Utilisez **Rogner l’animation** quand le rognage d’un clip laisse des clés stockées en dehors de sa durée visible.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Lisez [Appliquer et réutiliser le mouvement](motion-library) pour les préréglages, les comportements en direct, le mouvement de texte, la cuisson et les animations enregistrées.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
