import type { DocPageContent } from '../../docs-content'

const page = {
  order: 7,
  slug: 'editing-tools',
  title: 'Schnittwerkzeuge',
  description:
    'Auswahl, Rasiermesser, Trimmen, Slip, Slide, Geschwindigkeitsdehnung und das Verhalten von Ripple- und Rolling-Trim.',
  category: 'Core Editing',
  related: ['timeline', 'keyboard-shortcuts', 'properties'],
  sections: [
    {
      title: 'Die Kernwerkzeuge',
      blocks: [
        {
          kind: 'table',
          headers: ['Werkzeug', 'Taste', 'Verwendung'],
          rows: [
            ['Auswahl', '`V`', 'Clips auswählen, verschieben und anordnen.'],
            [
              'Trimmen',
              '`T`',
              'Eine Clipkante ziehen, um zu ändern, wo der Clip beginnt oder endet.',
            ],
            ['Rasiermesser', '`C`', 'Einen Clip dort schneiden, wo du klickst.'],
            [
              'Geschwindigkeitsdehnung',
              '`R`',
              'Die Dauer ändern, indem die Wiedergabegeschwindigkeit geändert wird.',
            ],
            ['Slip', '`Y`', 'Die Quellframes in einem Clip ändern, ohne ihn zu verschieben.'],
            [
              'Slide',
              '`U`',
              'Einen Clip verschieben und dabei die benachbarten Schnitte anpassen.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Trimm-Verhalten',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ein **Ripple**-Trim ändert einen Schnitt und verschiebt das gesamte spätere Material, sodass sich die Gesamtdauer ändert.',
            'Ein **Rolling**-Trim verschiebt den Schnitt zwischen zwei benachbarten Clips, ohne die Gesamtdauer zu ändern.',
            'Eine **Slip**-Bearbeitung ändert, welche Quellframes in einem Clip erscheinen, ohne den Clip oder seine Nachbarn zu verschieben.',
            'Eine **Slide**-Bearbeitung verschiebt einen Clip entlang der Spur und passt dabei automatisch die benachbarten Schnitte an.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple und Rolling sind Verhaltensweisen des Werkzeugs **Trimmwerkzeug**, keine eigenen Werkzeuge mit eigenem Kürzel.',
        },
      ],
    },
    {
      title: 'Clips synchron halten',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Verknüpfte Auswahl** bewegt einen Videoclip und sein Audio gemeinsam; schalte sie mit `Shift+L` um.',
            'Verknüpfe Clips mit `Ctrl+Alt+L` und löse die Verknüpfung mit `Alt+Shift+L`, wenn sich eine Beziehung ändern soll.',
            'Die **Sync-Sperre** einer Spur hält das Timing bei Ripple-artigen Bearbeitungen ausgerichtet.',
          ],
        },
      ],
    },
    {
      title: 'Strukturelle Bearbeitungen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Füge mit `Shift+F` am Abspielkopf ein **Standbild** ein, um ein einzelnes Bild zu halten.',
            'Fasse eine Reihe von Clips zu einem **Compound-Clip** zusammen, um einen unübersichtlichen Abschnitt wiederzuverwenden oder zu vereinfachen, oder öffne ihn als **Sequenz**-Tab, um ihn als eigenständige Zeitleiste zu bearbeiten.',
            'Nutze den Dialog **Bento-Layout**, um ausgewählte visuelle Clips in einem strukturierten Raster anzuordnen.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
