import type { DocPageContent } from '../../docs-content'

const page = {
  order: 22,
  slug: 'troubleshooting',
  title: 'Solución de problemas',
  description:
    'Soluciones para problemas con el navegador, el espacio de trabajo, los medios, WebGPU, la IA local y la exportación.',
  category: 'Reference',
  related: ['workspaces', 'export'],
  sections: [
    {
      title: 'Navegador y espacio de trabajo',
      blocks: [
        {
          kind: 'table',
          headers: ['Síntoma', 'Solución'],
          rows: [
            [
              'Navegador no compatible, o no aparece el selector de espacio de trabajo',
              'Usa Chrome o Edge 113+, que admiten las API que necesita DroneClean Studio.',
            ],
            [
              'Brave no puede elegir una carpeta',
              'Activa `brave://flags/#file-system-access-api` y vuelve a abrir Brave.',
            ],
            [
              'Permiso denegado',
              'Elige una carpeta normal que puedas editar y después permite el acceso de lectura y escritura.',
            ],
            [
              'Se te pide reconectar al volver a abrir',
              'Elige **Reconectar** para la misma carpeta; si se ha movido, elige otra carpeta.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Medios e importación',
      blocks: [
        {
          kind: 'table',
          headers: ['Síntoma', 'Solución'],
          rows: [
            [
              'Medios faltantes',
              'Vuelve a enlazar con **Conceder acceso**, **Localizar**, **Localizar carpeta** o **Buscar en otra carpeta**.',
            ],
            [
              'La importación falló o el códec no es compatible',
              'Prueba con otro formato compatible con el navegador, o transcodifica antes el archivo.',
            ],
            [
              'Falla la importación desde una URL',
              'Asegúrate de que el enlace apunta al propio archivo multimedia, no a una página que lo incruste.',
            ],
            [
              'Vistas previas o formas de onda obsoletas',
              'Regenera las miniaturas o los proxies, o borra la caché del proyecto en los ajustes de Almacenamiento.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Usa **Trabajar sin conexión** solo si piensas volver a enlazar los archivos más tarde; hasta entonces, los clips quedan como referencias rotas.',
        },
      ],
    },
    {
      title: 'WebGPU e IA local',
      blocks: [
        {
          kind: 'table',
          headers: ['Síntoma', 'Solución'],
          rows: [
            [
              'Efectos, scopes o IA no disponibles',
              'Puede que WebGPU esté desactivado: usa un Chrome o Edge reciente, actualiza los controladores de la GPU y mantén activada la aceleración por hardware.',
            ],
            [
              'La descarga de un modelo es lenta o falla',
              'Mantén abierta la pestaña, vuelve a intentarlo con una conexión estable y borra la **Caché de modelos de IA local** si una descarga está dañada.',
            ],
            [
              'Se agota la memoria durante el trabajo con IA',
              'Usa **Descargar modelos locales** para liberar los entornos de ejecución.',
            ],
            [
              'Importación de LUT bloqueada',
              'La importación de LUT (.cube) requiere un navegador basado en Chromium.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Exportación',
      blocks: [
        {
          kind: 'table',
          headers: ['Síntoma', 'Solución'],
          rows: [
            [
              'Códec no disponible en la comprobación previa',
              'Elige otro códec o formato, o baja la resolución o la calidad.',
            ],
            [
              'Exportación con worker no disponible',
              'Mantén la pestaña en primer plano y evita interactuar con intensidad; sustituir los elementos de imagen animada por clips de vídeo puede ayudar.',
            ],
            [
              'Exportación grande o lenta',
              'Exporta un rango de entrada/salida más corto, baja la resolución o la calidad y libera antes espacio en disco.',
            ],
            [
              'La exportación no se inicia',
              'Resuelve cualquier advertencia bloqueante de la comprobación previa y prueba después con un rango corto para confirmar que el proceso funciona.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
