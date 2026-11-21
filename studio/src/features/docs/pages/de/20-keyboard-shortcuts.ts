import type { DocPageContent } from '../../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Tastenkürzel',
  description: 'Standardkürzel nach Gruppen, dazu wie du sie suchst, neu belegst und zurücksetzt.',
  category: 'Reference',
  sections: [
    {
      title: 'Wiedergabe',
      blocks: [
        {
          kind: 'table',
          headers: ['Aktion', 'Kürzel'],
          rows: [
            ['Abspielen / Pause', '`Space`'],
            ['Vorheriges / nächstes Bild', '`Left` / `Right`'],
            ['Vorheriger / nächster Einrastpunkt', '`Up` / `Down`'],
            ['Zum Anfang / Ende', '`Home` / `End`'],
          ],
        },
      ],
    },
    {
      title: 'Bearbeiten',
      blocks: [
        {
          kind: 'table',
          headers: ['Aktion', 'Kürzel'],
          rows: [
            ['Am Abspielkopf teilen', '`Alt+C`'],
            ['Am Cursor teilen', '`Shift+C`'],
            ['Verbinden', '`Shift+J`'],
            ['Löschen / Ripple löschen', '`Delete` / `Ctrl+Delete`'],
            ['Standbild einfügen', '`Shift+F`'],
            ['Clips verknüpfen / Verknüpfung lösen', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['Verknüpfte Auswahl umschalten', '`Shift+L`'],
            ['Um 1 px / 10 px verschieben', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: 'Werkzeuge',
      blocks: [
        {
          kind: 'table',
          headers: ['Werkzeug', 'Kürzel'],
          rows: [
            ['Auswahl', '`V`'],
            ['Trimmwerkzeug', '`T`'],
            ['Rasiermesser', '`C`'],
            ['Geschwindigkeitsdehnung', '`R`'],
            ['Slip', '`Y`'],
            ['Slide', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple und Rolling sind Trimm-Verhaltensweisen des Werkzeugs **Trimmwerkzeug**, keine eigenen Werkzeuge mit eigenem Kürzel.',
        },
      ],
    },
    {
      title: 'Verlauf, Ansicht und Zwischenablage',
      blocks: [
        {
          kind: 'table',
          headers: ['Aktion', 'Kürzel'],
          rows: [
            ['Rückgängig / Wiederholen', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['Kopieren / Ausschneiden / Einfügen', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['Einrasten / Canvas-Einrasten umschalten', '`S` / `Shift+S`'],
            ['Heranzoomen / Herauszoomen', '`Ctrl+=` / `Ctrl+-`'],
            ['Einpassen / 100 %', '`\\` / `Shift+\\`'],
            ['Arbeitsbereich Schnitt / Farbe / Motion', '`Alt+1` / `Alt+2` / `Alt+3`'],
          ],
        },
      ],
    },
    {
      title: 'Marker und Keyframes',
      blocks: [
        {
          kind: 'table',
          headers: ['Aktion', 'Kürzel'],
          rows: [
            ['Marker hinzufügen / entfernen', '`M` / `Shift+M`'],
            ['Vorheriger / nächster Marker', '`[` / `]`'],
            ['Keyframes löschen', '`Shift+A`'],
            ['Keyframe zur ausgewählten Ebene im Schnitt hinzufügen', '`K`'],
            ['Keyframe-Graph- / Tabellen- / Geteilte Ansicht', '`1` / `2` / `3`'],
            ['Vorheriger / nächster Keyframe der Eigenschaft', '`Alt+[` / `Alt+]`'],
            ['Auto-Key für aktive Eigenschaft umschalten', '`A`'],
            ['Ausgewählte Keyframes einpassen', '`F`'],
          ],
        },
      ],
    },
    {
      title: 'Quellmonitor und Projekt',
      blocks: [
        {
          kind: 'table',
          headers: ['Aktion', 'Kürzel'],
          rows: [
            ['In-/Out-Punkt markieren', '`I` / `O`'],
            ['In/Out löschen', '`Alt+X`'],
            ['Vorschau rendern (von In bis Out oder die gesamte Timeline)', '`Enter`'],
            ['Einfügen / Überschreiben', '`,` / `.`'],
            ['Speichern', '`Ctrl+S`'],
            ['Exportieren', '`Ctrl+Shift+E`'],
            ['Szenenbrowser öffnen', '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: 'Kürzel anpassen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Jede Belegung oben ist ein mitgelieferter Standard. Öffne den neu gestalteten Kürzel-Editor über die Schaltfläche **Tastenkürzel** (Tastatursymbol) in der Editor-Symbolleiste, um jeden Befehl auf die gewünschten Tasten zu legen.',
        },
        {
          kind: 'steps',
          items: [
            'Suche Befehle nach Namen oder filtere auf die Gruppen **Benutzerdefiniert**, **Konflikte** oder **Nicht zugewiesen**.',
            'Wähle einen Befehl und drücke **Aufnehmen**, halte dann deine Modifikatortasten und drücke die letzte Taste.',
            'Wenn die Kombination bereits verwendet wird, markiert der Editor den Konflikt – wähle **Überschreiben**, um sie neu zuzuweisen, oder nimm andere Tasten.',
            'Nutze **Lösen**, um eine Belegung zu entfernen, oder füge neben der primären eine alternative Belegung hinzu.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Nutze **Zurücksetzen**, um einen einzelnen Befehl wiederherzustellen, oder **Alle zurücksetzen**, um jedes Kürzel auf seinen Standard zurückzusetzen. Du kannst deine Belegungen auch mit **Exportieren** in eine Vorgabedatei schreiben und mit **Importieren** auf einem anderen Rechner einlesen.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
