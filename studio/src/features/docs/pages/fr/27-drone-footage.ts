import type { DocPageContent } from '../../docs-content'

// DroneClean Studio's own tools for drone and FPV footage (19 Nov 2026; the tools of 0.1.3-0.1.4 added 20 Nov 2026):
// what FreeCut's pages do not cover.
const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Images de drone\u00a0: stabiliser, étalonner, accélérer, partager',
  description:
    'Stabilisation gyro et cadrage, profil D-Log M, looks et ciel, rampes de vitesse avec lissage, flou de mouvement et ralenti fluide, marqueurs de temps forts, montage fluide en un clic, exportation Reel Instagram et accès des agents.',
  category: 'Creative Tools',
  related: ['effects-color', 'keyframes', 'export', 'properties'],
  sections: [
    {
      title: 'Stabiliser à partir des données du gyro',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Les fichiers DJI et GoPro portent les mouvements de la caméra. Sélectionnez un clip et activez **Stabiliser ce clip** sous Propriétés › Vidéo › Stabilisation\u00a0: le clip est stabilisé à partir de ces données, sans passe d’analyse, et **Lissage** et **Verrouillage de l’horizon** l’affinent.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Un clip stabilisé est dessiné au format du projet. Un clip Avata en 4:3 dans un projet 9:16 remplit tout seul le cadre vertical\u00a0; vous n’avez pas besoin de le mettre à l’échelle.',
        },
        {
          kind: 'paragraph',
          text: '**Cadrage** (deux curseurs sous Stabilisation) déplace la fenêtre stabilisée latéralement ou de haut en bas dans l’image, aussi loin que la stabilisation laisse de la marge, pour qu’un montage vertical garde son sujet dans le champ. Le losange à côté de chaque curseur y pose une clé, pour que le cadrage puisse suivre le sujet pendant le plan.',
        },
      ],
    },
    {
      title: 'Couleur\u00a0: profil, look, étalonnage',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Réglez le **Profil de couleur** des clips en log (D-Log M pour l’Avata 2, D-Log)\u00a0: l’image plate devient du Rec.709 avant tout le reste. Les fichiers DJI n’indiquent pas dans quel profil ils ont été tournés\u00a0: la première importation DJI d’un projet pose donc la question une fois\u00a0; **Oui, D-Log M** l’applique à ces clips. Le profil a été ajusté sur des images de l’Avata 2. DJI publie aussi une LUT D-Log M pour le Mini 4 Pro et l’Air 3, et le panneau reconnaît ces drones, mais leur couleur n’a pas été vérifiée ici, et le panneau le signale.',
            'Choisissez un **Look** (un fichier `.cube` de la bibliothèque de looks de l’espace de travail\u00a0; **Gérer les looks… › Ajouter un .cube** en ajoute un) et son **Intensité**.',
            'Terminez dans **Effets**\u00a0: Color Wheels pour le contraste, les hautes lumières et le détail des tons moyens\u00a0; **Sky** donne à un ciel blanc couvert un bleu dégradé (horizon, angle, douceur, et une protection qui le maintient sur les pixels clairs et pâles)\u00a0; un Secondary Qualifier et une Power Window font la même chose à la main\u00a0; Glow, Vignette et Sharpen finissent l’image.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La glace et la neige sont blanches aussi\u00a0: sur les plans glacés, gardez le qualificateur léger et laissez la fenêtre dégradée colorer le ciel.',
        },
      ],
    },
    {
      title: 'Vitesse, flou de mouvement et ralenti fluide',
      blocks: [
        {
          kind: 'table',
          headers: ['Commande', 'Ce qu’elle fait'],
          rows: [
            [
              'Vitesse',
              'Une vitesse constante\u00a0; le clip garde sa plage source et sa longueur suit.',
            ],
            [
              'Courbe…',
              'Une courbe de vitesse avec des clés\u00a0: accélération progressive, décélération progressive, ou les deux, chaque segment étant Linéaire, Doux, Entrée douce ou Sortie douce. Le panneau indique les images par seconde que le clip a réellement à son point le plus lent.',
            ],
            [
              'Rampe douce + zoom',
              'La recette du reel de drone en un clic, dans le panneau de vitesse\u00a0: rapide, environ 0,45x au milieu, de nouveau rapide, avec des segments doux, un ralenti fluide, du flou de mouvement et un zoom avant adouci.',
            ],
            [
              'Flou de mouvement',
              'Au-dessus de 1x, fond les images source que couvre chaque image de sortie, avec un obturateur de 90° à 360°.',
            ],
            [
              'Ralenti fluide',
              'En dessous de 1x, ou pour un fichier à 30 ips dans un projet à 60 ips, fabrique les images intermédiaires au lieu d’afficher deux fois la même image\u00a0: le mélange d’images fond les deux images source, le flux optique construit l’image à partir du mouvement entre elles (plus net, sans doubles images).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Ne ralentissez que des images tournées à une cadence supérieure à celle du projet. Un fichier à 30 ips dans un projet à 60 ips a déjà la moitié des images dont il a besoin\u00a0: gardez-le à 1x ou plus vite, et ne ralentissez pas des images à 60 ips en dessous de 0,5x.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Coupez sur les temps forts de la musique, pas sur chaque temps\u00a0: faites un clic droit sur la musique et choisissez **Marquer les temps forts** (un marqueur sur chaque fort coup de basse), ou marquez-les vous-même avec `M`, puis laissez chaque clip courir d’un marqueur au suivant.',
        },
      ],
    },
    {
      title: 'Montage fluide en un clic',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Placez vos clips vidéo et un morceau sur la timeline, puis cliquez sur **Montage fluide…** (le bouton aux étincelles dans la barre de la timeline). L’éditeur trouve les temps forts du morceau, place les clips vidéo bout à bout à partir du premier temps fort, chacun coupé au nombre de mesures choisi, et donne à chacun le look du montage fluide\u00a0: une rampe de vitesse rapide, lente, rapide avec ralenti par flux optique, flou de mouvement et un zoom avant lissé. C’est le montage des reels de drone en une seule étape.',
        },
        {
          kind: 'steps',
          items: [
            "Ajoutez le morceau et les clips à la timeline. S’il n’y a aucun clip audio, la boîte de dialogue indique **Ajoutez d'abord un morceau à la timeline**.",
            'Cliquez sur **Montage fluide…**, choisissez le morceau s’il y en a plusieurs, la **Durée du plan** (1, 2 ou 4 mesures\u00a0; une mesure fait quatre temps) et si vous voulez un **Court fondu enchaîné à chaque coupe**.',
            'La boîte de dialogue indique combien de clips vont changer. Cliquez sur **Appliquer**.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Chaque clip garde son point d’entrée\u00a0: rognez d’abord le début d’un clip pour choisir où commence son plan. Les parties rapides consomment les images plus vite qu’elles ne durent, donc un plan d’une mesure utilise environ une mesure et demie du clip. Un clip qui a trop peu d’images après son point d’entrée est ignoré, et les clips qui finiraient après le morceau restent tels quels, après le dernier plan. Un clip stabilisé garde sa stabilisation. Rien n’est supprimé, et **Ctrl/Cmd+Z** annule tout le montage en une fois.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Un agent d’IA peut faire la même chose en un seul appel, `studio.clips.smoothEditTimeline({ bars, crossfade })`, tout en choisissant lui-même, avant, la meilleure partie de chaque clip.',
        },
      ],
    },
    {
      title: 'Exporter pour Instagram',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Le préréglage **Reel Instagram** suit la spécification Reel de Meta\u00a0: MP4 H.264 à la cadence d’images du projet, 1080x1920 (le cadre qu’Instagram affiche), 20 Mbit/s à 60 ips ou 12 Mbit/s à 30 ips, sous le maximum de 25 Mbit/s de Meta, avec du son AAC à 128 kbit/s, l’index au début du fichier et sans liste d’édition. Instagram réencode chaque envoi\u00a0; lui donner directement son cadre et sa taille évite une seconde mise à l’échelle.',
        },
        {
          kind: 'paragraph',
          text: 'Les préréglages **TikTok** et **YouTube Shorts** produisent le même MP4 H.264 vertical en 1080x1920 à la fréquence d’images du projet (jusqu’à 60\u00a0fps). **YouTube Shorts** utilise les débits 1080p publiés par YouTube\u00a0: 12\u00a0Mbit/s à 60\u00a0fps ou 8\u00a0Mbit/s à 30\u00a0fps, avec un son AAC stéréo à 384\u00a0kbit/s. TikTok ne publie aucun débit, donc **TikTok** utilise 16\u00a0Mbit/s à 60\u00a0fps ou 10\u00a0Mbit/s à 30\u00a0fps, un choix de notre part, avec de l’AAC à 128\u00a0kbit/s. Les deux plateformes réencodent chaque envoi.',
        },
      ],
    },
    {
      title: 'Laisser un agent d’IA monter',
      blocks: [
        {
          kind: 'paragraph',
          text: 'L’application de bureau exécute un serveur MCP local pour les agents d’IA de votre ordinateur, activé par défaut\u00a0: **Paramètres › Accès des agents › Autoriser les agents IA** le désactive ou le réactive, et seul votre utilisateur peut y accéder. Le panneau affiche la commande pour Claude Code ou la configuration pour d’autres clients. Un agent peut alors construire et étalonner un projet et l’exporter avec le même SDK que celui de l’éditeur, et chaque modification est une étape d’annulation que vous pouvez voir. Chaque appel qui modifie le projet l’enregistre.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
