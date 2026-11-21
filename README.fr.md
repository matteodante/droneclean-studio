<p align="center">
  <a href="https://droneclean.app/fr/"><img src="https://droneclean.app/media/studio-demo.webp" alt="Claude Code, à droite, monte six clips de drone dans DroneClean Studio via son serveur MCP, montré 47 fois plus vite" width="100%"></a>
</p>

<h1 align="center">DroneClean Studio</h1>

<p align="center">
  <a href="README.md">English</a> &nbsp;·&nbsp;
  <a href="README.it.md">Italiano</a> &nbsp;·&nbsp;
  <a href="README.es.md">Español</a> &nbsp;·&nbsp;
  <strong>Français</strong> &nbsp;·&nbsp;
  <a href="README.de.md">Deutsch</a> &nbsp;·&nbsp;
  <a href="README.pt-BR.md">Português (Brasil)</a> &nbsp;·&nbsp;
  <a href="README.tr.md">Türkçe</a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="README.ko.md">한국어</a> &nbsp;·&nbsp;
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <strong>Un éditeur vidéo gratuit et local-first pour les pilotes FPV et de drones.</strong><br>
  Stabilisation par gyroscope, couleur D-Log M, rampes de vitesse fluides avec ralenti par flux optique et un serveur MCP pour les agents IA.
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="Dernière version" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="Licence : GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS (Apple silicon), Windows et le web" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>Télécharger pour Mac</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>Télécharger pour Windows</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/fr/studio/"><strong>Ouvrir dans votre navigateur</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/fr/">droneclean.app</a>
</p>

La vidéo ci-dessus montre Claude Code en train de monter six clips DJI Avata 2 via le serveur MCP de l'éditeur, sans
qu'aucune main ne touche la souris. Il lit les temps forts du morceau, choisit quelques secondes de chaque clip et les
coupe en rythme, les stabilise à partir des données du gyroscope, convertit la couleur D-Log M, donne à chaque plan une
rampe de vitesse avec ralenti par flux optique et flou de mouvement, puis regarde les images pour écarter les personnes
et les voitures. Les 19 minutes que cela lui a pris sont montrées 47 fois plus vite. Chaque modification qu'il fait est
une étape ordinaire de l'éditeur, que vous pouvez annuler ou continuer à retoucher à la main.

## Avant et après

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="Le même reel de drone côte à côte : à gauche tel que filmé, plat et tremblant ; à droite stabilisé, étalonné et avec des rampes de vitesse dans DroneClean Studio" width="488">
</p>

Les 24 premières secondes d'un reel monté dans DroneClean Studio à partir de clips du même vol. À gauche, les plans tels
que filmés : couleur D-Log M plate, tremblements du drone, vitesse réelle. À droite, le montage terminé : stabilisé à
partir des données du gyroscope, D-Log M converti et étalonné, avec des rampes de vitesse, du ralenti par flux optique
et du flou de mouvement.

## Fonctionnalités

