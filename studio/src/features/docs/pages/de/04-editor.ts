import type { DocPageContent } from '../../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Editor-Layout und Navigation',
  description:
    'Die Symbolleiste, die Medien-Seitenleiste, der Vorschaumonitor, die Zeitleiste, die Eigenschaften und die Arbeitsbereiche Schnitt, Farbe und Motion.',
  category: 'Start',
  related: ['concepts', 'timeline', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Die wichtigsten Bereiche',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Editor-Symbolleiste** (oben): Zurück zu Projekten, Arbeitsbereich-Tabs, Projektspezifikationen, Sprache, Einstellungen, Tastenkürzel, Speichern, Exportieren und die Render-Warteschlange.',
            '**Medien-Seitenleiste** (links): deine Assets und Erstellungswerkzeuge.',
            '**Vorschaumonitor**: das aktuelle Bild mit Overlays, Masken, Scopes und Wiedergabesteuerung.',
            '**Zeitleiste** (unten): Spuren, Clips, Marker und Schnittwerkzeuge.',
            '**Eigenschaften**-Panel: bearbeitet den oder die Clips, die du ausgewählt hast.',
          ],
        },
      ],
    },
    {
      title: 'Die Tabs der Medien-Seitenleiste',
      blocks: [
        {
          kind: 'table',
          headers: ['Tab', 'Inhalt'],
          rows: [
            [
              'Medien',
              'Importierte Assets, Medieninformationen, Proxys, Transkripte, Untertitel, Compound-Clips, Steuerung für fehlende Medien',
            ],
            ['Text', 'Text-Clips aus Vorlagen mit einem oder mehreren Abschnitten'],
            ['Formen', 'Erzeugte Formelemente'],
            ['Effekte', 'GPU-Effekte für den ausgewählten Clip'],
            ['Übergänge', 'Übergänge, die du auf Schnitte ziehst'],
            ['KI', 'Lokale Text-zu-Sprache- und Musikgenerierung'],
          ],
        },
      ],
    },
    {
      title: 'Arbeitsbereiche',
      blocks: [
        {
          kind: 'list',
          items: [
            'Der Arbeitsbereich **Schnitt** (`Alt+1`) ist das Standardlayout zum Schneiden: Anordnen, Trimmen, Text, Formen, Effekte, Übergänge und Vorschau.',
            'Der Arbeitsbereich **Farbe** (`Alt+2`) konzentriert sich auf die Farbkorrektur, mit Farbrädern, Kurven und Scopes für den ausgewählten Clip.',
            'Der Arbeitsbereich **Motion** vereint geschichtete Kompositionen, Keyframes, Graphen, Vorgaben und prozedurale Animation – siehe [Motion-Arbeitsbereich](motion).',
            'Wähle im Schnitt einen visuellen Clip aus und öffne in den Eigenschaften **Animation** für gängige Vorgaben, den Status angewendeter Animationen, Textbewegung und **Motion-Clip erstellen**.',
            'Wechsle die Arbeitsbereiche über die Tabs in der Mitte der Symbolleiste oder mit `Alt+1`, `Alt+2` und `Alt+3`.',
          ],
        },
      ],
    },
    {
      title: 'Hilfe finden und sicher arbeiten',
      blocks: [
        {
          kind: 'list',
          items: [
            'Öffne **Einstellungen** für allgemeine, Zeitleisten-, KI- und Speichereinstellungen.',
            'Öffne **Tastenkürzel**, um Befehle zu suchen, Tasten neu zu belegen und Vorgaben zu importieren oder zu exportieren.',
            'Speichere oft mit `Ctrl+S`; das automatische Speichern kann zusätzlich in einem Intervall laufen, das du in den Einstellungen festlegst.',
            'Rückgängig und Wiederholen (`Ctrl+Z` und `Ctrl+Shift+Z`) decken Zeitleisten-Änderungen ab, wenn etwas schiefgeht.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
