import type { DocPageContent } from '../../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: 'Cola de renderizado',
  description:
    'Pon varias exportaciones en cola, divide un renderizado en segmentos, gestiona la cola y encuentra los archivos guardados.',
  category: 'Output',
  related: ['export'],
  sections: [
    {
      title: 'Poner exportaciones en cola',
      blocks: [
        {
          kind: 'list',
          items: [
            'Desde el cuadro de diálogo de Exportar, elige **Añadir a la cola** en lugar de renderizar de inmediato.',
            'Pon en cola todo el proyecto o el rango actual.',
            'Abre la cola cuando quieras con el botón **Cola de renderizado** de la barra de herramientas, que muestra el número de trabajos en directo.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Las exportaciones en cola se renderizan de una en una y se guardan en la carpeta de exportaciones de tu espacio de trabajo.',
        },
      ],
    },
    {
      title: 'Dividir en segmentos',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Dividir en segmentos** convierte un renderizado en varios trabajos.',
            'Usa **Un segmento por marcador** para cortar el renderizado en los marcadores de tu línea de tiempo.',
            'O divídelo en fragmentos fijos de un número determinado de segundos.',
          ],
        },
      ],
    },
    {
      title: 'Gestionar la cola',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Pausar** y **Reanudar** la cola para controlar cuándo se renderiza.',
            'Mueve un trabajo en cola hacia arriba o hacia abajo con **Subir** o **Bajar** para cambiar su orden.',
            '**Cancelar** un trabajo en curso o en cola, **Reintentar** uno fallido y **Quitar** los trabajos terminados.',
            'El estado de un trabajo es En cola, Renderizando, Hecho, Fallido o Cancelado; usa **Borrar finalizados** o **Borrar todo** para ordenar.',
          ],
        },
      ],
    },
    {
      title: 'Exportaciones guardadas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Cambia a la pestaña **Exportaciones guardadas** para ver los archivos terminados.',
            'Desde ahí puedes descargar o eliminar una exportación guardada.',
            'Los archivos están en la carpeta de este proyecto dentro de tu espacio de trabajo.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