- **Stabilisation par gyroscope.** Les fichiers DJI et GoPro contiennent les mouvements de la caméra ; Studio les
  stabilise avec le moteur de [Gyroflow](https://github.com/gyroflow/gyroflow) compilé en WebAssembly, sans passe
  d'analyse. Un clip 4:3 dans un projet 9:16 remplit seul le cadre vertical, et un recadrage animable par images clés
  garde le sujet dans le champ.
- **Couleur pour les images de drone.** De DJI D-Log M et D-Log vers Rec.709, looks créatifs à partir de fichiers
  `.cube`, roues chromatiques, courbes, qualificateurs secondaires, fenêtres de puissance et un dégradé de ciel pour
  les ciels délavés.
- **Vitesse.** Courbes de vitesse avec segments adoucis et un « rampe fluide + zoom » en un clic. Le flou de mouvement
  suit le déplacement de chaque pixel le long du flux optique, et le ralenti crée de nouvelles images à partir de celui-ci
  au lieu de répéter les mêmes. Marqueurs de rythme tirés du morceau.
- **Images clés** sur chaque propriété et chaque paramètre d'effet, avec interpolation de type Bézier et ressort.
- **Export.** Préréglages pour YouTube 4K et Instagram Reels, et masters 10 bits (ProRes 422 HQ, HEVC Main 10) dans
  l'application de bureau.
- **Agents IA.** Un serveur MCP local : Claude, ou un autre client MCP, peut construire, étalonner et exporter un
  projet avec le même SDK que celui de l'éditeur, et chaque modification est une étape annulable.
- **Suppression de l'ombre du drone**, le seul effet payant, via le service cloud de DroneClean.
- **Local-first.** Les projets et les médias restent dans un dossier que vous choisissez ; les images ne quittent votre
  ordinateur que lorsque vous en envoyez un extrait pour supprimer l'ombre.

<p align="center">
  <img src=".github/assets/studio.webp" alt="L'éditeur DroneClean Studio avec un clip de plage sur la timeline et l'ombre d'un drone repérée sur l'image" width="820">
</p>

## Installation

**Mac (Apple silicon) :** téléchargez l'image disque depuis la [dernière version](../../releases/latest) et glissez
DroneClean Studio dans Applications. Cette version n'est pas encore signée par Apple, donc macOS la bloque la première
fois : ouvrez-la une fois, puis allez dans Réglages Système › Confidentialité et sécurité et appuyez sur **Ouvrir quand
même**.

**Windows 10 et 11 (x64) :** téléchargez `DroneClean-Studio-x64.exe` depuis la [dernière version](../../releases/latest)
et lancez-le ; il s'installe pour votre utilisateur, sans demande d'administrateur. Il n'est pas encore signé, donc
SmartScreen le bloque la première fois : choisissez **Informations complémentaires › Exécuter quand même**. Il embarque
son propre FFmpeg avec des encodeurs NVIDIA, Intel et AMD.

**Navigateur :** [droneclean.app/studio](https://droneclean.app/fr/studio/) fait tourner le même éditeur dans Chrome ou
Edge sur ordinateur (il nécessite l'API File System Access).

## L'utiliser avec un agent IA

L'accès des agents est activé par défaut dans l'application de bureau (seul votre utilisateur peut y accéder ;
**Paramètres › Accès des agents › Autoriser les agents IA** le désactive), et ce panneau affiche la commande exacte.
Pour Claude Code sur Mac :

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

Sous Windows, la commande désigne
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd` (le panneau l'affiche avec le chemin de
votre utilisateur).

Le serveur propose quatre outils : `search` (la référence du SDK, le guide utilisateur et la carte des fonctionnalités),
`run` (un script exécuté sur le SDK de l'éditeur), `frame` (une image rendue ou une planche contact) et `export`.
Demandez ensuite un montage avec vos propres mots, comme dans la vidéo ci-dessus : « fais un montage drone fluide avec
les six clips du projet ouvert, coupé sur le rythme du morceau ».

## Compiler depuis les sources

macOS sur Apple silicon, Node 24, Rust avec la cible `wasm32-unknown-unknown`, `wasm-bindgen-cli` 0.2.130 et
`wasm-opt` (Binaryen).

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # l'éditeur, le wasm de Gyroflow et FFmpeg, puis l'application dans dist/mac-arm64
```

Dans `studio/`, `npm run check:quick` lance les vérifications rapides et `npm run verify` la suite complète (elle
nécessite Google Chrome et FFmpeg).

## Structure du dépôt

| Chemin | Ce que c'est |
| --- | --- |
| `studio/` | L'éditeur, un fork de [FreeCut](https://github.com/walterlow/freecut) (MIT). Le code propre à DroneClean se trouve dans `studio/src/studio/`. |
| `studio/desktop/` | L'application Electron, sa compilation de FFmpeg et le script de publication. |
| `studio/mcp/` | Le lanceur MCP que démarre un agent. |
| `studio/web/` | Le serveur statique de l'éditeur web. |
| `gyroflow/` | Un fork de [Gyroflow](https://github.com/gyroflow/gyroflow) (GPL-3.0) ; `gyroflow/wasm/` compile son moteur pour l'éditeur. |

Ce dépôt est publié par le processus de publication : chaque version est un unique commit, étiqueté `v0.1.9` pour
celle-ci.

## Contribuer et sécurité

Les rapports de bugs et les idées sont les bienvenus : [ouvrez une issue](../../issues/new/choose).
[CONTRIBUTING.md](CONTRIBUTING.md) explique comment les modifications arrivent dans une version. Signalez une
vulnérabilité en privé comme le décrit [SECURITY.md](SECURITY.md), jamais dans une issue publique.

## Licence et crédits

GPL-3.0-or-later (voir [LICENSE](LICENSE)). DroneClean Studio inclut FreeCut (MIT) et Gyroflow (GPL-3.0) ; l'application
de bureau inclut FFmpeg (LGPL-2.1), compilé à partir de sa source officielle par `studio/desktop/scripts/build-ffmpeg.sh`.
La capture d'écran montre la vidéo Pexels 39579103 sous la [licence Pexels](https://www.pexels.com/license/). La démo et
l'avant-après montrent les images DJI Avata 2 de l'auteur ; elles sont servies depuis droneclean.app et ne font partie
ni de ce dépôt ni de sa licence.
