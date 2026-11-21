import type { DocPageContent } from '../../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: 'Szenenbrowser und KI-Analyse',
  description:
    'Medien lokal analysieren, um Szenen zu beschriften, und dann nach Schlagwort, Bedeutung oder Farbe suchen.',
  category: 'Creative Tools',
  related: ['media', 'local-ai', 'source-monitor'],
  sections: [
    {
      title: 'Mit KI analysieren',
      blocks: [
        {
          kind: 'list',
          items: [
            'Führe **Mit KI analysieren** für einen Clip in der Medienbibliothek aus, oder über das Menü **Analysieren** im Szenenbrowser.',
            'Der Durchlauf läuft vollständig auf deinem Rechner: Er erkennt Szenen, beschriftet jede einzelne, extrahiert eine Farbpalette und erstellt Text- und Bild-Embeddings.',
            'Wähle **Neue Medien analysieren** für Clips ohne Beschriftungen oder **Alles erneut analysieren**, um alles aufzufrischen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ergebnisse werden nach Inhalt zwischengespeichert, sodass identische Medien wiederverwendet statt erneut analysiert werden.',
        },
      ],
    },
    {
      title: 'Den Szenenbrowser öffnen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Öffne den Szenenbrowser über die Medienbibliothek oder mit `Ctrl+Shift+F`.',
            'Er durchsucht die KI-Beschriftungen und Szenendaten, die „Mit KI analysieren“ erzeugt hat.',
            'Lege den Umfang auf alle analysierten Medien oder einen einzelnen Clip fest und sortiere nach **Relevanz**, **Zeitstempel** oder **Medienname**.',
            'Wechsle zwischen **Listenansicht** und **Rasteransicht**, je nachdem, ob du stöbern oder überfliegen willst.',
          ],
        },
      ],
    },
    {
      title: 'Suchmodi',
      blocks: [
        {
          kind: 'table',
          headers: ['Modus', 'Trifft nach'],
          rows: [
            [
              'Schlagwort',
              'Den exakten Wörtern einer Beschriftung – gut für ein bestimmtes Objekt oder Label.',
            ],
            [
              'Semantisch',
              'Bedeutung, sodass „Sonnenuntergang über dem Wasser“ verwandte Szenen findet (bei der ersten Nutzung wird ein kleines Modell geladen, ca. 22 MB).',
            ],
            [
              'Farbe',
              'Einer ähnlichen Palette – wähle ein Farbfeld aus der Palette der Bibliothek.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ergebnisse tragen Treffer-Abzeichen – Stark, Gut oder Okay – und vermerken, ob der Treffer über Schlagwort, Bedeutung, visuelle Ähnlichkeit oder Farbe zustande kam.',
        },
      ],
    },
    {
      title: 'Ein Ergebnis verwenden',
      blocks: [
        {
          kind: 'list',
          items: [
            'Klicke auf eine Szene, um sie im Quellmonitor in der Vorschau zu sehen.',
            'Ziehe eine Szene auf die Zeitleiste, um diesen Moment in deinen Schnitt zu übernehmen.',
            'Wenn nichts gefunden wird, prüfe, ob der Clip analysiert wurde – nur analysierte Medien sind durchsuchbar.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
