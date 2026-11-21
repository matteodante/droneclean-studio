<p align="center">
  <a href="https://droneclean.app/es/"><img src="https://droneclean.app/media/studio-demo.webp" alt="Claude Code, a la derecha, editando seis clips de dron en DroneClean Studio a través de su servidor MCP, mostrado 47 veces más rápido" width="100%"></a>
</p>

<h1 align="center">DroneClean Studio</h1>

<p align="center">
  <a href="README.md">English</a> &nbsp;·&nbsp;
  <a href="README.it.md">Italiano</a> &nbsp;·&nbsp;
  <strong>Español</strong> &nbsp;·&nbsp;
  <a href="README.fr.md">Français</a> &nbsp;·&nbsp;
  <a href="README.de.md">Deutsch</a> &nbsp;·&nbsp;
  <a href="README.pt-BR.md">Português (Brasil)</a> &nbsp;·&nbsp;
  <a href="README.tr.md">Türkçe</a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="README.ko.md">한국어</a> &nbsp;·&nbsp;
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <strong>Un editor de vídeo gratuito y local-first para pilotos de FPV y de drones.</strong><br>
  Estabilización por giroscopio, color D-Log M, rampas de velocidad suaves con cámara lenta por flujo óptico y un servidor MCP para agentes de IA.
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="Última versión" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="Licencia: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS (Apple silicon), Windows y la web" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>Descargar para Mac</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>Descargar para Windows</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/es/studio/"><strong>Abrir en el navegador</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/es/">droneclean.app</a>
</p>

El vídeo de arriba es Claude Code editando seis clips del DJI Avata 2 a través del servidor MCP del editor, sin tocar
el ratón. Lee los tiempos de la canción, elige unos segundos de cada clip y los corta al ritmo, los estabiliza con los
datos del giroscopio, convierte el color D-Log M, da a cada plano una rampa de velocidad con cámara lenta por flujo
óptico y desenfoque de movimiento, y mira los fotogramas para dejar fuera personas y coches. Los 19 minutos que tardó
se muestran 47 veces más rápido. Cada cambio que hace es un paso normal del editor, que puedes deshacer o seguir
editando a mano.

## Antes y después

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="El mismo reel de dron lado a lado: a la izquierda tal como se grabó, plano y tembloroso; a la derecha estabilizado, con corrección de color y rampas de velocidad en DroneClean Studio" width="488">
</p>

Los primeros 24 segundos de un reel editado en DroneClean Studio con clips del mismo vuelo. A la izquierda, los cortes
tal como se grabaron: color D-Log M plano, la vibración del dron, velocidad real. A la derecha, la edición terminada:
estabilizada con los datos del giroscopio, con el D-Log M convertido y corregido de color, con rampas de velocidad,
cámara lenta por flujo óptico y desenfoque de movimiento.

## Funciones

