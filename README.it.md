<p align="center">
  <a href="https://droneclean.app/it/"><img src="https://droneclean.app/media/studio-demo.webp" alt="Claude Code, a destra, monta sei clip di drone in DroneClean Studio tramite il suo server MCP, mostrato 47 volte più veloce" width="100%"></a>
</p>

<h1 align="center">DroneClean Studio</h1>

<p align="center">
  <a href="README.md">English</a> &nbsp;·&nbsp;
  <strong>Italiano</strong> &nbsp;·&nbsp;
  <a href="README.es.md">Español</a> &nbsp;·&nbsp;
  <a href="README.fr.md">Français</a> &nbsp;·&nbsp;
  <a href="README.de.md">Deutsch</a> &nbsp;·&nbsp;
  <a href="README.pt-BR.md">Português (Brasil)</a> &nbsp;·&nbsp;
  <a href="README.tr.md">Türkçe</a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="README.ko.md">한국어</a> &nbsp;·&nbsp;
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <strong>Un editor video gratuito e local-first per piloti FPV e di droni.</strong><br>
  Stabilizzazione dal giroscopio, colore D-Log M, rampe di velocità fluide con slow motion a flusso ottico e un server MCP per gli agenti AI.
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="Ultima versione" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="Licenza: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS (Apple silicon), Windows e web" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>Scarica per Mac</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>Scarica per Windows</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/it/studio/"><strong>Aprilo nel browser</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/it/">droneclean.app</a>
</p>

Il video qui sopra mostra Claude Code che monta sei clip DJI Avata 2 tramite il server MCP dell'editor, senza mai
toccare il mouse. Legge i battiti del brano, sceglie qualche secondo di ogni clip e taglia a tempo di musica, le
stabilizza con i dati del giroscopio, converte il colore D-Log M, dà a ogni inquadratura una rampa di velocità con slow
motion a flusso ottico e motion blur, e guarda i fotogrammi per escludere persone e auto. I 19 minuti che ha impiegato
sono mostrati 47 volte più veloci. Ogni modifica è un normale passaggio dell'editor, che puoi annullare o continuare a
ritoccare a mano.

## Prima e dopo

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="Lo stesso reel di drone affiancato: a sinistra com'è stato girato, piatto e traballante; a destra stabilizzato, colorato e con rampe di velocità in DroneClean Studio" width="488">
</p>

I primi 24 secondi di un reel montato in DroneClean Studio con clip dello stesso volo. A sinistra i tagli come sono stati
girati: colore D-Log M piatto, le vibrazioni del drone, velocità reale. A destra il montaggio finito: stabilizzato con i
dati del giroscopio, D-Log M convertito e corretto nel colore, con rampe di velocità, slow motion a flusso ottico e
motion blur.

## Funzioni

