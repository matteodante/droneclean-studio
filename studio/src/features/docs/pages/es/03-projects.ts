import type { DocPageContent } from '../../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Proyectos',
  description:
    'Crea, configura, duplica, organiza, envía a la papelera, restaura y mueve proyectos.',
  category: 'Start',
  related: ['workspaces', 'editor'],
  sections: [
    {
      title: 'Crear y configurar un proyecto',
      blocks: [
        {
          kind: 'list',
          items: [
            'Crea un proyecto desde la página de Proyectos con **Nuevo proyecto**.',
            'Define el nombre, la descripción, la resolución, la velocidad de fotogramas y el color de fondo del proyecto.',
            'La resolución y la velocidad de fotogramas definen el lienzo de exportación y los tiempos de la línea de tiempo, así que elígelas según el formato de entrega que busques.',
            'Puedes volver a las especificaciones del proyecto más tarde desde la barra de herramientas del editor.',
          ],
        },
      ],
    },
    {
      title: 'Tamaño del lienzo y relación de aspecto',
      blocks: [
        {
          kind: 'paragraph',
          text: 'El lienzo define el encuadre en el que se compone y se exporta tu vídeo. Elige un tamaño al crear el proyecto o cámbialo en cualquier momento desde el panel **Lienzo** mientras editas.',
        },
        {
          kind: 'paragraph',
          text: 'En **Nuevo proyecto**, la sección **Resolución** ofrece preajustes listos para las plataformas más habituales. Cada tarjeta de preajuste muestra su tamaño en píxeles y su relación de aspecto. Elige **Personalizada** para escribir un ancho y un alto exactos.',
        },
        {
          kind: 'table',
          headers: ['Preajuste', 'Resolución', 'Relación de aspecto'],
          rows: [
            ['YouTube 1080p', '`1920x1080`', '`16:9` horizontal'],
            ['Shorts / TikTok / Reels', '`1080x1920`', '`9:16` vertical'],
            ['Instagram cuadrado', '`1080x1080`', '`1:1` cuadrado'],
            ['Instagram vertical', '`1080x1350`', '`4:5` vertical'],
            ['Twitter/X', '`1200x675`', '`16:9` horizontal'],
            ['LinkedIn', '`1200x627`', 'horizontal'],
            ['Personalizada', 'Tus propios valores', 'Lo que introduzcas'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Para cambiar el tamaño cuando el proyecto ya existe:',
        },
        {
          kind: 'steps',
          items: [
            'Deselecciona cualquier clip para que la barra lateral de propiedades muestre el panel **Lienzo**.',
            'Edita los campos **W** y **H** para fijar el ancho y el alto del encuadre en píxeles.',
            'Usa **Intercambiar** para invertir ancho y alto, por ejemplo para convertir un proyecto horizontal en uno vertical.',
            'Usa **Restablecer** para devolver el lienzo a `1920x1080`.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Las dimensiones se ajustan a números pares y van desde `320x240` hasta `7680x4320`. Los clips existentes conservan su posición y escala actuales cuando cambia el lienzo, así que recoloca todo lo que haya quedado fuera del nuevo encuadre.',
        },
      ],
    },
    {
      title: 'Organizar la lista de proyectos',
      blocks: [
        {
          kind: 'list',
          items: [
            'Busca proyectos por nombre y ordena o filtra la lista a medida que crezca.',
            'Usa las miniaturas y los metadatos para reconocer el proyecto en el que trabajaste por última vez.',
            'El espacio de trabajo activo se muestra en la página de Proyectos, así que siempre sabes dónde se guardan.',
            'Usa **Duplicar** para crear una variante sin tocar el original.',
          ],
        },
      ],
    },
    {
      title: 'Papelera y restauración',
      blocks: [
        {
          kind: 'list',
          items: [
            'Al eliminar un proyecto, este va a la **Papelera** en lugar de borrarse al instante.',
            'Restaura un proyecto desde la sección de la Papelera mientras siga allí.',
            '**Vaciar papelera** elimina de forma permanente los proyectos de la papelera y los medios a los que solo ellos hacen referencia.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'La eliminación permanente no se puede deshacer, así que confirma el nombre antes de vaciar la papelera.',
        },
      ],
    },
    {
      title: 'Mover el trabajo entre espacios de trabajo',
      blocks: [
        {
          kind: 'list',
          items: [
            'Usa **Exportar proyecto** para crear un paquete que reúna el proyecto con sus medios.',
            'Importa un paquete en otro espacio de trabajo para seguir con la misma edición en otro equipo o en otra carpeta.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Los paquetes son la forma segura de entregar un proyecto a otra persona, porque llevan consigo los medios enlazados junto con la línea de tiempo.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
