import type { DocPageContent } from '../../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Configuración',
  description:
    'Las pestañas General, Línea de tiempo, IA, Almacenamiento y Privacidad, y dónde se ajustan el idioma y los atajos.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'Las pestañas',
      blocks: [
        {
          kind: 'table',
          headers: ['Pestaña', 'Qué ajustas'],
          rows: [
            [
              'General',
              'Guardado automático activado/desactivado e intervalo (5–30 min); profundidad del historial de deshacer (10–200 pasos); sonidos de interfaz (activados/desactivados, volumen, tema de sonido).',
            ],
            [
              'Línea de tiempo',
              'Ajuste magnético por defecto; mostrar formas de onda y tiras de fotogramas; extraer tiras de fotogramas al importar.',
            ],
            [
              'IA',
              'Intervalo de muestreo de las descripciones (segundos o fotogramas); estilo de subtítulos predeterminado.',
            ],
            [
              'Almacenamiento',
              'Generar los proxies que faltan; borrar la caché del proyecto; regenerar miniaturas; eliminar proxies; gestionar la IA local.',
            ],
            [
              'Privacidad',
              'Informes de errores y estadísticas de uso anónimas, cada uno activado o desactivado (ambos desactivados hasta que los permitas); en la app de escritorio, también **Buscar versiones nuevas** (activado por defecto).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Borrar la caché del proyecto elimina datos regenerables (formas de onda, tiras de fotogramas, fotogramas de GIF, audio decodificado); nunca borra los medios de origen. Usa **Restablecer** en la cabecera del cuadro de diálogo para restaurar los valores predeterminados.',
        },
      ],
    },
    {
      title: 'Versiones nuevas',
      blocks: [
        {
          kind: 'paragraph',
          text: 'La app de escritorio no está firmada, así que no puede actualizarse sola. En su lugar, al iniciarse (como máximo una vez al día) pide a GitHub el número de la última versión y, si hay una más reciente, muestra una pequeña tarjeta con **Descargar** (abre la página de esa versión en tu navegador) y **Más tarde** (la oculta hasta mañana). No aparece nada mientras se renderiza una exportación. Es la única petición que la app hace sin que tú la pidas, por eso tiene un interruptor: **Configuración › Privacidad › Buscar versiones nuevas**, activado por defecto. GitHub ve tu dirección IP; no se envía nada más sobre ti ni sobre tu trabajo, y con el interruptor apagado no se hace ninguna petición. El editor web siempre está en la última versión y nunca comprueba.',
        },
      ],
    },
    {
      title: 'Sonidos de interfaz',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio puede reproducir sutiles sonidos de interfaz sintetizados: señales breves que confirman acciones como seleccionar, confirmar, activar o desactivar y eliminar. Están **desactivados por defecto**, son opcionales y nunca afectan al audio exportado.',
        },
        {
          kind: 'steps',
          items: [
            'Abre **Configuración** y ve a la pestaña **General**.',
            'Activa **Sonidos de interfaz**.',
            'Ajusta **Volumen del sonido** a tu gusto (0–100 %).',
            'Elige un **Tema de sonido** (**Signature**, **Velvet** o **Crisp**) y usa el botón **Vista previa** para escucharlo.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Los sonidos se suprimen mientras se reproduce la vista previa, de modo que nunca se cuelan en el audio que estás monitorizando; las exportaciones son silenciosas por diseño. Al activar el interruptor se reproduce una breve confirmación.',
        },
      ],
    },
    {
      title: 'Informes de errores y estadísticas de uso',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio no envía nada sobre ti ni sobre tu trabajo a menos que lo permitas. La primera vez que se abre, te pregunta, en una tarjeta en la esquina inferior izquierda, si quieres enviar **informes de errores** y **estadísticas de uso anónimas**; hasta que respondas, y después de **No permitir**, no se envía nada. Cambia cualquiera de los dos cuando quieras en **Configuración › Privacidad**.',
        },
        {
          kind: 'table',
          headers: ['Informe', 'Qué se envía', 'Dónde'],
          rows: [
            [
              'Informes de errores',
              'El error, dónde ocurrió en el código del editor, la versión y el sistema operativo. Las rutas y los nombres de archivo se eliminan de los mensajes antes de que salgan.',
              'Sentry, en la UE',
            ],
            [
              'Estadísticas de uso',
              'Que se abrió la aplicación, que se creó un proyecto (su tamaño y su velocidad de fotogramas), que terminó una exportación (su formato, tamaño y duración), que se conectó un agente de IA o que se eliminó una sombra (su duración), bajo un identificador aleatorio de esta instalación que se olvida cuando desactivas las estadísticas.',
              'PostHog, en la UE',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Nunca se envían: tus grabaciones, fotogramas, nombres de archivos y carpetas, nombres de proyectos ni tu cuenta. Tu dirección IP no se almacena. La aplicación de escritorio guarda tu respuesta en su carpeta de perfil y el editor web, en tu navegador.',
        },
      ],
    },
    {
      title: 'Personalizar los atajos de teclado',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Los atajos de teclado son totalmente personalizables, pero el editor es un cuadro de diálogo aparte que se abre desde el botón **Atajos de teclado** de la barra de herramientas, no desde este cuadro de Configuración. Incluye un teclado interactivo en pantalla, búsqueda y filtros **Personalizado** / **Conflictos** / **Sin asignar**, grabación para reasignar, asignaciones alternativas, valores predeterminados por comando y con **Restablecer todo**, detección de conflictos y **Importar** / **Exportar** de preajustes en JSON.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Consulta la página de **Atajos de teclado** para ver la lista completa de comandos y una guía paso a paso para reasignarlos.',
        },
      ],
    },
    {
      title: 'Lo que se ajusta en otro sitio',
      blocks: [
        {
          kind: 'list',
          items: [
            'El **idioma** de la interfaz es un control aparte en la barra de herramientas, no forma parte de este cuadro de diálogo; DroneClean Studio se ofrece en 10 idiomas.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio usa actualmente un único tema oscuro; no hay selector de tema.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
