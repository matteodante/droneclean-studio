import type { DocPageContent } from '../../docs-content'

const page = {
  order: 7,
  slug: 'editing-tools',
  title: 'Herramientas de edición',
  description:
    'Selección, cuchilla, recorte, slip, slide, estiramiento de velocidad y los comportamientos de recorte en cascada (ripple) y rodante (rolling).',
  category: 'Core Editing',
  related: ['timeline', 'keyboard-shortcuts', 'properties'],
  sections: [
    {
      title: 'Las herramientas básicas',
      blocks: [
        {
          kind: 'table',
          headers: ['Herramienta', 'Tecla', 'Uso'],
          rows: [
            ['Selección', '`V`', 'Seleccionar, mover y ordenar clips.'],
            [
              'Recorte',
              '`T`',
              'Arrastrar el borde de un clip para cambiar dónde empieza o termina.',
            ],
            ['Cuchilla', '`C`', 'Cortar un clip donde hagas clic.'],
            [
              'Estiramiento de velocidad',
              '`R`',
              'Cambiar la duración modificando la velocidad de reproducción.',
            ],
            ['Slip', '`Y`', 'Cambiar los fotogramas de origen dentro de un clip sin moverlo.'],
            ['Slide', '`U`', 'Mover un clip ajustando a la vez los cortes vecinos.'],
          ],
        },
      ],
    },
    {
      title: 'Comportamientos de recorte',
      blocks: [
        {
          kind: 'list',
          items: [
            'Un recorte **ripple** (en cascada) cambia una edición y desplaza todo el material posterior, por lo que cambia la duración total.',
            'Un recorte **rolling** (rodante) mueve el corte entre dos clips vecinos, sin cambiar la duración total.',
            'Una edición **slip** cambia qué fotogramas de origen aparecen dentro de un clip sin mover el clip ni sus vecinos.',
            'Una edición **slide** mueve un clip a lo largo de la pista y ajusta automáticamente los cortes vecinos.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple y rolling son comportamientos de la herramienta de **Recorte**, no herramientas separadas con su propio atajo.',
        },
      ],
    },
    {
      title: 'Mantener los clips sincronizados',
      blocks: [
        {
          kind: 'list',
          items: [
            'La **selección vinculada** mueve juntos un clip de vídeo y su audio; actívala o desactívala con `Shift+L`.',
            'Vincula clips con `Ctrl+Alt+L` y desvincúlalos con `Alt+Shift+L` cuando haya que cambiar una relación.',
            'El **bloqueo de sincronización** de una pista mantiene alineados los tiempos durante las ediciones de tipo ripple.',
          ],
        },
      ],
    },
    {
      title: 'Ediciones estructurales',
      blocks: [
        {
          kind: 'list',
          items: [
            'Inserta un **fotograma congelado** en el cabezal de reproducción con `Shift+F` para mantener un único fotograma.',
            'Agrupa una serie de clips en un **clip compuesto** para reutilizar o simplificar una sección cargada, o ábrelo como pestaña de **secuencia** para editarlo como una línea de tiempo independiente.',
            'Usa el cuadro de diálogo **Diseño bento** para colocar los clips visuales seleccionados en una cuadrícula estructurada.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
