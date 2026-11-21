import type { DocPageContent } from '../../docs-content'

// order 11.5 places this right after Text, Captions, and Subtitles in Creative Tools.
const page = {
  order: 11.5,
  slug: 'shapes-masks',
  title: 'Formes et masques',
  description:
    'Ajouter des éléments de forme, dessiner des tracés personnalisés avec l’outil plume et utiliser n’importe quelle forme comme masque de clip.',
  category: 'Creative Tools',
  related: ['motion', 'properties', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Ajouter une forme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ouvrez l’onglet **Formes** et cliquez sur une forme pour l’ajouter à la tête de lecture, ou glissez-la sur une piste précise.',
            'Formes intégrées : **Rectangle**, **Cercle**, **Ellipse**, **Triangle**, **Étoile**, **Polygone** et **Cœur**.',
            'Une nouvelle forme arrive à la taille du canevas et sélectionnée, prête à être positionnée et stylisée.',
          ],
        },
      ],
    },
    {
      title: 'Styliser une forme',
      blocks: [
        {
          kind: 'table',
          headers: ['Commande', 'Notes'],
          rows: [
            ['Type', 'Passez d’un des sept types de forme à un autre.'],
            ['Remplissage', 'Un remplissage en couleur unie ou en dégradé.'],
            [
              'Épaisseur trait / Trait',
              'Épaisseur du contour (0 à 50 px) et sa couleur (affichée quand l’épaisseur est supérieure à 0).',
            ],
            [
              'Extrémité / Jonction',
              'Les extrémités du trait et la façon dont les segments de trait connectés se rejoignent.',
            ],
            [
              'Rognage des tracés',
              'Commandes Début, Fin et Décalage pour ne dessiner qu’une partie d’un tracé.',
            ],
            ['Effilage', 'Largeurs de début et de fin pour un trait effilé.'],
            [
              'Rayon',
              'Arrondi des coins (0 à 100 px) pour le rectangle, le triangle, l’étoile et le polygone.',
            ],
            [
              'Branches / Rayon int.',
              'Nombre de branches et rayon intérieur, pour l’étoile et le polygone.',
            ],
            ['Direction', 'Le sens vers lequel pointe un triangle.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'La position, la taille, la rotation et l’opacité se trouvent dans les commandes de Transformation, et la plupart des valeurs peuvent être animées par images clés ; voir [Animation par images clés](keyframes).',
        },
      ],
    },
    {
      title: 'Animer les sommets d’un tracé dans Motion',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Ouvrez la forme dans **Motion** et dépliez ses lignes de propriétés.',
            'Sélectionnez des points du tracé dans l’aperçu.',
            'Choisissez **Sommets sélectionnés** pour ne poser des clés que sur ces points, ou **Tous les sommets** pour exposer chaque point.',
            'Ajoutez des clés aux coordonnées des sommets et déplacez la tête de lecture avant de remodeler le tracé.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Les clés de Path Geometry verrouillent la topologie du tracé. Supprimez-les avant d’ajouter, de retirer, de réordonner ou de changer le premier sommet.',
        },
      ],
    },
    {
      title: 'Dessiner un tracé personnalisé avec l’outil plume',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Dans l’onglet Formes, choisissez l’outil **Plume** pour dessiner une forme de tracé personnalisée.',
            'Cliquez dans l’aperçu pour placer des points ; cliquez et faites glisser un point pour tirer des poignées courbes (bezier).',
            'Retour arrière supprime le dernier point, et Échap annule.',
            'Avec au moins trois points, choisissez **Terminer la forme** pour la valider (ou **Annuler**).',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Pour remodeler un tracé plus tard, sélectionnez-le et utilisez **Modifier le tracé** : faites glisser les points et les poignées, double-cliquez sur un bord pour ajouter un point, et convertissez un point entre **Angle** et **Courbe Bezier**. Choisissez **Terminé** quand vous avez fini.',
        },
      ],
    },
    {
      title: 'Utiliser une forme comme masque',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Placez la forme sur une piste **au-dessus** du clip que vous voulez masquer.',
            'Dans la section Forme, activez **Utiliser comme masque**.',
            'Choisissez un **Type de masque** : **Détourage** pour des bords nets, ou **Alpha** pour des bords doux.',
            'Pour un masque Alpha, réglez **Contour progressif** pour adoucir le bord ; utilisez **Inverser** pour masquer la zone de la forme au lieu de la révéler.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Un masque affecte tout ce qui se trouve sur les pistes situées en dessous, selon la géométrie de la forme. Le contour progressif ne s’applique qu’aux masques Alpha : les masques Détourage gardent des bords nets.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Pendant que vous modifiez un masque ou dessinez avec la plume, le reste de l’éditeur est verrouillé : terminez ou quittez la modification du masque pour continuer.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
