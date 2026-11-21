import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'Efectos y color',
  description:
    'Añade y apila efectos de GPU, etalona con ruedas y curvas, lee los scopes, aplica LUT y aísla correcciones.',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: 'Añadir y gestionar efectos',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Selecciona un clip y abre la sección **Efectos** en Propiedades.',
            'Usa **Agregar efecto** y después busca o elige en una categoría. También puedes añadir **Preajustes** integrados o tus propios preajustes guardados.',
            'Reordena la pila con **Subir** y **Bajar**: el orden cambia cómo se combinan los efectos.',
            'Desactiva, restablece o quita un efecto desde su panel; los parámetros numéricos se pueden animar con fotogramas clave.',
          ],
        },
      ],
    },
    {
      title: 'El catálogo de efectos',
      blocks: [
        {
          kind: 'table',
          headers: ['Categoría', 'Efectos'],
          rows: [
            [
              'Color',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['Desenfoque', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              'Distorsión',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, Ripple Glass, Glass Mosaic, Blocks, Droste y más',
            ],
            [
              'Estilización',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, VHS, Halftone, Dither, ASCII, Ink, Pixel Sort, Block Glitch, Color Glitch',
            ],
            ['Keying', 'Chroma Key (eliminación de fondo verde y azul)'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Todos los efectos se renderizan en la GPU (WebGPU). Entre las últimas incorporaciones están **Gradient Map**, **VHS**, **CRT**, **Droste**, **Block Glitch**, las distorsiones **Ripple Glass** y **Glass Mosaic**, **Ink** y **Pixel Sort**.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**ASCII** puede renderizar sus propios caracteres: pon **Character Set** en **Custom**, escribe tus **Caracteres personalizados** (la rampa va del más denso al más claro) y elige una **Fuente** (Monospace, Courier, Consolas o Lucida Console). Los conjuntos integrados incluyen ASCII Ramp, Dense, Binary y Symbols.',
        },
      ],
    },
    {
      title: 'Entradas de color y el cuentagotas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Todos los controles de color aceptan un valor **hex**; escríbelo directamente en el campo (la vista previa se actualiza mientras escribes).',
            'Donde se admite transparencia, el campo acepta hex de 8 dígitos (`#rrggbbaa`) y el selector añade un control deslizante de alfa.',
            'Haz clic en el **cuentagotas** (pipeta) para tomar una muestra de color de cualquier parte de la aplicación o de la vista previa; una lupa sigue al cursor para que puedas dar con el píxel exacto, y después haz clic para aplicarlo.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'El cuentagotas es un muestreador integrado en la aplicación (no el nativo del navegador) y no necesita ninguna ventana de permiso. La misma herramienta sirve de base a las ruedas del espacio de trabajo Color.',
        },
      ],
    },
    {
      title: 'Etalonar en el espacio de trabajo Color',
      blocks: [
        {
          kind: 'list',
          items: [
            'Cambia al espacio de trabajo **Color** (`Alt+2`) y selecciona un clip; las ruedas y las curvas están listas incluso antes de que exista un etalonaje.',
            'Las **Ruedas de color** ajustan Sombras, Medios tonos, Luces altas y Desfase, con selectores de balance de blancos y balance automático.',
            'Las **Curvas** editan los canales Maestro, Rojo, Verde y Azul; haz clic en una curva para añadir un punto y doble clic en un punto para quitarlo.',
            'Compara con **Antes**, **Después** y **Dividido**, y copia un look entre clips con **Copiar etalonaje** y **Pegar etalonaje**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Omitir etalonaje** previsualiza la imagen sin etalonar, pero nunca afecta a las exportaciones.',
        },
      ],
    },
    {
      title: 'Leer los scopes',
      blocks: [
        {
          kind: 'table',
          headers: ['Scope', 'Muestra'],
          rows: [
            ['Waveform', 'La distribución de luminancia y color, de arriba abajo'],
            ['RGB Parade', 'Los canales rojo, verde y azul, uno junto a otro'],
            ['Vectorscope', 'Tono y saturación'],
            ['Histogram', 'La distribución de los tonos'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Activa o desactiva los scopes con **Mostrar color scopes**. Waveform e Histogram también ofrecen vistas RGB, de un solo canal y de luma (Y).',
        },
      ],
    },
    {
      title: 'LUT y correcciones aisladas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Añade el efecto **LUT (.cube)**, elige **Importar LUT .cube** y después ajusta **Intensidad** para mezclarla.',
            '**Secondary Qualifier** limita una corrección a un rango de tono, saturación y luminancia.',
            '**Power Window** limita una corrección a una máscara elíptica o rectangular, con difuminado e inversión.',
            'Añade una **capa de ajuste** para etalonar o aplicar efectos a todos los clips de las pistas que quedan debajo.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'La importación de LUT requiere un navegador basado en Chromium.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
