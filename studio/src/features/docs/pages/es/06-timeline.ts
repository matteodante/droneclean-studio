import type { DocPageContent } from '../../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Edición básica de la línea de tiempo',
  description:
    'Pistas, añadir clips, selección, dividir y unir, eliminar, ajuste magnético, marcadores, rangos, secuencias y zoom.',
  category: 'Core Editing',
  related: ['editing-tools', 'preview', 'media', 'export', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Pistas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Las **pistas de vídeo** contienen elementos visuales: vídeo, imágenes, texto, formas, subtítulos y capas de ajuste.',
            'Las **pistas de audio** contienen clips de audio y el audio vinculado a los archivos de vídeo.',
            'Añade pistas con **Agregar Video Pista** o **Agregar Audio Pista** cuando necesites más espacio.',
            'Los controles de pista incluyen **Bloquear**, **Solo**, **Activar/Desactivar** (visibilidad) y el bloqueo de sincronización.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Los grupos de pistas tienen un solo nivel de profundidad y actúan como cabeceras: el silencio, la visibilidad y el bloqueo pasan de un grupo a sus pistas.',
        },
      ],
    },
    {
      title: 'Añadir y ordenar clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Arrastra un clip desde el panel de Medios a una pista de vídeo o de audio.',
            'Usa la herramienta de **Selección** (`V`) para mover y reordenar clips.',
            'La **selección vinculada** mantiene unidos, al moverlos, un clip de vídeo y su audio; desvincúlalos para editar uno solo.',
            'Desplaza con precisión un elemento seleccionado con `Shift+Arrow` (1 px) o `Ctrl+Shift+Arrow` (10 px).',
          ],
        },
      ],
    },
    {
      title: 'Dividir, unir y eliminar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Divide en el cabezal de reproducción con `Alt+C`, o usa la herramienta **Cuchilla** (`C`) para cortar donde hagas clic.',
            'Une secciones adyacentes del mismo clip con `Shift+J`.',
            '**Eliminar** deja un hueco; **Ripple Eliminar** (`Ctrl+Delete`) quita el clip y cierra el hueco.',
            'Usa **Cerrar todo espacios** para juntar los clips y quitar el espacio vacío de una pista.',
          ],
        },
      ],
    },
    {
      title: 'Ajuste magnético, marcadores y rangos',
      blocks: [
        {
          kind: 'list',
          items: [
            'Activa o desactiva el ajuste magnético con `S` para que los clips se acoplen a los cortes cercanos, a los marcadores y al cabezal de reproducción.',
            'Añade un marcador con `M` para notas y referencias de tiempo; salta entre marcadores con `[` y `]`.',
            'Define un punto de entrada (`I`) y un punto de salida (`O`) para fijar un rango de vista previa y exportación; bórralos con `Alt+X`.',
          ],
        },
      ],
    },
    {
      title: 'Secuencias (varias líneas de tiempo)',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Una **secuencia** es una línea de tiempo autónoma con sus propias pistas, clips, marcadores y rango de entrada/salida. La barra de pestañas situada sobre la línea de tiempo muestra la línea de tiempo **Principal** y todas las secuencias: haz clic en una pestaña para cambiar la que estás editando.',
        },
        {
          kind: 'list',
          items: [
            'Crea una secuencia con el botón **+** al final de la barra de pestañas; se abre en su propia pestaña.',
            'Cambia de secuencia haciendo clic en una pestaña; la pestaña **Principal** siempre es la primera.',
            'Haz doble clic en una pestaña para **renombrarla**, o usa el menú de opciones de la pestaña (⋮) para **Renombrar**, **Cerrar pestaña** y **Eliminar secuencia**.',
            '**Cerrar pestaña** solo quita la pestaña: la secuencia sigue disponible en el panel de Medios y en los clips que la referencian. **Eliminar secuencia** la elimina por completo (se puede deshacer), junto con los clips que la referencian.',
            'Un **clip compuesto** se puede abrir como pestaña de secuencia: en el panel de Medios, haz clic con el botón derecho en un clip compuesto y elige **Abrir como pestaña** para editarlo como una línea de tiempo independiente.',
            'Suelta una secuencia en la línea de tiempo para anidarla como clip (con la etiqueta **Secuencia**); haz doble clic en ese clip para saltar a su pestaña.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Cada secuencia conserva sus propios marcadores, su rango de entrada/salida, su vista y su historial de deshacer: cambiar de pestaña nunca los mezcla.',
        },
      ],
    },
    {
      title: 'Zoom y deshacer',
      blocks: [
        {
          kind: 'list',
          items: [
            'Haz zoom con `Ctrl+=` y `Ctrl+-`, ajusta toda la edición a la vista con `\\` y vuelve al 100 % con `Shift+\\`.',
            'El zoom solo cambia la vista, nunca los tiempos de los clips.',
            'Deshaz con `Ctrl+Z` y rehaz con `Ctrl+Shift+Z`; la profundidad del historial de deshacer se configura en Configuración.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
