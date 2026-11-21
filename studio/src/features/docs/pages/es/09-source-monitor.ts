import type { DocPageContent } from '../../docs-content'

const page = {
  order: 9,
  slug: 'source-monitor',
  title: 'Flujo de trabajo del monitor de origen',
  description:
    'Previsualiza un origen, marca un rango de entrada/salida, elige los destinos de parcheo e inserta o sobrescribe en la línea de tiempo.',
  category: 'Core Editing',
  related: ['media', 'timeline', 'scene-browser'],
  sections: [
    {
      title: 'Abrir un origen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Haz doble clic en una tarjeta de medio, o usa **Abrir en el monitor de origen** desde Información del medio, para cargar un origen.',
            'La cabecera del monitor muestra el nombre del archivo de origen, con un control de cierre para salir.',
            'La reproducción del origen es independiente de la vista previa de la línea de tiempo, así que puedes recorrer un origen sin mover el cabezal de reproducción de la línea de tiempo.',
            'Haz clic en el indicador del código de tiempo para alternar entre la visualización en código de tiempo y en número de fotograma.',
          ],
        },
      ],
    },
    {
      title: 'Marcar un rango de entrada/salida',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Ve al primer fotograma que quieras y pulsa `I` (**Marcar punto de entrada**).',
            'Ve al fotograma posterior al último que quieras y pulsa `O` (**Marcar punto de salida**); el punto de salida es exclusivo.',
            'Afina arrastrando el tirador de entrada, el de salida o todo el rango en la tira.',
            'Usa **Reproducir de entrada a salida** para revisar solo el rango, o `Alt+X` para borrarlo y usar el origen completo.',
          ],
        },
      ],
    },
    {
      title: 'Elegir los destinos de parcheo',
      blocks: [
        {
          kind: 'list',
          items: [
            'El interruptor **V** activa o desactiva el destino de parcheo de vídeo del origen; el interruptor **A** hace lo mismo con el audio.',
            'Cada interruptor tiene un selector de destino: **Auto**, una pista concreta por nombre, o **Crear al editar** para crear una pista nueva.',
            'El vídeo con sonido coloca una pareja de vídeo y audio vinculados en las pistas de destino V y A.',
            'La pista activa de la línea de tiempo rellena de antemano los destinos V y A correspondientes.',
          ],
        },
      ],
    },
    {
      title: 'Insertar y sobrescribir',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Ambas ediciones colocan el rango marcado en el fotograma actual del cabezal de reproducción de la línea de tiempo y después avanzan el cabezal hasta el final del clip nuevo.',
        },
        {
          kind: 'table',
          headers: ['Edición', 'Tecla', 'Qué hace'],
          rows: [
            [
              'Insertar',
              '`,`',
              'Coloca el rango y empuja hacia la derecha todo el material posterior de las pistas de destino.',
            ],
            [
              'Sobrescribir',
              '`.`',
              'Reemplaza el material de la línea de tiempo que quede bajo el rango y deja en su sitio los clips de alrededor.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Las imágenes se colocan por defecto como un clip de **tres segundos**, salvo que marques un rango más corto.',
        },
      ],
    },
    {
      title: 'Si una edición no se aplica',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Activa antes al menos uno de los destinos de parcheo **V** o **A**. Para editar audio, activa **A**; para editar un vídeo sin sonido o una imagen, activa **V**. Una pista de destino bloqueada también impide la edición: desbloquéala e inténtalo de nuevo.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
