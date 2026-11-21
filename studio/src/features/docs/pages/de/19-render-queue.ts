import type { DocPageContent } from '../../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: 'Render-Warteschlange',
  description:
    'Mehrere Exporte einreihen, ein Rendering in Segmente aufteilen, die Warteschlange verwalten und gespeicherte Dateien finden.',
  category: 'Output',
  related: ['export'],
  sections: [
    {
      title: 'Exporte einreihen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Wähle im Exportdialog **Zur Warteschlange hinzufügen**, statt sofort zu rendern.',
            'Reihe das gesamte Projekt oder den aktuellen Bereich ein.',
            'Öffne die Warteschlange jederzeit über die Schaltfläche **Render-Warteschlange** in der Symbolleiste, die einen aktuellen Zähler der Aufträge zeigt.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Eingereihte Exporte werden nacheinander gerendert und im Exportordner deines Arbeitsbereichs gespeichert.',
        },
      ],
    },
    {
      title: 'In Segmente aufteilen',
      blocks: [
        {
          kind: 'list',
          items: [
            '**In Segmente aufteilen** macht aus einem Rendering mehrere Aufträge.',
            'Nutze **Ein Segment pro Marker**, um das Rendering an deinen Markern der Zeitleiste aufzuteilen.',
            'Oder teile in feste Abschnitte mit einer festgelegten Anzahl von Sekunden auf.',
          ],
        },
      ],
    },
    {
      title: 'Die Warteschlange verwalten',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Pausieren** und **Fortsetzen** der Warteschlange steuern, wann gerendert wird.',
            'Verschiebe einen eingereihten Auftrag mit **Nach oben** oder **Nach unten**, um seine Reihenfolge zu ändern.',
            '**Abbrechen** eines laufenden oder eingereihten Auftrags, **Wiederholen** eines fehlgeschlagenen und **Entfernen** fertiger Aufträge.',
            'Der Auftragsstatus lautet In Warteschlange, Wird gerendert, Fertig, Fehlgeschlagen oder Abgebrochen; mit **Abgeschlossene löschen** oder **Alle löschen** räumst du auf.',
          ],
        },
      ],
    },
    {
      title: 'Gespeicherte Exporte',
      blocks: [
        {
          kind: 'list',
          items: [
            'Wechsle zum Tab **Gespeicherte Exporte**, um fertige Dateien zu sehen.',
            'Lade einen gespeicherten Export von dort herunter oder lösche ihn.',
            'Die Dateien liegen in diesem Projektordner innerhalb deines Arbeitsbereichs.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
