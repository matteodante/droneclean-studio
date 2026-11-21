import type { DocPageContent } from '../../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Herramientas de IA local',
  description:
    'Texto a voz, generación de música y transcripción en el navegador, con caché local de modelos.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: 'Cómo funciona la IA local',
      blocks: [
        {
          kind: 'list',
          items: [
            'Las herramientas de IA se ejecutan en tu navegador con tu propio hardware: no se envía nada a ningún servidor.',
            'La primera vez que usas un modelo se descarga una sola vez y después se guarda en caché local para reutilizarlo.',
            'Un indicador de estado muestra los estados de carga, activo, listo y error mientras se ejecuta un modelo.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Algunas herramientas requieren Chrome o Edge 113+ (o Safari 26+) y compatibilidad con WebGPU. La primera descarga de un modelo puede ser grande.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Las licencias de los modelos te obligan a ti, no a nosotros: la música generada con MusicGen es solo para uso no comercial (CC BY-NC 4.0), y la voz de Supertonic se rige por la licencia OpenRAIL-M, que prohíbe algunos usos. La pestaña IA lo indica antes de que generes nada.',
        },
      ],
    },
    {
      title: 'Texto a voz',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abre la pestaña **IA**, expande **Texto a voz** y escribe o pega tu guion.',
            'Elige un motor (consulta la tabla) y después una voz y, cuando se admita, la velocidad, el idioma y las etiquetas expresivas.',
            'Previsualiza el resultado y después usa **Guardar e insertar** para colocar el audio vinculado en el cabezal de reproducción, o **Guardar en biblioteca**.',
          ],
        },
        {
          kind: 'table',
          headers: ['Motor', 'Idiomas', 'Se ejecuta en'],
          rows: [
            ['Kokoro', 'Inglés', 'WebGPU'],
            ['MOSS Nano', '20 idiomas', 'CPU'],
            ['Supertonic 3', '31 idiomas', 'ONNX local'],
          ],
        },
      ],
    },
    {
      title: 'Generación de música',
      blocks: [
        {
          kind: 'list',
          items: [
            'Expande **Generación de música** y describe la pista con un prompt, o parte de un preajuste como Lo-fi chill o Upbeat EDM.',
            'Define la duración en segundos y después pulsa **Generar música**; la primera ejecución descarga el modelo y lo guarda en caché.',
            'Previsualiza el clip y después usa **Guardar e insertar** en la línea de tiempo o **Guardar en biblioteca**.',
          ],
        },
      ],
    },
    {
      title: 'Transcripción',
      blocks: [
        {
          kind: 'list',
          items: [
            'La transcripción vive en la biblioteca de Medios y en el flujo de trabajo de Transcripción, separada de la pestaña IA.',
            '**Parakeet** es el motor rápido predeterminado y cubre muchos idiomas europeos.',
            'También están disponibles los modelos Whisper (Tiny, Base, Small, Large v3 Turbo), y DroneClean Studio recurre a Whisper cuando hace falta.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Una transcripción da soporte a los subtítulos, a la búsqueda en la transcripción y a la eliminación de muletillas: genera una cuanto antes.',
        },
      ],
    },
    {
      title: 'Gestionar modelos y entornos de ejecución',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abre los ajustes de **Almacenamiento** para gestionar la IA local.',
            'Usa **Caché de modelos de IA local** para inspeccionar o borrar los modelos descargados; resulta útil si una descarga está dañada.',
            'Usa **Descargar modelos locales** para liberar los entornos de ejecución y recuperar memoria.',
            'Los trabajos largos se pueden cancelar si ya no necesitas el resultado.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