- **Estabilización por giroscopio.** Los archivos de DJI y GoPro llevan el movimiento de la cámara; Studio los
  estabiliza con el motor de [Gyroflow](https://github.com/gyroflow/gyroflow) compilado a WebAssembly, sin paso de
  análisis. Un clip 4:3 en un proyecto 9:16 llena el encuadre vertical por sí solo, y un reencuadre animable con
  fotogramas clave mantiene al sujeto a la vista.
- **Color para imágenes de dron.** De DJI D-Log M y D-Log a Rec.709, estilos creativos desde archivos `.cube`, ruedas
  de color, curvas, calificadores secundarios, ventanas de potencia y un degradado de cielo para cielos desvaídos.
- **Velocidad.** Curvas de velocidad con tramos suavizados y una "rampa suave + zoom" con un clic. El desenfoque de
  movimiento sigue el movimiento de cada píxel a lo largo del flujo óptico, y la cámara lenta crea fotogramas nuevos a
  partir de él en lugar de repetirlos. Marcadores de ritmo a partir de la canción.
- **Fotogramas clave** en cada propiedad y parámetro de efecto, con suavizado bezier y de resorte.
- **Exportación.** Ajustes preestablecidos para YouTube 4K e Instagram Reels, y másteres de 10 bits (ProRes 422 HQ,
  HEVC Main 10) en la app de escritorio.
- **Agentes de IA.** Un servidor MCP local: Claude, u otro cliente MCP, puede crear, corregir el color y exportar un
  proyecto con el mismo SDK que usa el editor, y cada cambio es un paso que se puede deshacer.
- **Eliminación de la sombra del dron**, el único efecto de pago, mediante el servicio en la nube de DroneClean.
- **Local-first.** Los proyectos y los archivos multimedia se quedan en una carpeta que tú eliges; las imágenes solo
  salen de tu ordenador cuando envías un fragmento para limpiar la sombra.

<p align="center">
  <img src=".github/assets/studio.webp" alt="El editor DroneClean Studio con un clip de playa en la línea de tiempo y la sombra de un dron marcada sobre la imagen" width="820">
</p>

## Instalación

**Mac (Apple silicon):** descarga la imagen de disco de la [última versión](../../releases/latest) y arrastra
DroneClean Studio a Aplicaciones. Esta versión todavía no está firmada por Apple, así que macOS la bloquea la primera
vez: ábrela una vez, ve a Ajustes del Sistema › Privacidad y seguridad y pulsa **Abrir igualmente**.

**Windows 10 y 11 (x64):** descarga `DroneClean-Studio-x64.exe` de la [última versión](../../releases/latest) y
ejecútalo; se instala para tu usuario, sin pedir permisos de administrador. Todavía no está firmado, así que
SmartScreen lo bloquea la primera vez: elige **Más información › Ejecutar de todas formas**. Incluye su propio FFmpeg
con codificadores de NVIDIA, Intel y AMD.

**Navegador:** [droneclean.app/studio](https://droneclean.app/es/studio/) ejecuta el mismo editor en Chrome o Edge en un
ordenador (necesita la File System Access API).

## Úsalo con un agente de IA

El acceso de agentes viene activado por defecto en la app de escritorio (solo tu usuario puede acceder; **Configuración
› Acceso de agentes › Permitir agentes de IA** lo desactiva), y ese panel muestra el comando exacto. Para Claude Code
en Mac:

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

En Windows el comando apunta a
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd` (el panel lo muestra con la ruta de tu
usuario).

El servidor tiene cuatro herramientas: `search` (la referencia del SDK, la guía de usuario y el mapa de funciones),
`run` (un script contra el SDK del editor), `frame` (un fotograma renderizado o una hoja de contactos) y `export`.
Después pide una edición con tus propias palabras, como en el vídeo de arriba: "haz una edición de dron fluida con los
seis clips del proyecto abierto, cortando al ritmo de la canción".

## Compilar desde el código fuente

macOS en Apple silicon, Node 24, Rust con el target `wasm32-unknown-unknown`, `wasm-bindgen-cli` 0.2.130 y
`wasm-opt` (Binaryen).

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # el editor, el wasm de Gyroflow y FFmpeg, y luego la app en dist/mac-arm64
```

En `studio/`, `npm run check:quick` ejecuta las comprobaciones rápidas y `npm run verify` el conjunto completo
(necesita Google Chrome y FFmpeg).

## Estructura del repositorio

| Ruta | Qué es |
| --- | --- |
| `studio/` | El editor, un fork de [FreeCut](https://github.com/walterlow/freecut) (MIT). El código propio de DroneClean está en `studio/src/studio/`. |
| `studio/desktop/` | La app de Electron, su compilación de FFmpeg y el script de publicación. |
| `studio/mcp/` | El lanzador MCP que inicia un agente. |
| `studio/web/` | El servidor estático del editor web. |
| `gyroflow/` | Un fork de [Gyroflow](https://github.com/gyroflow/gyroflow) (GPL-3.0); `gyroflow/wasm/` compila su motor para el editor. |

Este repositorio lo publica el proceso de lanzamiento: cada versión es un único commit, con la etiqueta `v0.1.10`
para esta.

## Contribuir y seguridad

Los informes de errores y las ideas son bienvenidos: [abre una issue](../../issues/new/choose).
[CONTRIBUTING.md](CONTRIBUTING.md) explica cómo llegan los cambios a una versión. Informa de una vulnerabilidad en
privado como describe [SECURITY.md](SECURITY.md), nunca en una issue pública.

## Licencia y créditos

GPL-3.0-or-later (consulta [LICENSE](LICENSE)). DroneClean Studio incluye FreeCut (MIT) y Gyroflow (GPL-3.0); la app de
escritorio incluye FFmpeg (LGPL-2.1), compilado desde su código fuente oficial con
`studio/desktop/scripts/build-ffmpeg.sh`. La captura muestra el vídeo 39579103 de Pexels bajo la
[Licencia de Pexels](https://www.pexels.com/license/). La demo y el antes y después muestran las imágenes del DJI Avata
2 del autor; se sirven desde droneclean.app y no forman parte de este repositorio ni de su licencia.
