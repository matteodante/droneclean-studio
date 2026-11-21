import type { DocPageContent } from '../../docs-content'

const page = {
  order: 10,
  slug: 'properties',
  title: 'Clip-Eigenschaften',
  description:
    'Transformation, Zuschneiden, Deckkraft und Mischmodus sowie die typspezifische Steuerung für jede Art von Clip.',
  category: 'Core Editing',
  related: ['audio', 'text-captions-subtitles', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Wie die Auswahl das Panel steuert',
      blocks: [
        {
          kind: 'list',
          items: [
            'Wähle einen Clip aus, um alle seine Eigenschaften zu bearbeiten.',
            'Wähle mehrere Clips aus, um eine gemeinsame Eigenschaft bei allen auf einmal zu ändern.',
            'Das Panel zeigt nur Tabs für die Eigenschaftsgruppen, die auf die aktuelle Auswahl zutreffen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ein Wert **Gemischt** bedeutet, dass die ausgewählten Clips diese Einstellung derzeit nicht teilen; wenn du sie änderst, gilt ein einziger Wert für alle.',
        },
      ],
    },
    {
      title: 'Steuerung für alle visuellen Clips',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Transformation**: Position, Größe, Drehung und Ankerpunkt.',
            '**Zuschneiden**: jede Kante nach innen beschneiden, mit einem Weichheitsregler für die Schnittkante.',
            '**Deckkraft** und **Mischmodus**: einen Clip ausblenden und wählen, wie er sich über die darunterliegenden Ebenen legt.',
            '**Video**: Wiedergabegeschwindigkeit und zugehöriges Timing für Videoclips.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Viele numerische Regler lassen sich animieren – achte auf den Keyframe-Schalter neben dem Wert.',
        },
      ],
    },
    {
      title: 'Typspezifische Steuerung',
      blocks: [
        {
          kind: 'table',
          headers: ['Clip-Typ', 'Steuerung'],
          rows: [
            [
              'Audio',
              'Verstärkung, Ein-/Ausblenden, Tonhöhe und ein Equalizer pro Clip (siehe Audiobearbeitung).',
            ],
            [
              'Text',
              'Inhalt, Schrift, Größe, Farbe, Ausrichtung, Hintergrund, Abstand, Effekte und Animation (siehe die Seite Text).',
            ],
            ['Form', 'Formtyp, Pfad, Füllung, Kontur, Maske und weiche Kante.'],
            ['Untertitel', 'Timing und Text der Cues sowie Stilvorgaben für Untertitel.'],
            [
              'Farbe',
              'Farbräder, Kurven und Werkzeuge zur Farbkorrektur (siehe Effekte und Farbe).',
            ],
          ],
        },
      ],
    },
    {
      title: 'Marker',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Das Eigenschaften-Panel listet jeden Marker des Projekts unter der Überschrift **Marker** auf, nach Zeit sortiert. Die Liste ist immer verfügbar – sie erscheint unter den Canvas-Einstellungen, wenn nichts ausgewählt ist, und unter dem Marker-Editor, wenn ein Marker ausgewählt ist –, sodass du deine Marker unabhängig von der Auswahl durchsuchen und erreichen kannst.',
        },
        {
          kind: 'list',
          items: [
            'Jede Zeile zeigt die Markerfarbe, seine Bezeichnung (oder einen Standardnamen, falls er keine hat) und seinen Timecode.',
            'Wähle eine Zeile aus, um sie zum aktiven Marker zu machen und den Abspielkopf an diese Stelle springen zu lassen.',
            'Nutze das Papierkorb-Symbol in einer Zeile, um genau diesen Marker zu entfernen.',
            '**Alle löschen** entfernt alle Marker auf einmal.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Drücke `M`, um einen Marker am Abspielkopf zu setzen. Wenn die Liste leer ist, zeigt sie diesen Hinweis.',
        },
        {
          kind: 'paragraph',
          text: 'Wenn du einen Marker auswählst, öffnet sich sein Editor über der Liste. Dort kannst du die Position unter **Frame** ändern, die **Bezeichnung** bearbeiten und die **Farbe** aus einer Vorgabe wählen oder auf den Standard zurücksetzen. Das Feld **Zeit** zeigt den Timecode des Markers schreibgeschützt an, und **Marker löschen** entfernt ihn.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
