import type { DocPageContent } from '../../docs-content'

// order 11.5 places this right after Text, Captions, and Subtitles in Creative Tools.
const page = {
  order: 11.5,
  slug: 'shapes-masks',
  title: 'Formas y máscaras',
  description:
    'Añade formas, dibuja trazados personalizados con la herramienta pluma y usa cualquier forma como máscara de un clip.',
  category: 'Creative Tools',
  related: ['motion', 'properties', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Añadir una forma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abre la pestaña **Formas** y haz clic en una forma para añadirla en el cabezal de reproducción, o arrástrala a una pista concreta.',
            'Formas integradas: **Rectángulo**, **Círculo**, **Elipse**, **Triángulo**, **Estrella**, **Polígono** y **Corazón**.',
            'Una forma nueva aparece con el tamaño del lienzo y seleccionada, lista para colocarla y darle estilo.',
          ],
        },
      ],
    },
    {
      title: 'Dar estilo a una forma',
      blocks: [
        {
          kind: 'table',
          headers: ['Control', 'Notas'],
          rows: [
            ['Tipo', 'Alterna entre los siete tipos de forma.'],
            ['Relleno', 'Un relleno de color sólido o degradado.'],
            [
              'Ancho c. / Contorno',
              'Ancho del contorno (0–50 px) y su color (se muestra cuando el ancho es mayor que 0).',
            ],
            [
              'Extremo / Unión',
              'Los extremos del trazo y la forma en que se unen los segmentos de trazo conectados.',
            ],
            [
              'Recortar trazados',
              'Controles de inicio, final y desfase para dibujar solo una parte de un trazado.',
            ],
            ['Estrechamiento', 'Anchos inicial y final para un trazo que se estrecha.'],
            [
              'Radio',
              'Redondeo de esquinas (0–100 px) para rectángulo, triángulo, estrella y polígono.',
            ],
            ['Puntas / Radio int.', 'Número de puntas y radio interior, para estrella y polígono.'],
            ['Dirección', 'Hacia dónde apunta un triángulo.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'La posición, el tamaño, la rotación y la opacidad están en los controles de Transformación, y la mayoría de los valores se pueden animar con fotogramas clave; consulta [Animación con fotogramas clave](keyframes).',
        },
      ],
    },
    {
      title: 'Animar vértices de trazado en Motion',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abre la forma en **Motion** y expande sus filas de propiedades.',
            'Selecciona puntos del trazado en la vista previa.',
            'Elige **Vértices seleccionados** para animar solo esos puntos, o **Todos los vértices** para exponer todos los puntos.',
            'Añade fotogramas clave a las coordenadas de los vértices y mueve el cabezal de reproducción antes de remodelar el trazado.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Los fotogramas clave de Path Geometry bloquean la topología del trazado. Quítalos antes de añadir, quitar, reordenar o cambiar el primer vértice.',
        },
      ],
    },
    {
      title: 'Dibujar un trazado personalizado con la herramienta pluma',
      blocks: [
        {
          kind: 'steps',
          items: [
            'En la pestaña Formas, elige la herramienta **Pluma** para dibujar una forma de trazado personalizada.',
            'Haz clic en la vista previa para colocar puntos; haz clic y arrastra un punto para sacar tiradores curvos (bezier).',
            'Retroceso quita el último punto y Escape cancela.',
            'Con al menos tres puntos, elige **Finalizar forma** para confirmarla (o **Cancelar**).',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Para remodelar un trazado más tarde, selecciónalo y usa **Editar trazado**: arrastra puntos y tiradores, haz doble clic en un borde para añadir un punto y convierte un punto entre **Esquina** y **Curva Bezier**. Elige **Listo** cuando termines.',
        },
      ],
    },
    {
      title: 'Usar una forma como máscara',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Coloca la forma en una pista **por encima** del clip que quieras enmascarar.',
            'En la sección Forma, activa **Usar como máscara**.',
            'Elige un **Tipo de máscara**: **Clip** para bordes duros o **Alfa** para bordes suaves.',
            'En una máscara Alfa, ajusta **Difuminado** para suavizar el borde; usa **Invertir** para ocultar el área de la forma en lugar de revelarla.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Una máscara afecta a todo lo que hay en las pistas inferiores, según la geometría de la forma. El difuminado solo se aplica a las máscaras Alfa: las máscaras Clip mantienen los bordes duros.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Mientras editas una máscara o dibujas con la pluma, el resto del editor queda bloqueado: termina o sal de la edición de máscara para continuar.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
