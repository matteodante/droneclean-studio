import type { DocPageContent } from '../../docs-content'

// DroneClean Studio's own tools for drone and FPV footage (19 Nov 2026; the tools of 0.1.3-0.1.4 added 20 Nov 2026):
// what FreeCut's pages do not cover.
const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Grabaciones de dron: estabilizar, etalonar, velocidad, compartir',
  description:
    'Estabilización por giroscopio y encuadre, el perfil D-Log M, looks y cielo, rampas de velocidad con suavizado, desenfoque de movimiento y cámara lenta fluida, marcadores de beats, la edición suave en un clic, la exportación para Reels de Instagram, TikTok y YouTube Shorts y el acceso de agentes.',
  category: 'Creative Tools',
  related: ['effects-color', 'keyframes', 'export', 'properties'],
  sections: [
    {
      title: 'Estabilizar a partir de los datos del giroscopio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Los archivos de DJI y GoPro llevan el movimiento de la cámara. Selecciona un clip y activa **Estabilizar este clip** en Propiedades › Vídeo › Estabilización: el clip se estabiliza a partir de esos datos, sin pasada de análisis, y **Suavizado** y **Bloqueo del horizonte** lo afinan.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Un clip estabilizado se dibuja con la forma del proyecto. Un clip Avata 4:3 en un proyecto 9:16 llena por sí solo el encuadre vertical; no hace falta escalarlo.',
        },
        {
          kind: 'paragraph',
          text: '**Encuadre** (dos controles deslizantes bajo Estabilización) mueve la ventana estabilizada hacia los lados o arriba y abajo dentro de la imagen, hasta donde la estabilización deje margen, de modo que una edición vertical mantenga a su protagonista a la vista. El rombo junto a cada control deslizante le añade fotogramas clave, así que el encuadre puede seguir al protagonista a lo largo del plano.',
        },
      ],
    },
    {
      title: 'Color: perfil, look, etalonaje',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Define el **Perfil de color** de los clips en log (D-Log M para el Avata 2, D-Log): la imagen plana pasa a Rec.709 antes que nada. Los archivos de DJI no indican en qué perfil se grabaron, así que la primera importación de DJI de un proyecto pregunta una vez; **Sí, D-Log M** lo aplica a esos clips. El perfil se ajustó con imágenes del Avata 2. DJI publica una LUT D-Log M también para el Mini 4 Pro y el Air 3, y el panel reconoce esos drones, pero su color no se ha comprobado aquí, y el panel lo indica.',
            'Elige un **Look** (un archivo `.cube` de la biblioteca de looks del espacio de trabajo; **Gestionar looks… › Añadir .cube** añade uno) y su **Intensidad**.',
            'Termina en **Efectos**: Ruedas de color para el contraste, las luces altas y el detalle de medios tonos; **Sky** da a un cielo blanco y nublado un azul degradado (horizonte, ángulo, suavidad y una protección que lo mantiene en los píxeles claros y pálidos); un Secondary Qualifier y una Power Window hacen lo mismo a mano; Glow, Vignette y Sharpen rematan la imagen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'El hielo y la nieve también son blancos: en tomas con hielo, mantén suave el qualifier y deja que la ventana degradada coloree el cielo.',
        },
      ],
    },
    {
      title: 'Velocidad, desenfoque de movimiento y cámara lenta fluida',
      blocks: [
        {
          kind: 'table',
          headers: ['Control', 'Qué hace'],
          rows: [
            [
              'Velocidad',
              'Una velocidad constante; el clip conserva su rango de origen y su duración se adapta.',
            ],
            [
              'Curva…',
              'Una curva de velocidad con fotogramas clave: entrada gradual, salida gradual o ambas, y cada segmento Lineal, Suave, Entrada suave o Salida suave. El panel muestra los fotogramas por segundo que el clip tiene realmente en su punto más lento.',
            ],
            [
              'Rampa suave + zoom',
              'La receta del reel de dron con un clic, en el panel de velocidad: rápido, a unos 0,45x en el medio, rápido otra vez, con segmentos suaves, cámara lenta fluida, desenfoque de movimiento y un zoom de acercamiento suavizado.',
            ],
            [
              'Desenfoque de movimiento',
              'Por encima de 1x, mezcla los fotogramas de origen que cubre cada fotograma de salida, con un obturador de 90° a 360°.',
            ],
            [
              'Cámara lenta fluida',
              'Por debajo de 1x, o con un archivo de 30 fps en un proyecto de 60 fps, crea los fotogramas intermedios en lugar de mostrar dos veces un mismo fotograma: Fusión de fotogramas mezcla los dos fotogramas de origen y Flujo óptico construye el fotograma a partir del movimiento entre ambos (más nítido, sin imágenes dobles).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Ralentiza solo grabaciones hechas a una velocidad de fotogramas mayor que la del proyecto. Un archivo de 30 fps en un proyecto de 60 fps ya tiene la mitad de los fotogramas que necesita: déjalo a 1x o más rápido, y no ralentices las grabaciones de 60 fps más allá de 0,5x.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Corta en los tiempos fuertes de la canción, no en todos los tiempos: haz clic con el botón derecho en la canción y elige **Marcar beats** (un marcador en cada golpe fuerte de bajo), o márcalos tú mismo con `M`, y deja que cada clip corra de un marcador al siguiente.',
        },
      ],
    },
    {
      title: 'Edición suave en un clic',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Pon tus clips de vídeo y una canción en la línea de tiempo y haz clic en **Edición suave…** (el botón con destellos de la barra de la línea de tiempo). El editor encuentra los beats de la canción, coloca los clips de vídeo uno tras otro desde el primer beat, cada uno cortado al número de compases que elijas, y da a cada uno el look de la edición suave: una rampa de velocidad rápida, lenta, rápida con cámara lenta por flujo óptico, desenfoque de movimiento y un zoom de acercamiento suavizado. Es el montaje de los reels de drones en un solo paso.',
        },
        {
          kind: 'steps',
          items: [
            'Añade la canción y los clips a la línea de tiempo. Si no hay ningún clip de audio, el cuadro de diálogo dice **Añade primero una canción a la línea de tiempo**.',
            'Haz clic en **Edición suave…**, elige la canción si hay más de una, la **Duración del plano** (1, 2 o 4 compases; un compás son cuatro beats) y si quieres un **Fundido cruzado corto en cada corte**.',
            'El cuadro de diálogo dice cuántos clips cambiarán. Haz clic en **Aplicar**.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Cada clip conserva su punto de entrada, así que recorta primero el inicio de un clip para elegir dónde empieza su plano. Las partes rápidas gastan metraje más deprisa de lo que duran, así que un plano de un compás usa aproximadamente un compás y medio del clip. Un clip con muy poco metraje después de su punto de entrada se omite, y los clips que terminarían después de la canción se quedan como están, después del último plano. Un clip estabilizado conserva su estabilización. No se elimina nada y **Ctrl/Cmd+Z** deshace toda la edición de una vez.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Un agente de IA puede hacer lo mismo con una sola llamada, `studio.clips.smoothEditTimeline({ bars, crossfade })`, y aun así elegir antes por su cuenta la mejor parte de cada clip.',
        },
      ],
    },
    {
      title: 'Exportar para Instagram, TikTok y Shorts',
      blocks: [
        {
          kind: 'paragraph',
          text: 'El preajuste **Reel de Instagram** sigue la especificación de Reels de Meta: MP4 H.264 a la velocidad de fotogramas del proyecto, 20 Mbps a 60 fps o 12 Mbps a 30 fps, por debajo del máximo de 25 Mbps de Meta, con sonido AAC a 128 kbps, el índice al principio del archivo y sin lista de edición. En un proyecto vertical (9:16) el encuadre es de 1080x1920, el que muestra Instagram; en cualquier otro proyecto el preajuste conserva la forma del proyecto (1920x1080 en uno de 16:9) y nunca la estira. Instagram recodifica cada subida; darle su propio encuadre y tamaño evita un segundo reescalado.',
        },
        {
          kind: 'paragraph',
          text: 'Los preajustes **TikTok** y **YouTube Shorts** generan el mismo MP4 H.264 a la velocidad de fotogramas del proyecto (hasta 60 fps): de 1080x1920 en un proyecto vertical y con la forma del propio proyecto en cualquier otro. **YouTube Shorts** usa las tasas de 1080p que publica YouTube: 12 Mbps a 60 fps u 8 Mbps a 30 fps, con audio AAC estéreo a 384 kbps. TikTok no publica una tasa de bits, así que **TikTok** usa 16 Mbps a 60 fps o 10 Mbps a 30 fps, elegidos por nosotros, con AAC a 128 kbps. Ambas plataformas vuelven a codificar cada subida. Para un vídeo vertical, empieza con un proyecto vertical de 1080x1920; el encuadre de la estabilización elige entonces la parte de la toma del dron que se conserva.',
        },
      ],
    },
    {
      title: 'Deja que un agente de IA edite',
      blocks: [
        {
          kind: 'paragraph',
          text: 'La aplicación de escritorio ejecuta un servidor MCP local para agentes de IA de tu equipo, activado por defecto: **Configuración › Acceso de agentes › Permitir agentes de IA** lo desactiva o lo vuelve a activar, y solo tu usuario puede acceder a él. El panel muestra el comando para Claude Code o la configuración para otros clientes. Un agente puede entonces montar y etalonar un proyecto y exportarlo a través del mismo SDK que usa el editor, y cada cambio es un paso de deshacer que puedes ver. Cada llamada que cambia el proyecto lo guarda.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
