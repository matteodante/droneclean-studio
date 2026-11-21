import type { DocPageContent } from '../../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: 'Übergänge',
  description:
    'Einen Übergang auf einen Schnitt anwenden und Stil, Dauer, Platzierung, Beschleunigung und Richtung anpassen.',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Einen Übergang anwenden',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Öffne den Tab **Übergänge** in der Medien-Seitenleiste.',
            'Ziehe eine Übergangskarte auf einen Schnitt zwischen zwei benachbarten Clips – oder wähle einen gültigen Schnitt aus und klicke auf eine Karte.',
            'Wähle den Übergang auf der Zeitleiste aus, um den Abschnitt **Übergang** in den Eigenschaften zu öffnen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ein Schnitt ist gültig, wenn zwei Clips Kante an Kante liegen und genügend Reserve-Quellframes zum Überlappen haben. Wenn du einen vorhandenen Übergang überschreibst, wird er an Ort und Stelle ersetzt.',
        },
      ],
    },
    {
      title: 'Einen Look wählen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Die Karten sind nach Kategorie gruppiert: **Standard**, **Überblendung**, **Bewegung**, **Wischen**, **Schieben**, **Drehen**, **Maske**, **Blende**, **Form**, **Licht** und **Chromatisch**.',
        },
        {
          kind: 'list',
          items: [
            'Die Überblendungs-Stile reichen von einer einfachen Cross Dissolve bis zu den Varianten Additive, Blur und Dip To Color.',
            'Zu den Bewegungs- und benutzerdefinierten Stilen gehören Flip, Light Leak, Pixelate, Chromatic, Radial Blur, Glitch und Sparkles.',
            'Gerichtete Stile wie Wischen, Schieben und Drehen erscheinen als mehrere Karten, eine pro Richtung.',
          ],
        },
      ],
    },
    {
      title: 'Einen Übergang anpassen',
      blocks: [
        {
          kind: 'table',
          headers: ['Regler', 'Was er bewirkt'],
          rows: [
            ['Voreinstellung', 'Den Übergangsstil tauschen, ohne den Schnitt neu zu machen.'],
            [
              'Dauer',
              'Festlegen, wie lange der Übergang läuft; Zurücksetzen stellt 1 Sekunde wieder her.',
            ],
            [
              'Platzierung',
              'Auf dem Schnitt zentrieren oder den Übergang davor oder danach verschieben.',
            ],
            ['Beschleunigung', 'Linear, Ein, Aus oder Ein und Aus.'],
            ['Richtung', 'Links, Rechts, Oben oder Unten, für gerichtete Stile.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Du kannst die Länge eines Übergangs auch ändern, indem du seine Kante direkt auf der Zeitleiste ziehst.',
        },
      ],
    },
    {
      title: 'Wenn sich ein Übergang nicht anwenden lässt',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Du brauchst einen echten Schnitt zwischen zwei Clips und genügend **Quellreserve** auf der betreffenden Seite. Wenn eine Platzierung blockiert ist, wähle eine andere Platzierung oder trimme weniger. Das Ziehen auf einen gültigen Schnitt funktioniert immer, auch wenn das Anwenden per Klick nicht verfügbar ist.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
