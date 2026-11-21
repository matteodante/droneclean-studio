import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.5,
  slug: 'motion-library',
  title: 'Aplicar y reutilizar movimiento',
  description:
    'Aplica preajustes editables, añade comportamientos en vivo, ajusta el movimiento de texto y guarda animaciones para reutilizarlas.',
  category: 'Creative Tools',
  related: ['motion', 'keyframes', 'properties', 'text-captions-subtitles'],
  sections: [
    {
      title: 'Elegir la superficie de animación adecuada',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio usa un único sistema de animación en dos lugares. Usa la pestaña compacta **Animación** mientras editas un clip de una secuencia, o abre **Motion** para el trabajo de composición por capas.',
        },
        {
          kind: 'table',
          headers: ['Superficie', 'Para qué usarla'],
          rows: [
            [
              'Edición > Animación',
              'Preajustes habituales, estado de la animación aplicada, movimiento de texto, y crear o volver a abrir un clip de Motion',
            ],
            [
              'Motion > Biblioteca de movimiento',
              'El catálogo completo de preajustes, los comportamientos en vivo, las animaciones guardadas y los controles de la capa seleccionada',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Selecciona uno o varios clips de Edición y elige **Crear clip de Motion** para conservarlos dentro de una composición por capas. Selecciona un clip de Motion existente y elige **Abrir en Motion** para editar sus capas.',
        },
      ],
    },
    {
      title: 'Aplicar un preajuste editable',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Selecciona uno o varios clips o capas de Motion.',
            'Elige un preajuste en **Entrada**, **Salida** o **Énfasis**.',
            'Pon **Al aplicar** en **Reemplazar** para sustituir el movimiento por otro con la misma intención, o en **Añadir** para conservar los fotogramas clave existentes.',
            'Abre las filas de propiedades o el gráfico de valores para ajustar los fotogramas clave generados.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La sección **Aplicado** enumera por separado los fotogramas clave manuales y cada aplicación de preajuste. Selecciona una entrada para llevar el cabezal de reproducción a su primer fotograma clave.',
        },
      ],
    },
    {
      title: 'Añadir un comportamiento en vivo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Los comportamientos en vivo se evalúan durante la reproducción sin crear fotogramas clave. Déjalos en vivo para un movimiento ajustable, o hornéalos cuando necesites control a nivel de fotograma.',
        },
        {
          kind: 'table',
          headers: ['Comportamiento', 'Resultado'],
          rows: [
            ['Float drift', 'Desplaza la posición y la rotación'],
            ['Sway', 'Rota de un lado a otro'],
            ['Breath pulse', 'Cambia el tamaño y la opacidad'],
            ['Spin', 'Rota de forma continua'],
            ['Micro shake', 'Añade una vibración de posición y rotación con semilla fija'],
          ],
        },
        {
          kind: 'list',
          items: [
            'Selecciona la ficha de un comportamiento para aplicarlo con los ajustes predeterminados.',
            'Ajusta **Intensidad** y **Duración** desde sus controles aplicados.',
            'Fíjate en la banda rayada de la línea de tiempo de Motion para ver dónde se ejecuta el movimiento procedural.',
            'Aplica un comportamiento a varios clips para desfasar sus fases en lugar de mover todos los clips al unísono.',
          ],
        },
      ],
    },
    {
      title: 'Ajustar el movimiento de texto en la línea de tiempo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'El movimiento de texto anima caracteres, palabras, líneas o el clip completo a través de las ranuras en vivo **Entrada**, **Salida** y **Bucle**.',
        },
        {
          kind: 'list',
          items: [
            'Selecciona un clip de texto y elige un preajuste para cada ranura en la pestaña **Animación** o en la Biblioteca de movimiento.',
            'Arrastra el borde de una banda de movimiento de texto en Motion para cambiar su duración.',
            'Arrastra una banda de **Entrada** o **Salida** lejos del borde del clip para desplazar su inicio o su final.',
            'Selecciona su entrada en **Aplicado** para llevar el cabezal de reproducción a la banda.',
          ],
        },
      ],
    },
    {
      title: 'Revisar y limpiar la animación aplicada',
      blocks: [
        {
          kind: 'list',
          items: [
            'Usa **Aplicado** para distinguir los fotogramas clave manuales, los generados, los comportamientos en vivo y el movimiento de texto.',
            'Quita una aplicación de preajuste sin eliminar fotogramas clave que no tengan relación con ella.',
            'Quita un comportamiento en vivo o una ranura de movimiento de texto desde su propia fila.',
            'Cuando un recorte deja fotogramas clave fuera del clip, usa **Recortar animación** para eliminar solo esos fotogramas clave aparcados.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '**Recortar animación** modifica la animación guardada. Usa la acción del aviso o Deshacer si necesitas recuperar los fotogramas clave eliminados.',
        },
      ],
    },
    {
      title: 'Hornear, guardar y reutilizar el movimiento',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Elige **Hornear en fotogramas clave** para muestrear los comportamientos de capa en vivo y convertirlos en fotogramas clave de propiedad editables.',
            'Selecciona un clip con la animación que quieras conservar.',
            'Elige **Guardar animación**, escribe un nombre y guárdala en la biblioteca del proyecto.',
            'Aplica la animación guardada a otro clip o capa compatible.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Las animaciones guardadas pueden incluir fotogramas clave editables, comportamientos de capa en vivo, movimiento de texto o una combinación de ellos. Los proyectos exportados llevan consigo su biblioteca de animaciones guardadas.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
