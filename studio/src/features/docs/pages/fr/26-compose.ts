import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.75,
  slug: 'motion',
  title: 'Utiliser l’espace de travail Motion',
  description:
    'Construire, caler dans le temps, animer, lier en parenté et réutiliser des compositions 2D en calques dans l’espace de travail Motion.',
  category: 'Creative Tools',
  related: ['motion-library', 'keyframes', 'shapes-masks', 'concepts'],
  sections: [
    {
      title: 'Ouvrir ou créer une composition Motion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Motion réunit dans un seul espace de travail la médiathèque, l’aperçu de la composition, la timeline des calques, les propriétés, les images clés, le graphique et la Bibliothèque de mouvements.',
        },
        {
          kind: 'steps',
          items: [
            'Choisissez **Motion** dans le sélecteur d’espaces de travail, ou appuyez sur `Alt+3`.',
            'Choisissez une composition existante dans le menu des compositions, ou choisissez **Nouvelle comp.**.',
            'Pour promouvoir des clips de séquence, sélectionnez-les dans Montage, ouvrez **Animation** et choisissez **Créer un clip Motion**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Créer un clip Motion conserve les clips sélectionnés et leur animation dans la nouvelle composition. Le nouvel enveloppeur reste un clip ordinaire dans Montage.',
        },
      ],
    },
    {
      title: 'Ajouter des calques à la composition',
      blocks: [
        {
          kind: 'list',
          items: [
            'Glissez de la vidéo, de l’audio, des images, du texte, des formes, des fichiers Lottie ou une autre composition depuis la médiathèque.',
            'Choisissez **Ajouter un élément** pour créer des calques **Texte**, **Couleur unie**, **Dégradé**, **Forme** ou **Objet nul**.',
            'Couleur unie et Dégradé créent des calques de forme plein cadre que vous pouvez redimensionner, styliser, masquer et animer.',
            'DroneClean Studio empêche une composition de se contenir elle-même, y compris par une imbrication circulaire indirecte.',
          ],
        },
      ],
    },
    {
      title: 'Définir la durée et la plage active',
      blocks: [
        {
          kind: 'paragraph',
          text: 'La durée créée définit la composition. Les poignées Entrée et Sortie de la règle définissent la plage de rendu active à l’intérieur de cette durée.',
        },
        {
          kind: 'steps',
          items: [
            'Faites glisser les poignées **Entrée** et **Sortie** au-dessus de la règle Motion pour marquer la plage active.',
            'Choisissez **Rogner la compo sur la région active** pour raccourcir la composition créée à cette plage.',
            'Choisissez **Ajuster le zoom** pour cadrer la composition créée sans changer sa durée.',
            'Modifiez **Durée de la compo** dans les Propriétés, et sélectionnez son unité pour passer des images aux secondes.',
            'Lisez la valeur **Code temporel** correspondante sous la commande de durée.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le rognage garde les commandes Entrée et Sortie disponibles et ajuste la nouvelle plage. Les calques qui dépassent la durée créée restent visibles dans le débord estompé.',
        },
      ],
    },
    {
      title: 'Agencer et caler les calques dans le temps',
      blocks: [
        {
          kind: 'list',
          items: [
            'Faites glisser l’étendue d’un calque pour le déplacer dans le temps. Les calques sélectionnés se déplacent ensemble en une seule étape d’annulation.',
            'Modifiez les champs **Entrée** et **Sortie** de chaque calque, ou faites glisser les bords de son étendue pour le rogner.',
            'Utilisez les commandes du calque pour changer la visibilité, le verrouillage, le solo, le mode de fusion et l’ordre d’empilement.',
            'Faites glisser la poignée à trois points pour réordonner un calque ou un groupe. Les calques enfants restent dans leur groupe actuel.',
            'Sélectionnez deux calques ou plus et choisissez **Groupe de calques**. La visibilité, le verrouillage, le solo, le timing et le réordonnancement du groupe s’appliquent à ses enfants.',
            'Faites un clic droit sur un calque ou un groupe pour le renommer, le grouper, le dissocier, le dupliquer, le copier, le coller ou le supprimer.',
          ],
        },
      ],
    },
    {
      title: 'Animer les propriétés et les sommets de tracé',
      blocks: [
        {
          kind: 'list',
          items: [
            'Dépliez un calque pour révéler les groupes de propriétés imbriqués, les commandes de valeur, la clé automatique, la navigation et les losanges d’images clés.',
            'Réglez le filtre de propriétés sur **Propriétés animées** quand vous n’avez besoin que des lignes qui contiennent des clés.',
            'Sélectionnez le losange d’une propriété pour ajouter ou retirer une clé à la tête de lecture partagée.',
            'Sélectionnez deux clés voisines pour modifier l’accélération de leur segment.',
            'Sélectionnez l’icône de courbe d’une propriété pour remplacer sa piste de dope sheet par un graphique de valeurs intégré.',
            'Ouvrez le menu du groupe Position et choisissez **Dimensions de position séparées** pour modifier X et Y indépendamment.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Les formes de tracé exposent des pistes de sommets dans Motion. Sélectionnez des points du tracé dans l’aperçu, puis basculez entre **Sommets sélectionnés** et **Tous les sommets** au-dessus des lignes de propriétés.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Une fois que Path Geometry a des images clés, vous ne pouvez plus ajouter, retirer, réordonner ni changer le premier sommet du tracé. Supprimez ces clés avant de modifier la topologie du tracé.',
        },
      ],
    },
    {
      title: 'Lier des calques en parenté avec un objet nul',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Choisissez **Ajouter un élément > Objet nul**. Un objet nul pilote des transformations mais ne produit aucun rendu.',
            'Choisissez un parent dans le menu **Parent**, ou faites glisser le pick whip Parent sur un autre calque.',
            'Relâchez normalement pour conserver la pose du calque enfant sur le canevas.',
            'Maintenez **Shift** en relâchant pour aimanter la position de l’enfant sur celle du parent.',
            'Maintenez **Alt/Option** en relâchant pour utiliser la pose locale créée de l’enfant.',
            'Faites Ctrl+clic ou Commande+clic sur le pick whip de l’enfant pour le détacher en conservant sa pose actuelle.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les cibles de parent valides sont mises en évidence pendant que vous faites glisser. Motion refuse l’auto-parenté, les cibles descendantes et les liens qui créeraient un cycle.',
        },
      ],
    },
    {
      title: 'Lier des propriétés ou écrire une expression',
      blocks: [
        {
          kind: 'paragraph',
          text: 'La parenté crée une hiérarchie de calques. Une **Liaison de propriété** fait suivre une propriété à une autre sans changer cette hiérarchie.',
        },
        {
          kind: 'list',
          items: [
            'Faites glisser le pick whip d’une propriété vers une ligne compatible dans Motion, le dope sheet ou le graphique.',
            'Liez des valeurs scalaires à des valeurs scalaires. Position, Échelle et Ancrage se lient comme des valeurs bidimensionnelles complètes.',
            'Sélectionnez le bouton accolades pour ajouter une expression en bac à sable sans supprimer les images clés de la propriété.',
            'Utilisez le pick whip d’expression pour insérer une référence `prop("layer-id", "property")` au curseur de texte.',
            'Utilisez `value`, `preValue`, `frame`, `time`, des valeurs scalaires ou `[x, y]`, l’arithmétique et les fonctions mathématiques prises en charge.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio évalue d’abord les images clés, puis la Liaison de propriété, puis l’expression. L’aperçu et l’exportation suivent le même ordre.',
        },
      ],
    },
    {
      title: 'Exposer des commandes pour les compositions réutilisées',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Ouvrez **Commandes publiées** dans la composition source.',
            'Publiez le texte ou les couleurs qu’un monteur doit pouvoir changer sur les instances placées.',
            'Placez la composition dans une séquence ordinaire et sélectionnez cette instance.',
            'Modifiez ses valeurs publiées dans les Propriétés sans changer la composition source.',
            'Réinitialisez un remplacement, ou utilisez **Réinitialiser tous les remplacements** pour restaurer les valeurs de la source.',
          ],
        },
      ],
    },
    {
      title: 'Utiliser la composition dans Montage',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Une composition Motion reste une ressource de composition réutilisable. Placez-la dans une séquence, puis déplacez, rognez, animez l’instance ou appliquez-lui des effets comme à n’importe quel autre clip.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'L’animation interne des calques et l’animation du clip entier restent indépendantes. Un titre peut s’animer en interne pendant que son instance placée se déplace ou apparaît en fondu dans Montage.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
