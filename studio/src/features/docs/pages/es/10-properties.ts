import type { DocPageContent } from '../../docs-content'

const page = {
  order: 10,
  slug: 'properties',
  title: 'Propiedades del clip',
  description:
    'Transformación, recorte, opacidad y fusión, y los controles específicos de cada tipo de clip.',
  category: 'Core Editing',
  related: ['audio', 'text-captions-subtitles', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Cómo la selección determina el panel',
      blocks: [
        {
          kind: 'list',
          items: [
            'Selecciona un clip para editar todo su conjunto de propiedades.',
            'Selecciona varios clips para cambiar a la vez una propiedad que compartan.',
            'El panel solo muestra las pestañas de los grupos de propiedades que se aplican a la selección actual.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Un valor **Mixto** significa que los clips seleccionados no comparten ahora mismo ese ajuste; al cambiarlo se aplica un único valor a todos.',
        },
      ],
    },
    {
      title: 'Controles compartidos por los clips visuales',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Transformación**: posición, tamaño, rotación y punto de anclaje.',
            '**Recorte**: recorta cada borde hacia dentro, con un control de suavidad para el borde del recorte.',
            '**Opacidad** y **Fusión**: atenúa un clip y elige cómo se compone sobre las capas inferiores.',
            '**Vídeo**: velocidad de reproducción y tiempos relacionados de los clips de vídeo.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Muchos controles numéricos se pueden animar: busca el interruptor de fotogramas clave junto al valor.',
        },
      ],
    },
    {
      title: 'Controles específicos de cada tipo',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo de clip', 'Controles'],
          rows: [
            [
              'Audio',
              'Ganancia, fundido de entrada/salida, tono y un ecualizador por clip (consulta Edición de audio).',
            ],
            [
              'Texto',
              'Contenido, fuente, tamaño, color, alineación, fondo, espaciado, efectos y animación (consulta la página de Texto).',
            ],
            ['Forma', 'Tipo de forma, trazado, relleno, contorno, máscara y difuminado.'],
            [
              'Subtítulo',
              'Tiempos y texto de cada línea, además de preajustes de estilo de subtítulos.',
            ],
            ['Color', 'Ruedas, curvas y herramientas de etalonaje (consulta Efectos y color).'],
          ],
        },
      ],
    },
    {
      title: 'Marcadores',
      blocks: [
        {
          kind: 'paragraph',
          text: 'El panel de propiedades enumera todos los marcadores del proyecto bajo el encabezado **Marcadores**, ordenados por tiempo. La lista siempre está disponible: aparece debajo de los ajustes del lienzo cuando no hay nada seleccionado, y debajo del editor de marcadores cuando hay un marcador seleccionado, así que puedes consultar tus marcadores y llegar a ellos sea cual sea la selección.',
        },
        {
          kind: 'list',
          items: [
            'Cada fila muestra el color del marcador, su etiqueta (o un nombre predeterminado si no tiene) y su código de tiempo.',
            'Selecciona una fila para convertirla en el marcador activo y llevar el cabezal de reproducción a ese punto.',
            'Usa el icono de papelera de una fila para quitar solo ese marcador.',
            '**Borrar todo** quita todos los marcadores de una vez.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Pulsa `M` para colocar un marcador en el cabezal de reproducción. Cuando la lista está vacía, muestra esta pista.',
        },
        {
          kind: 'paragraph',
          text: 'Al seleccionar un marcador se abre su editor encima de la lista, donde puedes cambiar la posición en **Fotograma**, editar la **Etiqueta** y elegir el **Color** con una muestra predefinida o restablecerlo al valor predeterminado. El campo **Tiempo** muestra el código de tiempo del marcador como solo lectura, y **Eliminar marcador** lo quita.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
