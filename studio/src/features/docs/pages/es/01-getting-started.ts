import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Primeros pasos',
  description:
    'Qué es DroneClean Studio, qué necesita tu navegador y tu primera edición, desde el arranque hasta la exportación.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'Qué es DroneClean Studio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio es un editor de vídeo **local-first** que se ejecuta por completo en tu navegador: no hay cuenta, ni subidas, ni renderizado en un servidor. La edición, los efectos, el color, las herramientas de IA y la exportación funcionan en tu propio equipo, con tu GPU y tu CPU.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Tus archivos multimedia se quedan en tu dispositivo. DroneClean Studio enlaza los archivos originales y escribe los proyectos, las cachés y las exportaciones en una **carpeta de espacio de trabajo** que tú eliges; no se envía nada a la nube.',
        },
      ],
    },
    {
      title: 'Qué necesita tu navegador',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio se apoya en API web modernas, así que la vía compatible es un navegador Chromium reciente.',
        },
        {
          kind: 'table',
          headers: ['Navegador', 'Estado'],
          rows: [
            ['Chrome / Edge 113+', 'Totalmente compatible'],
            ['Brave', 'Funciona tras activar el indicador de la File System Access API'],
            ['Safari / Firefox', 'Aún no son compatibles con el flujo de trabajo completo'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio usa la File System Access API (carpetas de espacio de trabajo), WebCodecs (decodificación y exportación), WebGPU (efectos, color, IA) y OPFS (cachés). Mantén activada la aceleración por hardware y los controladores de la GPU al día.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave puede bloquear el acceso a carpetas. Abre `brave://flags/#file-system-access-api`, ponlo en **Enabled** y vuelve a abrir Brave.',
        },
      ],
    },
    {
      title: 'Tu primera edición',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abre DroneClean Studio en un navegador compatible y, cuando te lo pida, elige una **carpeta de espacio de trabajo** en la que puedas leer y escribir.',
            'En la página de Proyectos, elige **Nuevo proyecto** y define la resolución y la velocidad de fotogramas de la edición.',
            'Abre la pestaña **Medios** y usa **Importar** para añadir archivos, o arrastra los medios directamente a la biblioteca.',
            'Arrastra un clip desde el panel de Medios a una pista de la línea de tiempo.',
            'Pulsa `Space` para reproducir y usa `Left` y `Right` para avanzar o retroceder un fotograma cada vez.',
            'Guarda con `Ctrl+S` mientras trabajas y elige **Exportar** para renderizar el vídeo terminado.',
          ],
        },
      ],
    },
    {
      title: 'Comprueba que tu configuración funciona',
      blocks: [
        {
          kind: 'list',
          items: [
            'El selector de espacio de trabajo se abre y acepta una carpeta normal (no una ubicación protegida del sistema).',
            'Los medios importados aparecen como tarjetas con miniaturas en el panel de Medios.',
            'La reproducción arranca desde la línea de tiempo al pulsar `Space`.',
            'Exportar se abre y la comprobación previa no informa de ningún problema bloqueante.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Si algún paso falla, consulta la página de **Solución de problemas** para ver el síntoma que corresponda.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
