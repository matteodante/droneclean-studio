import type { DocPageContent } from '../../docs-content'

// order 1.5 places this right after Getting Started in the Start group.
const page = {
  order: 1.5,
  slug: 'concepts',
  title: 'Cómo funciona DroneClean Studio',
  description:
    'El modelo mental: almacenamiento local-first, proyectos y medios enlazados, fotogramas y código de tiempo, y el flujo de trabajo de la GPU.',
  category: 'Start',
  related: ['workspaces', 'getting-started', 'editing-tools'],
  sections: [
    {
      title: 'Local-first, por diseño',
      blocks: [
        {
          kind: 'list',
          items: [
            'DroneClean Studio se ejecuta en tu navegador y lo guarda todo en una **carpeta de espacio de trabajo** de tu disco.',
            'Tu vídeo y tu audio originales están **enlazados**, no copiados ni subidos: DroneClean Studio apunta a los archivos allí donde ya están.',
            'Los proyectos, las cachés, los recursos generados y las exportaciones se escriben en el espacio de trabajo, así que puedes hacerle copias de seguridad o moverlo como cualquier carpeta.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Como los medios están enlazados, mover o renombrar un archivo de origen aparece como **Medios faltantes** hasta que lo vuelvas a enlazar. Consulta [Espacios de trabajo y almacenamiento](workspaces).',
        },
      ],
    },
    {
      title: 'Proyectos, pistas y clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Un **proyecto** contiene una línea de tiempo, sus ajustes (resolución y velocidad de fotogramas) y referencias a los medios que usas.',
            'La línea de tiempo apila **pistas**; las pistas superiores se renderizan por encima de las inferiores.',
            'Un **clip** de la línea de tiempo es una ventana a un archivo de origen: recortar un clip cambia qué parte del origen se reproduce, no altera el archivo.',
            'Una **capa de ajuste** es un clip que no lleva medios propios: aplica sus efectos y su color a todos los clips que quedan debajo.',
          ],
        },
      ],
    },
    {
      title: 'Secuencias y clips compuestos',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio tiene una única primitiva para **una línea de tiempo dentro de tu proyecto**: una composición. Se presenta de dos maneras según cómo la uses.',
        },
        {
          kind: 'list',
          items: [
            'Una **Composición de Motion** se abre en **Motion**, donde el editor compartido mantiene en su sitio tus medios, la vista previa y las propiedades mientras el panel inferior se convierte en una línea de tiempo de capas.',
            'Una **secuencia** es una línea de tiempo independiente dentro del mismo proyecto, que se abre desde una pestaña de la barra de pestañas. Cada secuencia tiene sus propias pistas, clips e historial de edición; la propia línea de tiempo principal es una secuencia.',
            'Un **clip compuesto** toma una sección de la línea de tiempo y la pliega en un único elemento multimedia reutilizable. En la línea de tiempo se comporta como un solo clip (moverlo, recortarlo, añadirle efectos), mientras su contenido vive en su propia línea de tiempo.',
            'Ambos son lo mismo visto de otra manera: abre un clip compuesto para editar su contenido como una secuencia, y cualquier secuencia se puede soltar en otra línea de tiempo como clip compuesto.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Una composición puede contener otras composiciones, pero nunca a sí misma: DroneClean Studio bloquea las referencias circulares, así que un clip compuesto nunca puede acabar anidado dentro de su propio contenido.',
        },
      ],
    },
    {
      title: 'Fotogramas y código de tiempo',
      blocks: [
        {
          kind: 'list',
          items: [
            'El tiempo se mide en **fotogramas**. Un clip tiene un fotograma de inicio y una longitud en fotogramas a la velocidad de fotogramas del proyecto.',
            'La vista previa muestra el **código de tiempo**; en algunas vistas, haz clic en el indicador para cambiar a números de fotograma.',
            'Los medios de origen pueden tener una velocidad de fotogramas distinta de la del proyecto, así que DroneClean Studio convierte los fotogramas de origen en fotogramas del proyecto cuando editas.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Define la resolución y la velocidad de fotogramas del proyecto según tu formato de entrega al crear el proyecto.',
        },
      ],
    },
    {
      title: 'Todo se renderiza en tu equipo',
      blocks: [
        {
          kind: 'list',
          items: [
            'La reproducción, los efectos, el color y las herramientas de IA se ejecutan en local con tu GPU (WebGPU) y tu CPU (WebCodecs).',
            'Los **proxies** son copias más ligeras de los medios pesados que hacen fluida la edición; la exportación final siempre usa los originales.',
            'Como no hay renderizado en la nube, importa mantener abierta la pestaña durante la exportación: el renderizado ocurre justo en el navegador.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
