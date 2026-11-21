import type { DocPageContent } from '../../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Edición de audio',
  description:
    'Graba una voz en off, ajusta la ganancia y los fundidos del clip, el tono, el ecualizador por clip, el mezclador y los medidores, y limpia silencios y muletillas.',
  category: 'Creative Tools',
  related: ['properties', 'local-ai'],
  sections: [
    {
      title: 'Ajustar un clip',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Selecciona un clip y abre la pestaña **Audio** en Propiedades.',
        },
        {
          kind: 'table',
          headers: ['Control', 'Rango'],
          rows: [
            ['Ganancia', 'De -60 dB a +12 dB (−60 dB silencia el clip en la práctica)'],
            ['Fundido de entrada / Fundido de salida', 'De 0 a 5 segundos cada uno'],
            ['Tono', 'Semitonos y centésimas, independientes de la velocidad'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'También puedes arrastrar la línea de volumen y los tiradores de fundido directamente sobre el clip en la línea de tiempo, y la **Ganancia** se puede animar con fotogramas clave para que suba o baje a lo largo de un clip.',
        },
      ],
    },
    {
      title: 'Tono y timbre',
      blocks: [
        {
          kind: 'list',
          items: [
            'Los controles de **Tono** cambian la altura del sonido sin modificar la velocidad del clip. Para cambiar la velocidad, usa **Velocidad** en la pestaña Vídeo.',
            'La sección **Ecualizador** da a cada clip un editor de curva para modelar el timbre.',
          ],
        },
      ],
    },
    {
      title: 'Mezclador y medidores',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abre los **Medidores** de audio para ver los niveles estéreo y detectar la saturación mientras reproduces.',
            'Usa el **Mezclador** para equilibrar los niveles de todo el proyecto.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'El volumen del monitor en la vista previa solo afecta a la reproducción local y nunca cambia la mezcla exportada.',
        },
      ],
    },
    {
      title: 'Grabar una voz en off',
      blocks: [
        {
          kind: 'paragraph',
          text: 'El botón **Grabar voz en off** (micrófono) de la barra de herramientas de la línea de tiempo graba la narración al ritmo de tu proyecto. La captura se ejecuta **mientras se reproduce la línea de tiempo**, y la toma terminada se coloca en una pista de audio nueva anclada a la posición del cabezal de reproducción en la que empezaste.',
        },
        {
          kind: 'steps',
          items: [
            'Lleva el cabezal de reproducción al punto donde debe empezar la voz en off.',
            'Haz clic en el botón del **micrófono**: la línea de tiempo empieza a reproducirse y comienza la grabación.',
            'Usa **Pausar grabación** para detener a la vez el cabezal y el micrófono, **Reanudar grabación** para continuar y **Detener y guardar** para terminar y colocar el clip en una pista de audio nueva.',
            'Haz clic en **Cancelar grabación** (la ✕) para descartar la toma sin añadir nada.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Abre **Configuración del micrófono** (el ▾ junto al botón) para elegir un dispositivo de entrada y ajustar la captura. El medidor de nivel de esa pantalla funciona en directo, así que puedes comprobar el micrófono antes de grabar.',
        },
        {
          kind: 'table',
          headers: ['Ajuste', 'Qué hace'],
          rows: [
            ['Supresión de ruido', 'Reduce el ruido de fondo constante. Activada por defecto.'],
            ['Ganancia automática', 'Mantiene tu voz a un nivel constante. Activada por defecto.'],
            [
              'Silenciar la línea de tiempo durante la grabación',
              'Silencia el monitor de la línea de tiempo para que el audio de los altavoces no se cuele en el micrófono. Activado por defecto.',
            ],
            [
              'Desfase de sincronización',
              'Adelanta o retrasa el clip grabado para compensar la latencia de entrada (hasta ±1000 ms).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Usa auriculares para que el micrófono nunca capte el audio de tu proyecto; así puedes desactivar **Silenciar la línea de tiempo durante la grabación** y oír la mezcla mientras narras.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Mientras grabas no se puede desplazar la reproducción, y pulsar `Space` o llegar al final de la línea de tiempo termina la toma. Así la grabación queda fija al cabezal de reproducción y nunca puede desincronizarse.',
        },
      ],
    },
    {
      title: 'Limpiar el diálogo',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Eliminar silencio** encuentra los rangos silenciosos y los corta; el ajuste **Minimo silencio** controla cuánto debe durar un hueco, y el cuadro de diálogo estima cuánto se eliminará.',
            '**Eliminar muletilla palabras** detecta en la transcripción y en el audio palabras como «eh» y «mm» y las elimina.',
            'Ambas herramientas muestran los rangos que van a eliminar, para que puedas previsualizarlos antes de aplicar la edición.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Una transcripción mejora la detección de muletillas, así que genera una primero para obtener los mejores resultados.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
