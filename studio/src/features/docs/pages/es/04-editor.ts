import type { DocPageContent } from '../../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Diseño del editor y navegación',
  description:
    'La barra de herramientas, la barra lateral de medios, el monitor de vista previa, la línea de tiempo, las propiedades y los espacios de trabajo Edición, Color y Motion.',
  category: 'Start',
  related: ['concepts', 'timeline', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Las superficies principales',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Barra de herramientas del editor** (arriba): volver a Proyectos, pestañas de espacios de trabajo, especificaciones del proyecto, idioma, Configuración, Atajos de teclado, Guardar, Exportar y la Cola de renderizado.',
            '**Barra lateral de medios** (izquierda): tus recursos y las herramientas de creación.',
            '**Monitor de vista previa**: el fotograma actual con superposiciones, máscaras, scopes y controles de reproducción.',
            '**Línea de tiempo** (abajo): pistas, clips, marcadores y herramientas de edición.',
            'Panel de **Propiedades**: edita el clip o los clips que tengas seleccionados.',
          ],
        },
      ],
    },
    {
      title: 'Las pestañas de la barra lateral de medios',
      blocks: [
        {
          kind: 'table',
          headers: ['Pestaña', 'Contenido'],
          rows: [
            [
              'Medios',
              'Recursos importados, información de los medios, proxies, transcripciones, subtítulos, clips compuestos, controles de medios faltantes',
            ],
            ['Texto', 'Clips de texto a partir de plantillas de un solo fragmento y de varios'],
            ['Formas', 'Elementos de formas generadas'],
            ['Efectos', 'Efectos de GPU para el clip seleccionado'],
            ['Transiciones', 'Transiciones para arrastrar a los cortes'],
            ['IA', 'Texto a voz y generación de música en local'],
          ],
        },
      ],
    },
    {
      title: 'Espacios de trabajo',
      blocks: [
        {
          kind: 'list',
          items: [
            'El espacio de trabajo **Edición** (`Alt+1`) es la disposición de corte predeterminada para ordenar, recortar, texto, formas, efectos, transiciones y vista previa.',
            'El espacio de trabajo **Color** (`Alt+2`) se centra en el etalonaje, con ruedas de color, curvas y scopes para el clip seleccionado.',
            'El espacio de trabajo **Motion** combina composiciones por capas, fotogramas clave, gráficos, preajustes y animación procedural; consulta [Espacio de trabajo Motion](motion).',
            'Selecciona un clip visual en Edición y abre **Animación** en Propiedades para ver los preajustes habituales, el estado de la animación aplicada, el movimiento de texto y **Crear clip de Motion**.',
            'Cambia de espacio de trabajo desde las pestañas centrales de la barra de herramientas o con `Alt+1`, `Alt+2` y `Alt+3`.',
          ],
        },
      ],
    },
    {
      title: 'Obtener ayuda y trabajar con seguridad',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abre **Configuración** para las preferencias generales, de línea de tiempo, de IA y de almacenamiento.',
            'Abre **Atajos de teclado** para buscar comandos, reasignar teclas e importar o exportar preajustes.',
            'Guarda a menudo con `Ctrl+S`; el guardado automático también puede ejecutarse en un intervalo que defines en Configuración.',
            'Deshacer y Rehacer (`Ctrl+Z` y `Ctrl+Shift+Z`) cubren las ediciones de la línea de tiempo cuando algo sale mal.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
