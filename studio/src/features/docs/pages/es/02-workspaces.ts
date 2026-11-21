import type { DocPageContent } from '../../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Espacios de trabajo y almacenamiento',
  description:
    'Cómo funciona la carpeta del espacio de trabajo, dónde se guardan los archivos, los permisos y el mantenimiento de las cachés.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: 'El modelo de espacio de trabajo',
      blocks: [
        {
          kind: 'list',
          items: [
            'Un **espacio de trabajo** es una única carpeta del disco en la que DroneClean Studio lee y escribe.',
            'Todo lo que genera DroneClean Studio vive ahí: archivos de proyecto, metadatos de los medios, miniaturas, formas de onda, transcripciones, datos de escenas, recursos de IA, cachés y exportaciones.',
            'Los medios de origen que importas no se copian al espacio de trabajo: DroneClean Studio guarda un enlace a cada archivo allí donde ya está en el disco.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Como el espacio de trabajo es una carpeta real, puedes hacerle copias de seguridad, sincronizarla o moverla como cualquier otro directorio.',
        },
      ],
    },
    {
      title: 'Elegir y cambiar de espacio de trabajo',
      blocks: [
        {
          kind: 'list',
          items: [
            'En el primer arranque, DroneClean Studio te pide que elijas un espacio de trabajo antes de abrir el editor.',
            'Elige una carpeta normal que sea tuya, por ejemplo una carpeta dentro de Documentos. Evita las ubicaciones protegidas del sistema.',
            'Usa el control **Espacios de trabajo** para añadir, cambiar o quitar espacios de trabajo conocidos.',
            'Cambiar de espacio modifica la carpeta que usa DroneClean Studio; no mueve tus medios de origen.',
          ],
        },
      ],
    },
    {
      title: 'Permisos y reconexión',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Por seguridad, los navegadores pueden hacer caducar el permiso sobre una carpeta entre sesiones.',
        },
        {
          kind: 'list',
          items: [
            'Cuando DroneClean Studio muestre **Vuelve a conectar tu espacio de trabajo**, elige **Reconectar** y concede acceso de lectura y escritura a la misma carpeta.',
            'Si se deniega el acceso, vuelve a elegir la carpeta y permite el acceso cuando el navegador te lo pida.',
            'Si la carpeta se ha movido, renombrado o eliminado, elige otra carpeta en su lugar.',
          ],
        },
      ],
    },
    {
      title: 'Medios faltantes',
      blocks: [
        {
          kind: 'list',
          items: [
            'Medios faltantes significa que DroneClean Studio no puede leer en este momento uno o varios de los archivos de origen enlazados.',
            'Usa **Conceder acceso** cuando un archivo solo necesita que renueves el permiso del navegador.',
            'Usa **Localizar** o **Localizar carpeta** cuando se haya movido un archivo o su carpeta.',
            'Usa **Buscar en otra carpeta** para indicar a DroneClean Studio una copia nueva de los medios.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Usa **Trabajar sin conexión** solo si piensas volver a enlazar los archivos más tarde; hasta entonces, los clips quedan como referencias rotas.',
        },
      ],
    },
    {
      title: 'Mover proyectos y vaciar cachés',
      blocks: [
        {
          kind: 'list',
          items: [
            'Usa **Exportar proyecto** para empaquetar un proyecto y sus medios en un paquete portátil que otro espacio de trabajo pueda importar.',
            'Las acciones de caché del proyecto borran datos regenerables, como formas de onda, tiras de fotogramas, fotogramas de GIF y audio decodificado.',
            'Los ajustes de almacenamiento también permiten regenerar miniaturas, generar los proxies que faltan y eliminar proxies.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Vaciar las cachés nunca borra tus medios de origen; DroneClean Studio regenera las vistas previas cuando el proyecto las necesita.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