- **Stabilizzazione dal giroscopio.** I file DJI e GoPro contengono il movimento della videocamera; Studio li
  stabilizza con il motore di [Gyroflow](https://github.com/gyroflow/gyroflow) compilato in WebAssembly, senza una fase
  di analisi. Una clip 4:3 in un progetto 9:16 riempie da sola il formato verticale, e un'inquadratura animabile con
  keyframe tiene il soggetto in vista.
- **Colore per riprese da drone.** Da DJI D-Log M e D-Log a Rec.709, look creativi da file `.cube`, ruote colore,
  curve, qualificatori secondari, finestre di potenza e un gradiente per il cielo, per i cieli slavati.
- **Velocità.** Curve di velocità con segmenti ammorbiditi e un "rampa fluida + zoom" con un clic. Il motion blur segue
  il movimento di ogni pixel lungo il flusso ottico, e lo slow motion crea nuovi fotogrammi a partire da esso invece di
  ripetere quelli esistenti. Marcatori di battito dal brano.
- **Keyframe** su ogni proprietà e parametro degli effetti, con easing bezier e a molla.
- **Esportazione.** Preset per YouTube 4K e Instagram Reels, e master a 10 bit (ProRes 422 HQ, HEVC Main 10) nell'app
  desktop.
- **Agenti AI.** Un server MCP locale: Claude, o un altro client MCP, può costruire, correggere nel colore ed esportare
  un progetto tramite lo stesso SDK usato dall'editor, e ogni modifica è un passaggio annullabile.
- **Rimozione dell'ombra del drone**, l'unico effetto a pagamento, tramite il servizio cloud di DroneClean.
- **Local-first.** Progetti e file multimediali restano in una cartella che scegli tu; le riprese lasciano il tuo
  computer solo quando ne invii un pezzo per eliminare l'ombra.

<p align="center">
  <img src=".github/assets/studio.webp" alt="L'editor DroneClean Studio con una clip di spiaggia sulla timeline e l'ombra di un drone segnata sull'immagine" width="820">
</p>

## Installazione

**Mac (Apple silicon):** scarica l'immagine disco dall'[ultima versione](../../releases/latest) e trascina
DroneClean Studio in Applicazioni. Questa build non è ancora firmata da Apple, quindi macOS la blocca la prima volta:
aprila una volta, poi vai in Impostazioni di Sistema › Privacy e sicurezza e premi **Apri comunque**.

**Windows 10 e 11 (x64):** scarica `DroneClean-Studio-x64.exe` dall'[ultima versione](../../releases/latest) ed
eseguilo; si installa per il tuo utente, senza richiesta di amministratore. Non è ancora firmato, quindi SmartScreen lo
blocca la prima volta: scegli **Ulteriori informazioni › Esegui comunque**. Include il proprio FFmpeg con encoder
NVIDIA, Intel e AMD.

**Browser:** [droneclean.app/studio](https://droneclean.app/it/studio/) esegue lo stesso editor in Chrome o Edge su
computer (richiede la File System Access API).

## Usalo con un agente AI

L'accesso degli agenti è attivo di default nell'app desktop (solo il tuo utente può raggiungerlo; **Impostazioni ›
Accesso agenti › Consenti agenti IA** lo disattiva), e quel pannello mostra il comando esatto. Per Claude Code su Mac:

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

Su Windows il comando indica
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd` (il pannello lo mostra con il percorso
del tuo utente).

Il server ha quattro strumenti: `search` (il riferimento dell'SDK, la guida utente e la mappa delle funzioni), `run`
(uno script sull'SDK dell'editor), `frame` (un fotogramma renderizzato o un provino a contatto) e `export`. Poi chiedi
un montaggio con parole tue, come nel video qui sopra: "fai un montaggio fluido da drone con le sei clip del progetto
aperto, tagliando a tempo con il brano".

## Compilare dai sorgenti

macOS su Apple silicon, Node 24, Rust con il target `wasm32-unknown-unknown`, `wasm-bindgen-cli` 0.2.130 e
`wasm-opt` (Binaryen).

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # l'editor, il wasm di Gyroflow e FFmpeg, poi l'app in dist/mac-arm64
```

In `studio/`, `npm run check:quick` esegue i controlli rapidi e `npm run verify` la suite completa (servono Google
Chrome e FFmpeg).

## Struttura del repository

| Percorso | Cos'è |
| --- | --- |
| `studio/` | L'editor, un fork di [FreeCut](https://github.com/walterlow/freecut) (MIT). Il codice di DroneClean è in `studio/src/studio/`. |
| `studio/desktop/` | L'app Electron, la sua build di FFmpeg e lo script di rilascio. |
| `studio/mcp/` | Il launcher MCP che avvia un agente. |
| `studio/web/` | Il server statico dell'editor web. |
| `gyroflow/` | Un fork di [Gyroflow](https://github.com/gyroflow/gyroflow) (GPL-3.0); `gyroflow/wasm/` compila il suo motore per l'editor. |

Questo repository è pubblicato dal processo di rilascio: ogni versione è un unico commit, con il tag `v0.1.9` per
questa.

## Contribuire e sicurezza

Segnalazioni di bug e idee sono benvenute: [apri una issue](../../issues/new/choose). [CONTRIBUTING.md](CONTRIBUTING.md)
spiega come le modifiche arrivano in una versione. Segnala una vulnerabilità in privato come descritto in
[SECURITY.md](SECURITY.md), mai in una issue pubblica.

## Licenza e crediti

GPL-3.0-or-later (vedi [LICENSE](LICENSE)). DroneClean Studio include FreeCut (MIT) e Gyroflow (GPL-3.0); l'app desktop
include FFmpeg (LGPL-2.1), compilato dal suo sorgente ufficiale con `studio/desktop/scripts/build-ffmpeg.sh`.
Lo screenshot mostra il video Pexels 39579103 con la [Licenza Pexels](https://www.pexels.com/license/). La demo e il
prima e dopo mostrano le riprese DJI Avata 2 dell'autore; sono servite da droneclean.app e non fanno parte di questo
repository né della sua licenza.
