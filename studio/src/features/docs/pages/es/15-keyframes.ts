import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Animar con fotogramas clave',
  description:
    'Anima valores de transformación, recorte, texto, efectos y audio con fotogramas clave, suavizado y el editor de curvas.',
  category: 'Creative Tools',
  related: ['motion', 'motion-library', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Elegir dónde editar los fotogramas clave',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Edición mantiene el trabajo con fotogramas clave en un formato compacto. Motion ofrece la hoja de dopaje completa de capas y el gráfico para un trabajo más fino de tiempos y curvas.',
        },
        {
          kind: 'table',
          headers: ['Superficie', 'Flujo de trabajo con fotogramas clave'],
          rows: [
            [
              'Edición',
              'Selecciona un clip y pulsa `K` para añadir un fotograma clave a su propiedad activa. Abre **Animación** en Propiedades para ver los preajustes y el estado aplicado.',
            ],
            [
              'Motion',
              'Expande una capa para ver las filas de propiedades, los rombos de fotogramas clave, el suavizado por segmento y un gráfico de valores integrado.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'En Motion, el cabezal de reproducción compartido, la selección, el ajuste magnético, la regla, los carriles de propiedades y el gráfico usan el mismo eje de tiempo.',
        },
      ],
    },
    {
      title: 'Añadir un fotograma clave',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Lleva el cabezal de reproducción al fotograma en el que quieras fijar el fotograma clave.',
            'Escribe un valor junto a un parámetro y pulsa `Enter`, o haz clic en el **rombo** de la fila del parámetro.',
            'Ve a otro fotograma y define un segundo valor para crear movimiento entre ambos.',
            'Activa **auto-key** con el icono del temporizador, o pulsa `A`, para capturar automáticamente los cambios de valor posteriores.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'No puedes añadir un fotograma clave dentro de una región de transición, ni con el cabezal de reproducción fuera de los límites del clip: allí el rombo está desactivado.',
        },
      ],
    },
    {
      title: 'Qué puedes animar',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo de clip', 'Valores animables'],
          rows: [
            [
              'Todos los clips visuales',
              'Posición X / Y, ancho, alto, rotación, opacidad, radio de esquina',
            ],
            [
              'Vídeo',
              'Añade el punto de anclaje, los cuatro bordes del recorte, la suavidad del recorte y el volumen',
            ],
            [
              'Texto',
              'Añade escala del preajuste, tamaño de fuente, interlineado, relleno, radio del fondo, sombra y contorno',
            ],
            ['Audio', 'Volumen en decibelios'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Los efectos también aportan sus propios parámetros animables: busca el interruptor de fotogramas clave junto a cada control deslizante.',
        },
      ],
    },
    {
      title: 'Dar forma al movimiento',
      blocks: [
        {
          kind: 'list',
          items: [
            'Haz clic en el **conector** entre dos fotogramas clave para abrir el **editor de suavizado**.',
            'Explora las curvas predefinidas en **Suavizado cúbico** y **resorte**. Filtra por **Todas**, **Entrada**, **Salida** o **Entrada/Salida**.',
            'Elige **Mantener** para conservar el valor anterior hasta el siguiente fotograma clave.',
            'Cambia a **Editar** para dar forma a la curva directamente: arrastra los dos tiradores de control del gráfico o escribe valores exactos. Los resortes exponen **tensión**, **fricción** y **masa** y previsualizan su rebote real.',
            'Comprueba el ritmo en **Posición**, **Escala**, **Rotar** u **Opacidad** en la vista previa en directo, y usa **Pausar** para detener el bucle.',
            'Guarda una curva retocada como **preajuste personalizado** con **Guardar como**, **Actualízalo** más tarde o **Restablécelo** al preajuste del que procede. Los preajustes personalizados se guardan en tu dispositivo y aparecen en todos los proyectos.',
            'Copia, corta, pega y elimina fotogramas clave, selecciona grupos con un recuadro, arrastra para cambiar el tiempo y arrastra con `Alt` para duplicar.',
          ],
        },
      ],
    },
    {
      title: 'Trabajar en el gráfico de valores',
      blocks: [
        {
          kind: 'list',
          items: [
            'Elige una propiedad en el menú desplegable para editar su curva, o déjalo en todas para ver las demás como curvas superpuestas atenuadas. El número de fotogramas clave de la propiedad activa se muestra a su lado.',
            'El gráfico dibuja una **cuadrícula** con etiquetas (fotogramas o segundos en horizontal, valores en vertical) para que puedas leer las posiciones de un vistazo.',
            'Encuadra la curva con **Ajustar al contenido**, o desplaza la vista con **Acercar** / **Alejar** y la rueda del ratón. **Restablecer vista** vuelve al ajuste predeterminado.',
            'Recorre los fotogramas clave con las flechas **anterior** / **siguiente** y después escribe un fotograma (**F**) y un valor (**V**) exactos para el fotograma clave seleccionado.',
            'Mientras arrastras un fotograma clave, mantén pulsado **Shift** para fijarlo a un eje, o **Alt** para un ajuste fino.',
          ],
        },
      ],
    },
    {
      title: 'Convertir y limpiar el movimiento generado',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Los comportamientos en vivo, como deriva, respiración, vibración y giro, se evalúan durante la reproducción sin crear fotogramas clave de propiedad.',
        },
        {
          kind: 'list',
          items: [
            'Elige **Hornear en fotogramas clave** para convertir los comportamientos de capa en vivo en fotogramas clave editables.',
            'Usa **Aplicado** para ir a los fotogramas clave manuales o al primer fotograma de un preajuste generado.',
            'Usa **Recortar animación** cuando el recorte de un clip deje fotogramas clave guardados fuera de su duración visible.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Lee [Aplicar y reutilizar movimiento](motion-library) para ver preajustes, comportamientos en vivo, movimiento de texto, horneado y animaciones guardadas.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
