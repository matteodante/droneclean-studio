import type { DocPageContent } from '../../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: 'Exportación',
  description:
    'Renderiza vídeo o audio en el navegador, elige formatos y rango, y resuelve las advertencias de la comprobación previa.',
  category: 'Output',
  related: ['render-queue', 'text-captions-subtitles', 'troubleshooting'],
  sections: [
    {
      title: 'Preparar una exportación',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abre **Exportar** (`Ctrl+Shift+E`) y elige **Exportar vídeo** o **Exportar audio**.',
            'Renderiza todo el proyecto, o el rango de entrada/salida actual cuando solo necesites una sección.',
            'Define **Resolución** y **Calidad** según el objetivo: una revisión rápida, un archivo para compartir o un máster final.',
            'Resuelve las advertencias de la comprobación previa y después renderiza.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Una resolución y una calidad más altas tardan más y generan archivos más grandes.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Cuando un proyecto tiene más que la línea de tiempo Principal, un menú **Secuencia** en la parte superior del cuadro de diálogo permite elegir qué línea de tiempo exportar, con su propia resolución y rango.',
        },
      ],
    },
    {
      title: 'Formatos',
      blocks: [
        {
          kind: 'table',
          headers: ['Salida', 'Formatos'],
          rows: [
            ['Contenedores de vídeo', 'MP4, MOV, WebM, MKV'],
            ['Solo audio', 'MP3, AAC, WAV'],
            ['Pista de subtítulos activable', 'WebM, MKV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Los códecs disponibles dependen de tu navegador; DroneClean Studio te avisa o recurre a una alternativa cuando alguno no lo está.',
        },
      ],
    },
    {
      title: 'Subtítulos',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Cuando una exportación de vídeo tiene una transcripción, el control **Subtítulos** elige cómo se incluyen los subtítulos. Las opciones se adaptan al contenedor que hayas elegido.',
        },
        {
          kind: 'table',
          headers: ['Modo', 'Qué hace'],
          rows: [
            ['**Desactivado**', 'Sin subtítulos en el vídeo exportado.'],
            [
              '**Incrustar**',
              'Los subtítulos se dibujan en el fotograma, así que se ven en cualquier reproductor.',
            ],
            [
              '**Archivo** `.srt`',
              'Vídeo limpio más un archivo de subtítulos `.srt` aparte que se descarga junto a él.',
            ],
            [
              '**Pista incrustada**',
              'Una pista de subtítulos activable que va dentro del contenedor.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La opción de pista incrustada solo aparece con `WebM` y `MKV`. Con `MP4` y `MOV`, elige incrustar los subtítulos o un archivo aparte, o cambia de contenedor para tener una pista activable.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Algunos reproductores ocultan por defecto las pistas de subtítulos, así que es posible que el espectador tenga que activarlas.',
        },
      ],
    },
    {
      title: 'Comprobaciones previas',
      blocks: [
        {
          kind: 'paragraph',
          text: 'La comprobación previa se ejecuta antes de renderizar y señala los bloqueos más habituales: un rango vacío, medios faltantes, un códec no disponible, una exportación alternativa sin worker, un archivo grande o un renderizado largo.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Para una comprobación rápida, exporta primero un rango corto de entrada/salida antes de lanzarte con el renderizado completo.',
        },
      ],
    },
    {
      title: 'Renderizar y descargar',
      blocks: [
        {
          kind: 'list',
          items: [
            'El progreso pasa por preparación, renderizado, codificación y finalización, y puedes **Cancelar** en cualquier momento.',
            'La exportación con worker se ejecuta en segundo plano cuando está disponible; la alternativa en el hilo principal necesita que la pestaña esté en primer plano y sin actividad.',
            'Cuando termina, elige **Descargar** para guardar el archivo, que además se escribe en la carpeta de exportaciones de tu espacio de trabajo.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Mantén abierta la pestaña del proyecto hasta que termine la exportación. Para encadenar varios renderizados, añádelos a la **Cola de renderizado** en lugar de exportar de uno en uno.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
