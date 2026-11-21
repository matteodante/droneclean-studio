import type { DocPageContent } from '../../docs-content'

// order 11.5 places this right after Text, Captions, and Subtitles in Creative Tools.
const page = {
  order: 11.5,
  slug: 'shapes-masks',
  title: 'Formen und Masken',
  description:
    'Formelemente hinzufügen, mit dem Stift-Werkzeug eigene Pfade zeichnen und jede Form als Clip-Maske verwenden.',
  category: 'Creative Tools',
  related: ['motion', 'properties', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Eine Form hinzufügen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Öffne den Tab **Formen** und klicke auf eine Form, um sie am Abspielkopf hinzuzufügen, oder ziehe sie auf eine bestimmte Spur.',
            'Eingebaute Formen: **Rechteck**, **Kreis**, **Ellipse**, **Dreieck**, **Stern**, **Polygon** und **Herz**.',
            'Eine neue Form landet in der Größe des Canvas und ausgewählt, bereit zum Positionieren und Gestalten.',
          ],
        },
      ],
    },
    {
      title: 'Eine Form gestalten',
      blocks: [
        {
          kind: 'table',
          headers: ['Regler', 'Hinweise'],
          rows: [
            ['Typ', 'Zwischen den sieben Formtypen wechseln.'],
            ['Füllung', 'Eine Vollton- oder Verlaufsfüllung.'],
            [
              'Konturbreite / Kontur',
              'Breite der Umrisslinie (0–50 px) und ihre Farbe (angezeigt, wenn die Breite über 0 liegt).',
            ],
            [
              'Linienende / Linienverbindung',
              'Enden der Kontur und die Art, wie verbundene Konturabschnitte aufeinandertreffen.',
            ],
            [
              'Pfade trimmen',
              'Regler für Anfang, Ende und Versatz, um nur einen Teil eines Pfads zu zeichnen.',
            ],
            ['Verjüngung', 'Anfangs- und Endbreite für eine sich verjüngende Kontur.'],
            ['Radius', 'Eckenrundung (0–100 px) für Rechteck, Dreieck, Stern und Polygon.'],
            ['Spitzen / Innenradius', 'Anzahl der Spitzen und Innenradius, für Stern und Polygon.'],
            ['Richtung', 'In welche Richtung ein Dreieck zeigt.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Position, Größe, Drehung und Deckkraft liegen in der Steuerung Transformation, und die meisten Werte lassen sich per Keyframe animieren – siehe [Keyframe-Animation](keyframes).',
        },
      ],
    },
    {
      title: 'Pfadpunkte in Motion animieren',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Öffne die Form in **Motion** und klappe ihre Eigenschaftszeilen auf.',
            'Wähle Pfadpunkte in der Vorschau aus.',
            'Wähle **Ausgewählte Punkte**, um nur diese Punkte zu keyen, oder **Alle Punkte**, um jeden Punkt bereitzustellen.',
            'Füge den Koordinaten der Punkte Keys hinzu und bewege den Abspielkopf, bevor du den Pfad umformst.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Keys der Pfadgeometrie sperren die Pfadtopologie. Entferne sie, bevor du den ersten Punkt hinzufügst, entfernst, umordnest oder änderst.',
        },
      ],
    },
    {
      title: 'Mit dem Stift-Werkzeug einen eigenen Pfad zeichnen',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Wähle im Tab Formen das Werkzeug **Stift**, um eine eigene Pfadform zu zeichnen.',
            'Klicke in die Vorschau, um Punkte zu setzen; klicke und ziehe einen Punkt, um gekrümmte (Bezier-)Griffe herauszuziehen.',
            'Die Rücktaste entfernt den letzten Punkt, und Escape bricht ab.',
            'Wähle bei mindestens drei Punkten **Form abschließen**, um sie zu übernehmen (oder **Abbrechen**).',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Um einen Pfad später umzuformen, wähle ihn aus und nutze **Pfad bearbeiten**: Ziehe Punkte und Griffe, doppelklicke auf eine Kante, um einen Punkt hinzuzufügen, und wandle einen Punkt zwischen **Ecke** und **Bezier-Kurve** um. Wähle **Fertig**, wenn du fertig bist.',
        },
      ],
    },
    {
      title: 'Eine Form als Maske verwenden',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Platziere die Form auf einer Spur **über** dem Clip, den du maskieren willst.',
            'Schalte im Abschnitt Form **Als Maske verwenden** ein.',
            'Wähle einen **Maskentyp**: **Beschnitt** für harte Kanten oder **Alpha** für weiche Kanten.',
            'Passe bei einer Alpha-Maske die **Weiche Kante** an, um die Kante weicher zu machen; mit **Umkehren** blendest du den Bereich der Form aus, statt ihn sichtbar zu machen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Eine Maske wirkt gemäß der Formgeometrie auf alles auf den Spuren darunter. Die weiche Kante gilt nur für Alpha-Masken – Beschnitt-Masken bleiben hartkantig.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Während du eine Maske bearbeitest oder mit dem Stift zeichnest, ist der Rest des Editors gesperrt – beende oder verlasse die Maskenbearbeitung, um fortzufahren.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
