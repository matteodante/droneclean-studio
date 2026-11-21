import type { DocPageContent } from '../../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: 'Exportieren',
  description:
    'Video oder Audio im Browser rendern, Formate und Bereich wählen und Warnungen der Vorabprüfung beheben.',
  category: 'Output',
  related: ['render-queue', 'text-captions-subtitles', 'troubleshooting'],
  sections: [
    {
      title: 'Einen Export einrichten',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Öffne **Exportieren** (`Ctrl+Shift+E`) und wähle **Video exportieren** oder **Audio exportieren**.',
            'Rendere das gesamte Projekt oder den aktuellen In/Out-Bereich, wenn du nur einen Abschnitt brauchst.',
            'Stelle **Auflösung** und **Qualität** passend zum Ziel ein: eine schnelle Durchsicht, eine teilbare Datei oder ein finales Master.',
            'Behebe alle Warnungen der Vorabprüfung und rendere dann.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Höhere Auflösung und Qualität dauern länger und erzeugen größere Dateien.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Wenn ein Projekt mehr als die Haupt-Zeitleiste hat, wählt ein Menü **Sequenz** oben im Dialog, welche Zeitleiste exportiert wird – mit ihrer eigenen Auflösung und ihrem eigenen Bereich.',
        },
      ],
    },
    {
      title: 'Formate',
      blocks: [
        {
          kind: 'table',
          headers: ['Ausgabe', 'Formate'],
          rows: [
            ['Video-Container', 'MP4, MOV, WebM, MKV'],
            ['Nur Audio', 'MP3, AAC, WAV'],
            ['Weiche Untertitelspur', 'WebM, MKV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Welche Codecs verfügbar sind, hängt von deinem Browser ab; DroneClean Studio warnt oder weicht aus, wenn einer fehlt.',
        },
      ],
    },
    {
      title: 'Untertitel',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Wenn ein Videoexport ein Transkript hat, legt die Steuerung **Untertitel** fest, wie Untertitel enthalten sind. Die Optionen passen sich dem gewählten Container an.',
        },
        {
          kind: 'table',
          headers: ['Modus', 'Was er bewirkt'],
          rows: [
            ['**Aus**', 'Keine Untertitel im exportierten Video.'],
            [
              '**Einbrennen**',
              'Untertitel werden ins Bild gezeichnet und sind daher in jedem Player zu sehen.',
            ],
            [
              '**Separate** `.srt`',
              'Sauberes Video plus eine separate `.srt`-Untertiteldatei, die zusammen mit ihm heruntergeladen wird.',
            ],
            [
              '**Eingebettete Spur**',
              'Eine weiche, umschaltbare Untertitelspur, die im Container mitgeführt wird.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Die Option „Eingebettete Spur“ erscheint nur bei `WebM` und `MKV`. Wähle bei `MP4` und `MOV` das Einbrennen oder eine separate Datei, oder wechsle den Container für eine umschaltbare Spur.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Manche Player blenden Untertitelspuren standardmäßig aus, sodass Zuschauer sie womöglich aktivieren müssen.',
        },
      ],
    },
    {
      title: 'Vorabprüfung',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Die Vorabprüfung läuft vor dem Rendern und meldet häufige Blockaden: einen leeren Bereich, fehlende Medien, einen nicht verfügbaren Codec, einen Fallback beim Worker-Export, eine große Datei oder ein langes Rendern.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Für einen schnellen Plausibilitätstest exportiere zuerst einen kurzen In/Out-Bereich, bevor du das komplette Rendern startest.',
        },
      ],
    },
    {
      title: 'Rendern und herunterladen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Der Fortschritt durchläuft Vorbereiten, Rendern, Codieren und Abschließen, und du kannst jederzeit **Abbrechen**.',
            'Der Worker-Export läuft, wenn verfügbar, im Hintergrund; ein Fallback im Hauptthread braucht den Tab im Fokus und ruhig.',
            'Wenn er fertig ist, wähle **Herunterladen**, um die Datei zu speichern, die zusätzlich in den Exportordner deines Arbeitsbereichs geschrieben wird.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Lass den Projekt-Tab geöffnet, bis der Export fertig ist. Um mehrere Renderings gesammelt zu erledigen, füge sie der **Render-Warteschlange** hinzu, statt einzeln zu exportieren.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
