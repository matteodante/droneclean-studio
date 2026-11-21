import type { DocPageContent } from '../../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: 'Transiciones',
  description:
    'Aplica una transición a un corte y ajusta su estilo, duración, ubicación, suavizado y dirección.',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Aplicar una transición',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abre la pestaña **Transiciones** en la barra lateral de medios.',
            'Arrastra una tarjeta de transición a un corte entre dos clips adyacentes, o selecciona un corte válido y haz clic en una tarjeta.',
            'Selecciona la transición en la línea de tiempo para abrir la sección **Transición** en Propiedades.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Un corte es válido cuando dos clips están pegados borde con borde y tienen fotogramas de origen de sobra para solaparse. Si aplicas una transición sobre otra existente, la reemplaza en su sitio.',
        },
      ],
    },
    {
      title: 'Elegir un aspecto',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Las tarjetas están agrupadas por categoría: **Básica**, **Disolución**, **Movimiento**, **Barrido**, **Deslizamiento**, **Volteo**, **Máscara**, **Iris**, **Forma**, **Luz** y **Cromática**.',
        },
        {
          kind: 'list',
          items: [
            'Los estilos de disolución van desde una simple Cross Dissolve hasta variantes Additive, Blur y Dip To Color.',
            'Los estilos de movimiento y personalizados incluyen Flip, Light Leak, Pixelate, Chromatic, Radial Blur, Glitch y Sparkles.',
            'Los estilos direccionales, como Wipe, Slide y Flip, aparecen como varias tarjetas, una por dirección.',
          ],
        },
      ],
    },
    {
      title: 'Ajustar una transición',
      blocks: [
        {
          kind: 'table',
          headers: ['Control', 'Qué hace'],
          rows: [
            ['Preajuste', 'Cambia el estilo de la transición sin rehacer el corte.'],
            ['Duración', 'Define cuánto dura la transición; restablecer la devuelve a 1 segundo.'],
            ['Ubicación', 'Centrada en el corte, o desplazada antes o después de él.'],
            ['Suavizado', 'Lineal, Entrada, Salida, o Entrada y salida.'],
            ['Dirección', 'Izquierda, derecha, arriba o abajo, para los estilos direccionales.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'También puedes cambiar el tamaño de una transición arrastrando su borde directamente en la línea de tiempo.',
        },
      ],
    },
    {
      title: 'Cuando una transición no se aplica',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Necesitas un corte real entre dos clips y **margen de origen** suficiente en el lado correspondiente. Si una ubicación está bloqueada, elige otra o recorta menos. Arrastrar a un corte válido siempre funciona, incluso cuando no está disponible aplicar con un clic.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
