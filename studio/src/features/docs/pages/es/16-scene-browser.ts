import type { DocPageContent } from '../../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: 'Explorador de escenas y análisis con IA',
  description:
    'Analiza los medios en local para describir las escenas y busca después por palabra clave, significado o color.',
  category: 'Creative Tools',
  related: ['media', 'local-ai', 'source-monitor'],
  sections: [
    {
      title: 'Analizar con IA',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ejecuta **Analizar con IA** sobre un clip desde la biblioteca de medios, o desde el menú **Analizar** del Explorador de escenas.',
            'El análisis se ejecuta por completo en tu equipo: detecta las escenas, describe cada una, extrae una paleta de colores y genera incrustaciones (embeddings) de texto y de imagen.',
            'Elige **Analizar medios nuevos** para los clips sin descripciones, o **Reanalizar todo** para actualizarlo todo.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Los resultados se guardan en caché según el contenido, así que los medios idénticos se reutilizan en lugar de analizarse otra vez.',
        },
      ],
    },
    {
      title: 'Abrir el Explorador de escenas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abre el Explorador de escenas desde la biblioteca de medios, o con `Ctrl+Shift+F`.',
            'Busca en las descripciones de IA y en los datos de escenas generados por Analizar con IA.',
            'Define el ámbito como todos los medios analizados o un solo clip, y ordena por **Relevancia**, **Marca de tiempo** o **Nombre del medio**.',
            'Alterna entre **Vista de lista** y **Vista de cuadrícula** según prefieras explorar o repasar.',
          ],
        },
      ],
    },
    {
      title: 'Modos de búsqueda',
      blocks: [
        {
          kind: 'table',
          headers: ['Modo', 'Coincide por'],
          rows: [
            [
              'Palabra clave',
              'Las palabras exactas de una descripción: ideal para un objeto o una etiqueta concretos.',
            ],
            [
              'Semántica',
              'El significado, de modo que «atardecer sobre el agua» encuentra escenas relacionadas (el primer uso descarga un modelo pequeño, de unos 22 MB).',
            ],
            ['Color', 'Una paleta parecida: elige una muestra de la paleta de la biblioteca.'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Los resultados llevan insignias de coincidencia (Alta, Buena o Aceptable) e indican si la coincidencia fue por palabra clave, por significado, por parecido visual o por color.',
        },
      ],
    },
    {
      title: 'Usar un resultado',
      blocks: [
        {
          kind: 'list',
          items: [
            'Haz clic en una escena para previsualizarla en el monitor de origen.',
            'Arrastra una escena a la línea de tiempo para añadir ese momento a tu edición.',
            'Si no se encuentra nada, comprueba que el clip se haya analizado: solo se pueden buscar los medios analizados.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
