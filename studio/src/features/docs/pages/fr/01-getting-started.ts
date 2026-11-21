import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Prise en main',
  description:
    'Ce qu’est DroneClean Studio, ce dont votre navigateur a besoin et votre premier montage, du lancement à l’exportation.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'Ce qu’est DroneClean Studio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio est un éditeur vidéo **local-first** qui s’exécute entièrement dans votre navigateur : pas de compte, pas de téléversement, pas de rendu sur un serveur. Le montage, les effets, l’étalonnage, les outils d’IA et l’exportation s’exécutent tous sur votre propre machine, avec votre GPU et votre CPU.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Vos médias restent sur votre appareil. DroneClean Studio crée un lien vers les fichiers d’origine et écrit les projets, les caches et les exports dans un **dossier d’espace de travail** que vous choisissez : rien n’est envoyé dans le cloud.',
        },
      ],
    },
    {
      title: 'Ce dont votre navigateur a besoin',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio s’appuie sur des API web récentes : un navigateur Chromium récent est donc la voie prise en charge.',
        },
        {
          kind: 'table',
          headers: ['Navigateur', 'État'],
          rows: [
            ['Chrome / Edge 113+', 'Entièrement pris en charge'],
            ['Brave', 'Fonctionne après avoir activé l’option de l’API File System Access'],
            ['Safari / Firefox', 'Pas encore pris en charge pour l’ensemble du flux de travail'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio utilise l’API File System Access (dossiers d’espace de travail), WebCodecs (décodage et exportation), WebGPU (effets, étalonnage, IA) et OPFS (caches). Gardez l’accélération matérielle activée et les pilotes de GPU à jour.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave peut bloquer l’accès aux dossiers. Ouvrez `brave://flags/#file-system-access-api`, réglez l’option sur **Enabled**, puis relancez Brave.',
        },
      ],
    },
    {
      title: 'Votre premier montage',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Ouvrez DroneClean Studio dans un navigateur pris en charge et, lorsque l’application le demande, choisissez un **dossier d’espace de travail** en lecture et en écriture.',
            'Sur la page Projets, choisissez **Nouveau projet** et définissez la résolution et la cadence d’images du montage.',
            'Ouvrez l’onglet **Médias** et utilisez **Importer** pour ajouter des fichiers, ou glissez les médias directement dans la bibliothèque.',
            'Glissez un clip du panneau Médias vers une piste de la timeline.',
            'Appuyez sur `Space` pour lire, et sur `Left` et `Right` pour avancer ou reculer d’une image à la fois.',
            'Enregistrez avec `Ctrl+S` au fil du travail, puis choisissez **Exporter** pour rendre la vidéo terminée.',
          ],
        },
      ],
    },
    {
      title: 'Vérifier que votre configuration fonctionne',
      blocks: [
        {
          kind: 'list',
          items: [
            'Le sélecteur d’espace de travail s’ouvre et accepte un dossier ordinaire (pas un emplacement système protégé).',
            'Les médias importés apparaissent sous forme de cartes avec vignettes dans le panneau Médias.',
            'La lecture démarre depuis la timeline quand vous appuyez sur `Space`.',
            'L’exportation s’ouvre et la vérification préalable ne signale aucun problème bloquant.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Si une étape échoue, consultez la page **Dépannage** pour trouver le symptôme correspondant.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
