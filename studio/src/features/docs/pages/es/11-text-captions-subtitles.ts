import type { DocPageContent } from '../../docs-content'

const page = {
  order: 11,
  slug: 'text-captions-subtitles',
  title: 'Texto, subtítulos y subtítulos incrustados',
  description:
    'Añade y da estilo a clips de texto, genera subtítulos a partir de una transcripción e importa pistas de subtítulos incrustadas.',
  category: 'Creative Tools',
  related: ['motion-library', 'motion', 'shapes-masks', 'properties', 'local-ai'],
  sections: [
    {
      title: 'Tres cosas relacionadas',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo', 'Qué es', 'Parte de'],
          rows: [
            [
              'Clip de texto',
              'Un elemento independiente de la línea de tiempo en el que escribes',
              'La pestaña Texto',
            ],
            [
              'Subtítulos generados',
              'Líneas generadas que acompañan a un clip de vídeo o de audio',
              'La transcripción de un clip',
            ],
            [
              'Subtítulos',
              'Una pista de líneas de subtítulos en la línea de tiempo',
              'Una pista incrustada, o subtítulos generados consolidados',
            ],
          ],
        },
      ],
    },
    {
      title: 'Añadir un clip de texto y darle estilo',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abre la pestaña **Texto** y haz clic en **Añadir texto** o en una plantilla para colocar texto en el cabezal de reproducción; también puedes arrastrar una plantilla a la línea de tiempo o al lienzo.',
            'Elige una disposición (**Simple**, **2 fragmentos**, **3 fragmentos**) y un preajuste de estilo, como Clean, Lower Third, Cinematic o Neon.',
            'En la sección **Texto** define la fuente, el tamaño (8–500 px), el grosor, el color, el fondo, la alineación, el espaciado, el interlineado, el relleno y el radio.',
            'Añade sombra o contorno en **Efectos** y anima el texto en **Animación de texto**.',
          ],
        },
      ],
    },
    {
      title: 'Animación de texto',
      blocks: [
        {
          kind: 'paragraph',
          text: 'En la sección **Animación de texto** (en las propiedades del texto o en la biblioteca de **Motion** de la capa seleccionada), cada carácter, palabra o línea puede animarse de forma independiente. La animación de texto se mantiene en vivo y procedural, así que no hay fotogramas clave de capa que gestionar.',
        },
        {
          kind: 'steps',
          items: [
            'Selecciona un clip de texto y abre la sección **Animación de texto**.',
            'Elige un preajuste en la fila **Entrada**, **Salida** o **Bucle**. **Entrada** se reproduce al inicio del clip, **Salida** al final del clip y **Bucle** se ejecuta de forma continua entre ambos.',
            'Haz clic de nuevo en el preajuste activo (o en su ✕) para quitarlo: un preajuste por fila.',
            'Ajusta los controles que aparecen bajo el preajuste activo.',
            'En Motion, arrastra el borde de una banda de movimiento de texto para cambiar su duración, o arrastra una banda de Entrada o Salida lejos del borde del clip para desplazarla.',
          ],
        },
        {
          kind: 'table',
          headers: ['Control', 'Qué hace'],
          rows: [
            [
              'Se aplica a',
              'La unidad que anima cada preajuste: carácter, palabra, línea o clip completo.',
            ],
            ['Duración', 'Longitud, en fotogramas, de la animación de cada unidad.'],
            ['Escalonado', 'Fotogramas de retraso entre cada unidad, para un efecto en cascada.'],
            [
              'Orden',
              'Qué unidad se anima primero: hacia delante, hacia atrás, del centro hacia fuera o aleatorio.',
            ],
            ['Intensidad', 'Escala la fuerza del efecto, del 0 al 200 por ciento.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'La lista **Aplicado** muestra cada ranura de movimiento de texto en vivo. Selecciona una entrada para llevar el cabezal de reproducción a su banda en la línea de tiempo.',
        },
      ],
    },
    {
      title: 'Subtítulos a partir de una transcripción',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Genera una transcripción del clip desde la biblioteca de Medios o desde el panel de Transcripción.',
            'Usa **Generar Subtitulos** (o deja que DroneClean Studio active automáticamente los subtítulos de la transcripción) desde el menú contextual del clip.',
            'Edita los tiempos y el texto de cada línea y elige un preajuste de estilo (Netflix, YouTube, Bold Yellow, Outlined, TikTok) en la sección **Subtítulo**.',
            'Ajusta el color, el tamaño y la posición vertical de los subtítulos, y un fondo opcional.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Usa **Consolidar Subtitulos a segmento** para convertir los subtítulos de la transcripción en un segmento de subtítulos independiente.',
        },
      ],
    },
    {
      title: 'Subtítulos incrustados e importados',
      blocks: [
        {
          kind: 'list',
          items: [
            'Usa **Extraer subtítulos incrustados** en una tarjeta de medio para buscar pistas de subtítulos en un archivo.',
            'En el cuadro de diálogo **Subtítulos incrustados**, elige una pista; cada fila muestra su idioma, su códec y su número de líneas.',
            'Inserta la pista para añadir sus líneas a la línea de tiempo como un segmento de subtítulos.',
            'Edita el inicio, el final y el texto de cada línea en la sección **Subtítulo**, y aplica cursiva, negrita o subrayado a la línea completa.',
          ],
        },
      ],
    },
    {
      title: 'Subtítulos al exportar',
      blocks: [
        {
          kind: 'note',
          tone: 'info',
          text: 'Activa **Incrustar subtítulos** en los ajustes de exportación para incluir los subtítulos de la transcripción como pista de subtítulos (MP4, MKV, WebM). Algunos reproductores ocultan por defecto las pistas de subtítulos, así que es posible que el espectador tenga que activarlas.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
