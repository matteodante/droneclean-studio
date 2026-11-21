import type { DocPageContent } from '../../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Vista previa y reproducción',
  description:
    'Reproduce, avanza fotograma a fotograma, amplía el monitor, pasa a pantalla completa, guarda fotogramas, usa la reproducción con proxies, baja la resolución de reproducción y renderiza un tramo por adelantado para una reproducción fluida.',
  category: 'Core Editing',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Reproducir y navegar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Reproduce y pausa con los controles de la vista previa o con `Space`.',
            'Avanza o retrocede un fotograma cada vez con `Left` y `Right` para comprobaciones exactas al fotograma.',
            'Salta al inicio de la línea de tiempo con `Home` y al final con `End`.',
            'Consulta el código de tiempo para confirmar la posición exacta del cabezal de reproducción.',
          ],
        },
      ],
    },
    {
      title: 'Encuadrar la vista',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ajusta el zoom de la vista previa para inspeccionar detalles; esto no cambia el lienzo de exportación.',
            'Usa **Pantalla completa** para revisar el movimiento o el encuadre, y Salir de pantalla completa para volver.',
            'Usa **Guardar fotograma** para escribir el fotograma actual en un archivo de imagen.',
            'Las superposiciones de transformación, máscara y edición aparecen en el monitor cuando se selecciona un elemento que las admite.',
          ],
        },
      ],
    },
    {
      title: 'Rendimiento de reproducción y audio',
      blocks: [
        {
          kind: 'list',
          items: [
            'Cuando existen proxies, DroneClean Studio los usa para reproducir con más fluidez los medios pesados; las exportaciones siguen usando los originales.',
            'El control de volumen del monitor solo afecta a la reproducción local.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Las exportaciones usan la mezcla del proyecto, así que el volumen del monitor nunca cambia el audio renderizado.',
        },
      ],
    },
    {
      title: 'Resolución de reproducción',
      blocks: [
        {
          kind: 'paragraph',
          text: 'El botón junto al interruptor de proxies en la barra de transporte fija la resolución de reproducción: **Completa**, **1/2** o **1/4**. Una resolución más baja dibuja menos píxeles en cada fotograma que la vista previa calcula por sí misma (clips con efectos, estabilización, rampas de velocidad, desenfoque de movimiento), así que los tramos pesados se reproducen más rápido; la imagen se ve más suave. El ajuste vale para toda la app y nunca cambia una exportación.',
        },
      ],
    },
    {
      title: 'Renderizar un tramo por adelantado',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Los clips estabilizados con cámara lenta por flujo óptico y desenfoque de movimiento pueden ser demasiado pesados para la vista previa en tiempo real. Renderízalos por adelantado, como en After Effects, y se reproducirán a la velocidad de fotogramas completa.',
        },
        {
          kind: 'steps',
          items: [
            'Marca el tramo con entrada y salida (`I` y `O`), o no marques nada para renderizar toda la línea de tiempo.',
            'Abre el menú **Renderizar vista previa** en la barra de la línea de tiempo, junto a los botones de entrada y salida, y elige **Renderizar de entrada a salida**, o pulsa `Enter`.',
            'Sigue el progreso en la barra de transporte; la X de ahí cancela y conserva lo que ya está renderizado.',
            'Una línea verde en el borde inferior de la regla marca los fotogramas que ahora se reproducen desde la vista previa renderizada.',
          ],
        },
        {
          kind: 'list',
          items: [
            'Los fotogramas se renderizan a la resolución de reproducción actual y se guardan en memoria (hasta 1 GB, unos cuatro minutos y medio a 1080p 60 fps) hasta que cierras el proyecto.',
            'Cualquier edición que cambie un fotograma (un clip, un efecto, un fotograma clave, una transición, la estabilización, la velocidad, el tamaño o la frecuencia del proyecto, la resolución de reproducción o el interruptor de proxies) quita esos fotogramas de la línea verde al instante: la vista previa los vuelve a calcular en directo, nunca una imagen vieja.',
            'Renderizar otra vez solo calcula los fotogramas que faltan. **Eliminar la vista previa renderizada** en el mismo menú libera la memoria.',
            'Las exportaciones nunca usan la vista previa renderizada: siempre renderizan desde el proyecto.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Si el ordenador no puede codificar fotogramas al tamaño de la vista previa, o se alcanza el límite de memoria, un mensaje lo indica y la vista previa sigue en directo.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
