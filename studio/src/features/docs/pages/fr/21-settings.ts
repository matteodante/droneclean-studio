import type { DocPageContent } from '../../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Paramètres',
  description:
    'Les onglets Général, Montage, IA, Stockage et Confidentialité, et où se règlent la langue et les raccourcis.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'Les onglets',
      blocks: [
        {
          kind: 'table',
          headers: ['Onglet', 'Ce que vous réglez'],
          rows: [
            [
              'Général',
              'Enregistrement automatique activé/désactivé et intervalle (5 à 30 min)\u00a0; profondeur de l’historique d’annulation (10 à 200 étapes)\u00a0; sons de l’interface (activés/désactivés, volume, thème sonore).',
            ],
            [
              'Montage',
              'Aimantation par défaut\u00a0; affichage des formes d’onde et des bandes de vignettes\u00a0; extraction des bandes de vignettes à l’importation.',
            ],
            [
              'IA',
              'Intervalle d’échantillonnage des légendes (secondes ou images)\u00a0; style de légende par défaut.',
            ],
            [
              'Stockage',
              'Générer les proxys manquants\u00a0; vider le cache du projet\u00a0; régénérer les vignettes\u00a0; supprimer les proxys\u00a0; gérer l’IA locale.',
            ],
            [
              'Confidentialité',
              'Rapports de plantage et statistiques d’utilisation anonymes, chacun activé ou désactivé (les deux sont désactivés tant que vous ne les autorisez pas)\u00a0; dans l’app de bureau, aussi **Rechercher les nouvelles versions** (activé par défaut).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Vider le cache du projet supprime les données régénérables (formes d’onde, bandes de vignettes, images de GIF, audio décodé)\u00a0; cela ne supprime jamais les médias sources. Utilisez **Réinitialiser** dans l’en-tête de la boîte de dialogue pour restaurer les valeurs par défaut.',
        },
      ],
    },
    {
      title: 'Nouvelles versions',
      blocks: [
        {
          kind: 'paragraph',
          text: 'L’app de bureau n’est pas signée, elle ne peut donc pas se mettre à jour toute seule. À la place, au démarrage (au plus une fois par jour), elle demande à GitHub le numéro de la dernière version et, s’il en existe une plus récente, affiche une petite carte avec **Télécharger** (ouvre la page de cette version dans votre navigateur) et **Plus tard** (la masque jusqu’au lendemain). Rien ne s’affiche pendant le rendu d’une exportation. C’est la seule requête que l’app fait sans que vous la demandiez, c’est pourquoi elle a un interrupteur\u00a0: **Paramètres › Confidentialité › Rechercher les nouvelles versions**, activé par défaut. GitHub voit votre adresse IP\u00a0; rien d’autre sur vous ou votre travail n’est envoyé, et interrupteur désactivé, aucune requête n’est faite. L’éditeur web est toujours à la dernière version et ne vérifie jamais.',
        },
      ],
    },
    {
      title: 'Sons de l’interface',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio peut jouer de discrets sons d’interface synthétisés, de courts signaux qui confirment des actions comme sélectionner, valider, basculer et supprimer. Ils sont **désactivés par défaut**, à activer volontairement, et n’affectent jamais l’audio exporté.',
        },
        {
          kind: 'steps',
          items: [
            'Ouvrez **Paramètres** et allez dans l’onglet **Général**.',
            'Activez **Sons de l’interface**.',
            'Réglez **Volume du son** à votre goût (0 à 100\u00a0%).',
            'Choisissez un **Thème sonore** (**Signature**, **Velvet** ou **Crisp**) et utilisez le bouton **Aperçu** pour l’écouter.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Les sons sont supprimés pendant la lecture de l’aperçu, afin de ne jamais se mêler à l’audio que vous écoutez\u00a0; les exports sont silencieux par construction. Activer la bascule joue une courte confirmation.',
        },
      ],
    },
    {
      title: 'Rapports de plantage et statistiques d’utilisation',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio n’envoie rien sur vous ni sur votre travail sans votre accord. À la première ouverture, il demande, dans une carte en bas à gauche, s’il peut envoyer des **rapports de plantage** et des **statistiques d’utilisation anonymes**\u00a0; tant que vous n’avez pas répondu, et après **Ne pas autoriser**, rien n’est envoyé. Vous pouvez changer l’un ou l’autre à tout moment dans **Paramètres › Confidentialité**.',
        },
        {
          kind: 'table',
          headers: ['Rapport', 'Ce qui est envoyé', 'Où'],
          rows: [
            [
              'Rapports de plantage',
              'L’erreur, l’endroit où elle s’est produite dans le code de l’éditeur, la version et le système d’exploitation. Les chemins et les noms de fichiers sont retirés des messages avant qu’ils ne partent.',
              'Sentry, dans l’UE',
            ],
            [
              'Statistiques d’utilisation',
              'Que l’application a été ouverte, qu’un projet a été créé (sa taille et sa cadence d’images), qu’une exportation s’est terminée (son format, sa taille et sa durée), qu’un agent d’IA s’est connecté, ou qu’une ombre a été retirée (sa durée), sous un identifiant aléatoire de cette installation, oublié quand vous désactivez les statistiques.',
              'PostHog, dans l’UE',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Jamais envoyés\u00a0: vos images, vos fichiers vidéo, les noms de vos fichiers et dossiers, les noms de vos projets ni votre compte. Votre adresse IP n’est pas conservée. L’application de bureau garde votre réponse dans son dossier de profil, l’éditeur web dans votre navigateur.',
        },
      ],
    },
    {
      title: 'Personnaliser les raccourcis clavier',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Les raccourcis clavier sont entièrement personnalisables, mais l’éditeur est sa propre boîte de dialogue, ouverte avec le bouton **Clavier** de la barre d’outils, et non cette boîte de dialogue Paramètres. Il comprend un clavier interactif à l’écran, la recherche et les filtres **Personnalisé** / **Conflits** / **Non attribué**, l’enregistrement pour réaffecter, les affectations alternatives, les valeurs par défaut par commande et **Tout réinitialiser**, la détection des conflits, et l’**Importation** / l’**Exportation** de préréglages JSON.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Consultez la page **Raccourcis clavier** pour la liste complète des commandes et un pas-à-pas de réaffectation.',
        },
      ],
    },
    {
      title: 'Réglé ailleurs',
      blocks: [
        {
          kind: 'list',
          items: [
            'La **langue** de l’interface est une commande distincte de la barre d’outils, qui ne fait pas partie de cette boîte de dialogue\u00a0; DroneClean Studio est livré en 10 langues.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio utilise actuellement un seul thème sombre\u00a0; il n’y a pas de sélecteur de thème.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
