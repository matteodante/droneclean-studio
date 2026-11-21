import type { DocPageContent } from '../../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Biblioteca de medios',
  description:
    'Importa medios, inspecciona archivos y genera proxies, transcripciones, subtítulos y datos de escenas con IA.',
  category: 'Core Editing',
  related: ['source-monitor', 'timeline', 'scene-browser', 'export'],
  sections: [
    {
      title: 'Importar medios',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abre la pestaña **Medios** y usa **Importar** para elegir archivos, o arrástralos directamente a la biblioteca.',
            'DroneClean Studio admite vídeo, audio, imágenes, GIF, SVG, animaciones Lottie (`.json` y `.lottie`) y recursos generados. Los GIF se importan como elementos de imagen.',
            'Usa **Importar multimedia desde URL** para un enlace directo a un archivo multimedia: la URL debe apuntar al propio archivo, no a una página que lo incruste.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Las grabaciones Apple ProRes se importan, se previsualizan y generan miniaturas como cualquier otro clip, incluso en formatos que los navegadores no saben decodificar por sí solos. Al exportar, los clips ProRes se recodifican al códec de salida que elijas; no existe un formato de salida ProRes.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Todavía no se puede importar una carpeta: suelta directamente los archivos multimedia. Lo que se puede decodificar depende de tu navegador; si un archivo no se importa, prueba con otro formato o transcodifícalo antes.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Las grabaciones en log (S-Log3 y similares) se ven planas y apagadas por diseño: así es como se capturan. Añade una LUT o un etalonaje para recuperarlas; el archivo no tiene ningún problema.',
        },
      ],
    },
    {
      title: 'Inspeccionar un clip',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abre **Información del medio** para ver el códec, las dimensiones, la duración, la velocidad de fotogramas, el tamaño del archivo, el tipo y el estado de la transcripción.',
            'Haz doble clic en una tarjeta de medio, o usa **Abrir en el monitor de origen**, para previsualizar un origen antes de montarlo.',
            'Las tarjetas de medios ofrecen menús para Archivo, Proxy, Transcripción, Subtítulos incrustados y acciones de IA.',
            'Ordena, filtra y agrupa los recursos por tipo cuando la biblioteca crezca.',
          ],
        },
      ],
    },
    {
      title: 'Generar datos de apoyo',
      blocks: [
        {
          kind: 'table',
          headers: ['Acción', 'Qué te da'],
          rows: [
            [
              'Generar proxy',
              'Una versión más ligera de un vídeo pesado para editar con más fluidez; la exportación sigue usando el original.',
            ],
            [
              'Generar transcripción',
              'Texto de voz editable en el que puedes buscar y que puedes convertir en subtítulos.',
            ],
            [
              'Extraer subtítulos incrustados',
              'Pistas de subtítulos extraídas del archivo, listas para insertarlas en la línea de tiempo.',
            ],
            [
              'Analizar con IA',
              'Detección de escenas y descripción en local para que los clips se puedan buscar en el Explorador de escenas.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Clips compuestos',
      blocks: [
        {
          kind: 'list',
          items: [
            'Agrupa una sección de la línea de tiempo en un **clip compuesto** que se comporta como un único elemento multimedia reutilizable.',
            'Los clips compuestos aparecen en la biblioteca de medios y se pueden volver a colocar como cualquier otro recurso.',
            'Haz clic con el botón derecho en un clip compuesto y elige **Abrir como pestaña** para editarlo como una **secuencia** independiente.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Los clips compuestos se pueden anidar (uno puede contener a otro) siempre que la cadena nunca vuelva sobre sí misma.',
        },
      ],
    },
    {
      title: 'Animaciones Lottie',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Importa archivos Lottie, ya sean `.json` sin procesar o archivos `.lottie` empaquetados, como elementos de la línea de tiempo que se renderizan con exactitud de fotograma en la vista previa y en la exportación. Selecciona un clip Lottie para ver sus controles de edición en la sección **Lottie** del panel de propiedades.',
        },
        {
          kind: 'list',
          items: [
            'Controla la reproducción con **Velocidad**, **Invertir**, **Bucle** y **Ping-pong**.',
            'Define un segmento con **Fotograma inicial** / **Fotograma final** para reproducir solo una parte de la animación, o elige un **Marcador** con nombre para llevar el segmento hasta él.',
            'Recolorea la animación: los **Colores** con nombre del autor aparecen primero, y el resto de las formas quedan recogidas en un desplegable; un color compartido edita todas las formas que lo usaban, y **Restablecer todo** recupera los originales.',
            'Edita directamente las capas de **Texto** de la plantilla y ajusta los espacios de valores escalares y vectoriales expuestos en **Propiedades**.',
            'En los archivos `.lottie` que incluyen más de una animación, cambia entre ellas con el selector **Animación**; cambia de paleta con el selector **Tema** cuando el archivo incluya temas.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Los cambios de color, texto, espacios y segmento se previsualizan en directo en el lienzo mientras arrastras o escribes, y se confirman como un único paso de deshacer. La edición de animación, tema, marcador, segmento y plantilla se aplica a un solo clip Lottie seleccionado cada vez.',
        },
      ],
    },
    {
      title: 'Solucionar medios faltantes',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Medios faltantes aparece cuando un archivo enlazado se ha movido, renombrado o eliminado, o necesita que renueves el permiso. Usa **Conceder acceso**, **Localizar**, **Localizar carpeta** o **Buscar en otra carpeta** para restablecer el enlace. Usa **Trabajar sin conexión** solo si piensas volver a enlazar más tarde.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
