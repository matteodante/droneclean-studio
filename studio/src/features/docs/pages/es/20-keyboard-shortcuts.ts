import type { DocPageContent } from '../../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Atajos de teclado',
  description: 'Atajos predeterminados por grupo, y cómo buscarlos, reasignarlos y restablecerlos.',
  category: 'Reference',
  sections: [
    {
      title: 'Reproducción',
      blocks: [
        {
          kind: 'table',
          headers: ['Acción', 'Atajo'],
          rows: [
            ['Reproducir / Pausar', '`Space`'],
            ['Fotograma anterior / siguiente', '`Left` / `Right`'],
            ['Punto de ajuste anterior / siguiente', '`Up` / `Down`'],
            ['Ir al inicio / al final', '`Home` / `End`'],
          ],
        },
      ],
    },
    {
      title: 'Edición',
      blocks: [
        {
          kind: 'table',
          headers: ['Acción', 'Atajo'],
          rows: [
            ['Dividir en el cabezal de reproducción', '`Alt+C`'],
            ['Dividir en el cursor', '`Shift+C`'],
            ['Unir', '`Shift+J`'],
            ['Eliminar / Eliminar en cascada', '`Delete` / `Ctrl+Delete`'],
            ['Insertar fotograma congelado', '`Shift+F`'],
            ['Vincular / Desvincular clips', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['Alternar selección vinculada', '`Shift+L`'],
            ['Desplazar 1 px / 10 px', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: 'Herramientas',
      blocks: [
        {
          kind: 'table',
          headers: ['Herramienta', 'Atajo'],
          rows: [
            ['Selección', '`V`'],
            ['Recorte', '`T`'],
            ['Cuchilla', '`C`'],
            ['Estiramiento de velocidad', '`R`'],
            ['Slip', '`Y`'],
            ['Slide', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple y rolling son comportamientos de recorte de la herramienta de **Recorte**, no herramientas separadas con su propio atajo.',
        },
      ],
    },
    {
      title: 'Historial, vista y portapapeles',
      blocks: [
        {
          kind: 'table',
          headers: ['Acción', 'Atajo'],
          rows: [
            ['Deshacer / Rehacer', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['Copiar / Cortar / Pegar', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['Alternar ajuste / ajuste al lienzo', '`S` / `Shift+S`'],
            ['Acercar / alejar', '`Ctrl+=` / `Ctrl+-`'],
            ['Ajustar a la vista / 100 %', '`\\` / `Shift+\\`'],
            ['Espacio de trabajo Edición / Color / Motion', '`Alt+1` / `Alt+2` / `Alt+3`'],
          ],
        },
      ],
    },
    {
      title: 'Marcadores y fotogramas clave',
      blocks: [
        {
          kind: 'table',
          headers: ['Acción', 'Atajo'],
          rows: [
            ['Añadir / Quitar marcador', '`M` / `Shift+M`'],
            ['Marcador anterior / siguiente', '`[` / `]`'],
            ['Borrar fotogramas clave', '`Shift+A`'],
            ['Añadir fotograma clave a la capa seleccionada de Edición', '`K`'],
            ['Vista de gráfico / hoja / dividida de fotogramas clave', '`1` / `2` / `3`'],
            ['Fotograma clave anterior / siguiente de la propiedad', '`Alt+[` / `Alt+]`'],
            ['Alternar auto-key de la propiedad activa', '`A`'],
            ['Ajustar los fotogramas clave seleccionados', '`F`'],
          ],
        },
      ],
    },
    {
      title: 'Monitor de origen y proyecto',
      blocks: [
        {
          kind: 'table',
          headers: ['Acción', 'Atajo'],
          rows: [
            ['Marcar entrada / salida', '`I` / `O`'],
            ['Borrar entrada/salida', '`Alt+X`'],
            ['Renderizar vista previa (de entrada a salida, o toda la línea de tiempo)', '`Enter`'],
            ['Edición de insertar / sobrescribir', '`,` / `.`'],
            ['Guardar', '`Ctrl+S`'],
            ['Exportar', '`Ctrl+Shift+E`'],
            ['Abrir el Explorador de escenas', '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: 'Personalizar los atajos',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Todas las asignaciones anteriores son valores predeterminados de fábrica. Abre el editor de atajos rediseñado con el botón **Atajos de teclado** (icono de teclado) de la barra de herramientas del editor para reasignar cualquier comando a las teclas que prefieras.',
        },
        {
          kind: 'steps',
          items: [
            'Busca comandos por nombre, o filtra por los grupos **Personalizado**, **Conflictos** o **Sin asignar**.',
            'Elige un comando y pulsa **Grabar**; después mantén pulsados los modificadores y pulsa la tecla final.',
            'Si la combinación ya está en uso, el editor señala el conflicto: elige **Sobrescribir** para reasignarla, o elige otras teclas.',
            'Usa **Desvincular** para borrar una asignación, o añade una asignación alternativa junto a la principal.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Usa **Restablecer** para restaurar un solo comando, o **Restablecer todo** para devolver todos los atajos a su valor predeterminado. También puedes **Exportar** tus asignaciones a un archivo de preajuste e **Importar** ese archivo en otro equipo.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
