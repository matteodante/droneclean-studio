import type { DocPageContent } from '../../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: 'Referencia',
  description: 'Formatos admitidos y un glosario de los términos que se usan en esta guía.',
  category: 'Reference',
  related: ['concepts', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Formatos',
      blocks: [
        {
          kind: 'table',
          headers: ['Uso', 'Tipos'],
          rows: [
            ['Importación', 'Vídeo, audio, imagen, GIF, SVG, recursos generados, clips compuestos'],
            ['Exportación de vídeo', 'MP4, MOV, WebM, MKV'],
            ['Exportación de audio', 'MP3, AAC, WAV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La compatibilidad de códecs depende de lo que tu navegador pueda decodificar y codificar.',
        },
      ],
    },
    {
      title: 'Términos de edición',
      blocks: [
        {
          kind: 'table',
          headers: ['Término', 'Significado'],
          rows: [
            [
              'Rango de entrada/salida',
              'Un inicio y un final marcados que se usan para las ediciones de origen y los rangos de exportación.',
            ],
            [
              'Margen de origen',
              'Fotogramas de sobra más allá del borde de un clip, necesarios para recortes y transiciones.',
            ],
            [
              'Edición ripple',
              'Una edición que desplaza el material posterior para abrir o cerrar espacio en la línea de tiempo.',
            ],
            ['Edición rolling', 'Una edición que mueve el corte entre dos clips vecinos.'],
            [
              'Edición slip',
              'Cambia los fotogramas de origen dentro de un clip sin mover el clip.',
            ],
            ['Edición slide', 'Mueve un clip ajustando a la vez sus cortes vecinos.'],
          ],
        },
      ],
    },
    {
      title: 'Términos de funciones',
      blocks: [
        {
          kind: 'table',
          headers: ['Término', 'Significado'],
          rows: [
            ['Espacio de trabajo', 'La carpeta en la que DroneClean Studio lee y escribe.'],
            [
              'Proxy',
              'Una copia generada y más ligera de un medio pesado, que se usa para reproducir con más fluidez.',
            ],
            [
              'Clip compuesto',
              'Una sección de la línea de tiempo agrupada en un único elemento multimedia reutilizable.',
            ],
            [
              'Capa de ajuste',
              'Una capa cuyos efectos y etalonaje se aplican a los clips que quedan debajo.',
            ],
            [
              'Fotograma clave',
              'Un valor fijado en un instante concreto para animar una propiedad.',
            ],
            ['LUT', 'Una tabla de consulta (.cube) que aplica una transformación de color.'],
            [
              'Destino de parcheo',
              'La pista de la línea de tiempo a la que se envía una edición del monitor de origen.',
            ],
            [
              'Cola de renderizado',
              'Una lista ordenada de exportaciones que se renderizan de una en una.',
            ],
            [
              'Comprobación previa',
              'La comprobación de preparación que se ejecuta antes de que empiece una exportación.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
