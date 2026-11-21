import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Mit Keyframes animieren',
  description:
    'Transformations-, Zuschneide-, Text-, Effekt- und Audiowerte mit Keyframes, Easing und dem Kurveneditor animieren.',
  category: 'Creative Tools',
  related: ['motion', 'motion-library', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Wählen, wo du Keyframes bearbeitest',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Der Schnitt hält die Keyframe-Arbeit kompakt. Motion bietet das vollständige Dope Sheet und den Graphen der Ebenen für tiefergehende Arbeit an Timing und Kurven.',
        },
        {
          kind: 'table',
          headers: ['Bereich', 'Keyframe-Workflow'],
          rows: [
            [
              'Schnitt',
              'Wähle einen Clip aus und drücke `K`, um einen Key für die aktive Eigenschaft zu setzen. Öffne **Animation** in den Eigenschaften für Vorgaben und den Status angewendeter Animationen.',
            ],
            [
              'Motion',
              'Klappe eine Ebene auf für Eigenschaftszeilen, Keyframe-Rauten, Segment-Easing und einen eingebetteten Wertegraphen.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'In Motion nutzen der gemeinsame Abspielkopf, die Auswahl, das Einrasten, das Lineal, die Eigenschaftsspuren und der Graph dieselbe Zeitachse.',
        },
      ],
    },
    {
      title: 'Einen Keyframe hinzufügen',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Setze den Abspielkopf auf das Bild, das du keyen willst.',
            'Tippe neben einem Parameter einen Wert ein und drücke `Enter`, oder klicke auf die **Raute** in der Parameterzeile.',
            'Gehe zu einem anderen Bild und setze einen zweiten Wert, um dazwischen Bewegung zu erzeugen.',
            'Schalte **Auto-Key** mit dem Timer-Symbol ein, oder drücke `A`, um spätere Wertänderungen automatisch aufzunehmen.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Du kannst keinen Keyframe innerhalb eines Übergangsbereichs setzen oder wenn der Abspielkopf außerhalb der Clipgrenzen steht – die Raute ist dort deaktiviert.',
        },
      ],
    },
    {
      title: 'Was du animieren kannst',
      blocks: [
        {
          kind: 'table',
          headers: ['Clip-Typ', 'Animierbare Werte'],
          rows: [
            [
              'Alle visuellen Clips',
              'X-/Y-Position, Breite, Höhe, Drehung, Deckkraft, Eckenradius',
            ],
            [
              'Video',
              'Zusätzlich Ankerpunkt, die vier Zuschneidekanten, Weichheit des Zuschnitts und Lautstärke',
            ],
            [
              'Text',
              'Zusätzlich Vorgaben-Skalierung, Schriftgröße, Zeilenhöhe, Innenabstand, Hintergrundradius, Schatten und Kontur',
            ],
            ['Audio', 'Lautstärke in Dezibel'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Auch Effekte bringen eigene animierbare Parameter mit – achte auf den Keyframe-Schalter neben jedem Regler.',
        },
      ],
    },
    {
      title: 'Die Bewegung formen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Klicke auf den **Verbinder** zwischen zwei Keyframes, um den **Easing-Editor** zu öffnen.',
            'Durchsuche Vorgabekurven unter **Kubisch** und **Feder**. Filtere nach **Alle**, **Ein**, **Aus** oder **Ein/Aus**.',
            'Wähle **Halten**, um den früheren Wert bis zum nächsten Key beizubehalten.',
            'Wechsle zu **Bearbeiten**, um die Kurve direkt zu formen: Ziehe die beiden Kontrollgriffe im Graphen oder tippe exakte Werte ein. Federn bieten **Spannung**, **Reibung** und **Masse** und zeigen ihr echtes Nachfedern in der Vorschau.',
            'Spüre das Timing bei **Position**, **Skalierung**, **Drehung** oder **Deckkraft** in der Live-Vorschau und halte die Schleife mit **Pause** an.',
            'Speichere eine angepasste Kurve mit **Speichern unter** als **eigene Vorgabe**, überschreibe sie später mit **Aktualisieren** oder kehre mit **Zurücksetzen** zur Vorgabe zurück, von der sie stammt. Eigene Vorgaben werden auf deinem Gerät gespeichert und erscheinen in jedem Projekt.',
            'Kopiere, schneide aus, füge ein und lösche Keyframes, wähle Gruppen per Auswahlrahmen aus, ziehe zum Neu-Timen und ziehe mit `Alt`, um zu duplizieren.',
          ],
        },
      ],
    },
    {
      title: 'Im Wertegraphen arbeiten',
      blocks: [
        {
          kind: 'list',
          items: [
            'Wähle eine Eigenschaft im Dropdown, um ihre Kurve zu bearbeiten, oder lass es auf Alle, um die anderen als verblasste Überlagerungskurven zu sehen. Die Zahl der Keyframes der aktiven Eigenschaft steht daneben.',
            'Der Graph zeichnet ein beschriftetes **Raster** – Frames oder Sekunden quer, Werte nach oben –, sodass du Positionen auf einen Blick ablesen kannst.',
            'Rahme die Kurve mit **Auf Inhalt einpassen** ein oder verschiebe die Ansicht mit **Heranzoomen** / **Herauszoomen** und dem Mausrad. **Ansicht zurücksetzen** kehrt zur Standardeinpassung zurück.',
            'Gehe mit den Pfeilen **Vorheriger** / **Nächster** durch die Keys und tippe dann für den ausgewählten Keyframe ein exaktes Bild (**F**) und einen exakten Wert (**V**) ein.',
            'Halte beim Ziehen eines Keyframes **Shift**, um ihn auf eine Achse zu sperren, oder **Alt** zum Feinjustieren.',
          ],
        },
      ],
    },
    {
      title: 'Erzeugte Bewegung umwandeln und bereinigen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Live-Verhalten wie Drift, Atmen, Wackeln und Drehen werden während der Wiedergabe ausgewertet, ohne Eigenschafts-Keys zu erzeugen.',
        },
        {
          kind: 'list',
          items: [
            'Wähle **In Keyframes backen**, um Live-Verhalten von Ebenen in bearbeitbare Keys umzuwandeln.',
            'Nutze **Angewendet**, um zu manuellen Keys oder zum ersten Frame einer erzeugten Vorgabe zu navigieren.',
            'Nutze **Animation trimmen**, wenn ein Clip-Trim gespeicherte Keys außerhalb seiner sichtbaren Dauer zurücklässt.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Lies [Bewegung anwenden und wiederverwenden](motion-library) zu Vorgaben, Live-Verhalten, Textbewegung, Backen und gespeicherten Animationen.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
