import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'Effets et couleur',
  description:
    'Ajouter et empiler des effets GPU, étalonner avec des roues et des courbes, lire les scopes, appliquer des LUT et isoler des corrections.',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: 'Ajouter et gérer des effets',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Sélectionnez un clip et ouvrez la section **Effets** dans les Propriétés.',
            'Utilisez **Ajouter un effet**, puis cherchez ou choisissez dans une catégorie. Vous pouvez aussi ajouter des **Préréglages** intégrés ou vos propres préréglages enregistrés.',
            'Réorganisez la pile avec **Monter** et **Descendre** : l’ordre change la façon dont les effets se combinent.',
            'Désactivez, réinitialisez ou supprimez un effet depuis son panneau ; les paramètres numériques peuvent être animés par images clés.',
          ],
        },
      ],
    },
    {
      title: 'Le catalogue d’effets',
      blocks: [
        {
          kind: 'table',
          headers: ['Catégorie', 'Effets'],
          rows: [
            [
              'Couleur',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['Flou', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              'Déformation',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, Ripple Glass, Glass Mosaic, Blocks, Droste, et d’autres',
            ],
            [
              'Stylisation',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, VHS, Halftone, Dither, ASCII, Ink, Pixel Sort, Block Glitch, Color Glitch',
            ],
            ['Incrustation', 'Chroma Key (suppression de fond vert et bleu)'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Tous les effets sont rendus sur le GPU (WebGPU). Parmi les ajouts récents : **Gradient Map**, **VHS**, **CRT**, **Droste**, **Block Glitch**, les déformations **Ripple Glass** et **Glass Mosaic**, **Ink** et **Pixel Sort**.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**ASCII** peut afficher ses propres caractères : réglez **Character Set** sur **Personnalisé**, saisissez vos **Caractères personnalisés** (la rampe va du plus dense au plus clair) et choisissez une **Police** (Monospace, Courier, Consolas ou Lucida Console). Les jeux intégrés comprennent ASCII Ramp, Dense, Binary et Symbols.',
        },
      ],
    },
    {
      title: 'Saisie des couleurs et pipette',
      blocks: [
        {
          kind: 'list',
          items: [
            'Chaque commande de couleur accepte une valeur **hexadécimale** ; saisissez-la directement dans le champ (l’aperçu se met à jour au fur et à mesure).',
            'Là où la transparence est prise en charge, le champ accepte l’hexadécimal à 8 chiffres (`#rrggbbaa`) et le sélecteur ajoute un curseur alpha.',
            'Cliquez sur la **pipette** pour prélever une couleur n’importe où dans l’application ou l’aperçu ; une loupe suit le curseur pour que vous tombiez sur le pixel exact, puis cliquez pour appliquer.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La pipette est un outil de prélèvement intégré à l’application (et non celui du navigateur) et ne demande aucune autorisation. Le même outil sert aux roues de l’espace de travail Étalonnage.',
        },
      ],
    },
    {
      title: 'Étalonner dans l’espace de travail Étalonnage',
      blocks: [
        {
          kind: 'list',
          items: [
            'Passez à l’espace de travail **Étalonnage** (`Alt+2`) et sélectionnez un clip ; les roues et les courbes sont prêtes même avant qu’un étalonnage n’existe.',
            'Les **Roues chromatiques** règlent les Ombres, les Tons moyens, les Hautes lumières et l’Offset, avec des pipettes de balance des blancs et une balance automatique.',
            'Les **Courbes** modifient les canaux Principal, Rouge, Vert et Bleu ; cliquez sur une courbe pour ajouter un point et double-cliquez sur un point pour le supprimer.',
            'Comparez avec **Avant**, **Après** et **Partagé**, et copiez un look d’un clip à l’autre avec **Copier l’étalonnage** et **Coller l’étalonnage**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Contourner l’étalonnage** affiche en aperçu l’image non étalonnée, mais n’affecte jamais les exports.',
        },
      ],
    },
    {
      title: 'Lire les scopes',
      blocks: [
        {
          kind: 'table',
          headers: ['Scope', 'Affiche'],
          rows: [
            ['Waveform', 'La répartition de la luminance et de la couleur, de haut en bas'],
            ['RGB Parade', 'Les canaux rouge, vert et bleu côte à côte'],
            ['Vectorscope', 'La teinte et la saturation'],
            ['Histogramme', 'La répartition des tons'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Activez ou désactivez les scopes avec **Afficher les scopes de couleur**. Waveform et Histogramme proposent aussi des vues RVB, par canal unique et luma (Y).',
        },
      ],
    },
    {
      title: 'LUT et corrections isolées',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ajoutez l’effet **LUT (.cube)**, choisissez **Importer un LUT .cube**, puis réglez **Intensité** pour le fondre dans l’image.',
            '**Secondary Qualifier** cible une correction sur une plage de teinte, de saturation et de luminance.',
            '**Power Window** limite une correction à un masque elliptique ou rectangulaire, avec adoucissement et inversion.',
            'Ajoutez un **calque d’ajustement** pour étalonner ou appliquer des effets à tous les clips des pistes situées en dessous.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'L’importation de LUT nécessite un navigateur basé sur Chromium.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
