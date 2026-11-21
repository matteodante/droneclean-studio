import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.75,
  slug: 'motion',
  title: 'Usar el espacio de trabajo Motion',
  description:
    'Crea, ajusta en el tiempo, anima, vincula con un padre y reutiliza composiciones 2D por capas en el espacio de trabajo Motion.',
  category: 'Creative Tools',
  related: ['motion-library', 'keyframes', 'shapes-masks', 'concepts'],
  sections: [
    {
      title: 'Abrir o crear una composición de Motion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Motion reúne en un solo espacio de trabajo la biblioteca de medios, la vista previa de la composición, la línea de tiempo de capas, las propiedades, los fotogramas clave, el gráfico y la Biblioteca de movimiento.',
        },
        {
          kind: 'steps',
          items: [
            'Elige **Motion** en el selector de espacios de trabajo, o pulsa `Alt+3`.',
            'Elige una composición existente en el menú de composiciones, o elige **Nueva comp.**.',
            'Para promover clips de una secuencia, selecciónalos en Edición, abre **Animación** y elige **Crear clip de Motion**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Al crear un clip de Motion se conservan los clips seleccionados y su animación dentro de la nueva composición. El nuevo contenedor sigue siendo un clip normal en Edición.',
        },
      ],
    },
    {
      title: 'Añadir capas a la composición',
      blocks: [
        {
          kind: 'list',
          items: [
            'Arrastra vídeo, audio, imágenes, texto, formas, archivos Lottie u otra composición desde la biblioteca de medios.',
            'Elige **Añadir elemento** para crear capas de **Texto**, **Color sólido**, **Degradado**, **Forma** u **Objeto nulo**.',
            'Color sólido y Degradado crean capas de forma a pantalla completa que puedes redimensionar, estilizar, enmascarar y animar.',
            'DroneClean Studio impide que una composición se contenga a sí misma, incluida la anidación circular indirecta.',
          ],
        },
      ],
    },
    {
      title: 'Definir la duración y el rango activo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'La duración definida es la que determina la composición. Los tiradores de Entrada y Salida de la regla definen el rango de renderizado activo dentro de esa duración.',
        },
        {
          kind: 'steps',
          items: [
            'Arrastra los tiradores de **Entrada** y **Salida** situados sobre la regla de Motion para marcar el rango activo.',
            'Elige **Recortar composición a la región activa** para acortar la composición definida a ese rango.',
            'Elige **zoom a ajustar** para encuadrar la composición definida sin cambiar su duración.',
            'Edita **Duración de comp.** en Propiedades y selecciona su unidad para alternar entre fotogramas y segundos.',
            'Consulta el valor de **Código de tiempo** correspondiente debajo del control de duración.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Al recortar, los controles de Entrada y Salida siguen disponibles y se ajustan al nuevo rango. Las capas que se extienden más allá de la duración definida siguen visibles en el saliente atenuado.',
        },
      ],
    },
    {
      title: 'Ordenar y ajustar en el tiempo las capas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Arrastra el tramo de una capa para moverla en el tiempo. Las capas seleccionadas se mueven juntas en un solo paso de deshacer.',
            'Edita los campos de **Entrada** y **Salida** de cada capa, o arrastra los bordes de su tramo para recortarla.',
            'Usa los controles de capa para cambiar la visibilidad, el bloqueo, el solo, el modo de fusión y el orden de apilamiento.',
            'Arrastra el tirador de tres puntos para reordenar una capa o un grupo. Las capas hijas permanecen dentro de su grupo actual.',
            'Selecciona dos o más capas y elige **Grupo de capas**. La visibilidad, el bloqueo, el solo, el tiempo y el reordenamiento del grupo se aplican a sus hijas.',
            'Haz clic con el botón derecho en una capa o un grupo para renombrarlo, agruparlo, desagruparlo, duplicarlo, copiarlo, pegarlo o eliminarlo.',
          ],
        },
      ],
    },
    {
      title: 'Animar propiedades y vértices de trazado',
      blocks: [
        {
          kind: 'list',
          items: [
            'Expande una capa para ver los grupos de propiedades anidados, los controles de valor, el auto-key, la navegación y los rombos de fotogramas clave.',
            'Pon el filtro de propiedades en **Propiedades animadas** cuando solo necesites las filas que contienen fotogramas clave.',
            'Selecciona el rombo de una propiedad para añadir o quitar un fotograma clave en el cabezal de reproducción compartido.',
            'Selecciona dos fotogramas clave vecinos para editar el suavizado de su segmento.',
            'Selecciona el icono de curva de una propiedad para sustituir su carril de la hoja de dopaje por un gráfico de valores integrado.',
            'Abre el menú del grupo Posición y elige **Separar dimensiones de posición** para editar X e Y por separado.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Las formas de trazado exponen carriles de vértices en Motion. Selecciona puntos del trazado en la vista previa y después alterna entre **Vértices seleccionados** y **Todos los vértices** sobre las filas de propiedades.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Cuando Path Geometry tiene fotogramas clave, no puedes añadir, quitar, reordenar ni cambiar el primer vértice del trazado. Quita esos fotogramas clave antes de cambiar la topología del trazado.',
        },
      ],
    },
    {
      title: 'Vincular capas con un padre mediante un objeto nulo',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Elige **Añadir elemento > Objeto nulo**. Un objeto nulo controla transformaciones, pero no se renderiza.',
            'Elige un padre en el menú **Padre**, o arrastra el pick whip de Padre sobre otra capa.',
            'Suelta con normalidad para conservar la pose de la capa hija en el lienzo.',
            'Mantén pulsado **Shift** al soltar para ajustar la posición de la hija a la del padre.',
            'Mantén pulsado **Alt/Option** al soltar para usar la pose local definida de la hija.',
            'Haz clic con Ctrl o con Comando en el pick whip de la hija para desvincularla conservando su pose actual.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Los destinos de padre válidos se resaltan mientras arrastras. Motion rechaza que una capa sea su propio padre, que lo sea un descendiente y los vínculos que crearían un ciclo.',
        },
      ],
    },
    {
      title: 'Vincular propiedades o escribir una expresión',
      blocks: [
        {
          kind: 'paragraph',
          text: 'El parentesco crea una jerarquía de capas. Un **Vínculo de propiedad** hace que una propiedad siga a otra sin cambiar esa jerarquía.',
        },
        {
          kind: 'list',
          items: [
            'Arrastra el pick whip de una propiedad hasta una fila compatible en Motion, en la hoja de dopaje o en el gráfico.',
            'Vincula valores escalares con valores escalares. Posición, Escala y Anclaje se vinculan como valores bidimensionales completos.',
            'Selecciona el botón de llaves para añadir una expresión aislada (sandbox) sin eliminar los fotogramas clave de la propiedad.',
            'Usa el pick whip de la expresión para insertar una referencia `prop("layer-id", "property")` en el cursor del texto.',
            'Usa `value`, `preValue`, `frame`, `time`, valores escalares o `[x, y]`, aritmética y las funciones matemáticas admitidas.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio evalúa primero los fotogramas clave, después el Vínculo de propiedad y por último la expresión. La vista previa y la exportación usan el mismo orden.',
        },
      ],
    },
    {
      title: 'Exponer controles para composiciones reutilizadas',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abre **Controles publicados** dentro de la composición de origen.',
            'Publica el texto o los colores que un editor deba poder cambiar en las instancias colocadas.',
            'Coloca la composición en una secuencia normal y selecciona esa instancia.',
            'Edita sus valores publicados en Propiedades sin cambiar la composición de origen.',
            'Restablece una anulación o usa **Restablecer todas las anulaciones** para recuperar los valores de origen.',
          ],
        },
      ],
    },
    {
      title: 'Usar la composición en Edición',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Una composición de Motion sigue siendo un recurso de composición reutilizable. Colócala en una secuencia y después mueve, recorta, anima o aplica efectos a la instancia como a cualquier otro clip.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La animación interna de las capas y la animación del clip completo son independientes. Un título puede animarse internamente mientras su instancia colocada se mueve o se desvanece en Edición.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
