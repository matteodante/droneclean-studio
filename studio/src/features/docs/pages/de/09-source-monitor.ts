import type { DocPageContent } from '../../docs-content'

const page = {
  order: 9,
  slug: 'source-monitor',
  title: 'Arbeiten mit dem Quellmonitor',
  description:
    'Eine Quelle ansehen, einen In/Out-Bereich markieren, Patch-Ziele wählen und auf der Zeitleiste einfügen oder überschreiben.',
  category: 'Core Editing',
  related: ['media', 'timeline', 'scene-browser'],
  sections: [
    {
      title: 'Eine Quelle öffnen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Doppelklicke auf eine Medienkarte oder nutze **Im Quellmonitor öffnen** in den Medieninformationen, um eine Quelle zu laden.',
            'Die Kopfzeile des Monitors zeigt den Dateinamen der Quelle, mit einem Schließen-Symbol, um sie zu verlassen.',
            'Die Quellwiedergabe ist unabhängig von der Zeitleisten-Vorschau, sodass du eine Quelle durchfahren kannst, ohne den Abspielkopf der Zeitleiste zu bewegen.',
            'Klicke auf die Timecode-Anzeige, um zwischen Timecode und Bildnummern umzuschalten.',
          ],
        },
      ],
    },
    {
      title: 'Einen In/Out-Bereich markieren',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Gehe zum ersten gewünschten Bild und drücke `I` (**In-Punkt markieren**).',
            'Gehe zu dem Bild nach deinem letzten gewünschten Bild und drücke `O` (**Out-Punkt markieren**) – der Out-Punkt ist exklusiv.',
            'Feinjustiere, indem du den In-Griff, den Out-Griff oder den ganzen Bereich auf dem Streifen ziehst.',
            'Nutze **Von In bis Out abspielen**, um nur den Bereich zu prüfen, oder `Alt+X`, um ihn zu löschen und die gesamte Quelle zu verwenden.',
          ],
        },
      ],
    },
    {
      title: 'Patch-Ziele wählen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Der Schalter **V** schaltet das Video-Quell-Patch-Ziel ein oder aus; der Schalter **A** tut dasselbe für Audio.',
            'Jeder Schalter hat eine Zielauswahl: **Auto**, eine bestimmte Spur nach Namen oder **Beim Schnitt erstellen**, um eine neue Spur anzulegen.',
            'Video mit Ton platziert ein verknüpftes Video-und-Audio-Paar über die Zielspuren V und A.',
            'Die aktive Zeitleistenspur füllt die passenden Ziele V und A vor.',
          ],
        },
      ],
    },
    {
      title: 'Einfügen und Überschreiben',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Beide Bearbeitungen platzieren den markierten Bereich am aktuellen Frame des Abspielkopfs der Zeitleiste und setzen den Abspielkopf danach an das Ende des neuen Clips.',
        },
        {
          kind: 'table',
          headers: ['Bearbeitung', 'Taste', 'Was sie bewirkt'],
          rows: [
            [
              'Einfügen',
              '`,`',
              'Setzt den Bereich ein und schiebt das gesamte spätere Material auf den Zielspuren nach rechts.',
            ],
            [
              'Überschreiben',
              '`.`',
              'Ersetzt das Material der Zeitleiste unter dem Bereich und lässt umgebende Clips an ihrem Platz.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Bilder werden beim Schnitt standardmäßig zu einem Clip von **drei Sekunden**, sofern du keinen kürzeren Bereich markierst.',
        },
      ],
    },
    {
      title: 'Wenn eine Bearbeitung sich nicht anwenden lässt',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Aktiviere zuerst mindestens eines der Patch-Ziele **V** oder **A**. Um Audio zu bearbeiten, aktiviere **A**; um ein stummes Video oder ein Bild zu bearbeiten, aktiviere **V**. Auch eine gesperrte Zielspur blockiert die Bearbeitung – entsperre sie und versuche es erneut.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
