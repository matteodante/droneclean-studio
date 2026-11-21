import type { DocPageContent } from '../../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Projekte',
  description:
    'Projekte erstellen, konfigurieren, duplizieren, ordnen, löschen, wiederherstellen und verschieben.',
  category: 'Start',
  related: ['workspaces', 'editor'],
  sections: [
    {
      title: 'Ein Projekt erstellen und konfigurieren',
      blocks: [
        {
          kind: 'list',
          items: [
            'Erstelle ein Projekt auf der Projektseite mit **Neues Projekt**.',
            'Lege Projektname, Beschreibung, Auflösung, Bildrate und Hintergrundfarbe fest.',
            'Auflösung und Bildrate bestimmen die Export-Leinwand und das Timing der Zeitleiste – wähle sie passend zu deinem Zielformat.',
            'Die Projektspezifikationen kannst du später über die Symbolleiste des Editors erneut aufrufen.',
          ],
        },
      ],
    },
    {
      title: 'Canvas-Größe und Seitenverhältnis',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Der Canvas legt den Bildausschnitt fest, in dem dein Video komponiert und exportiert wird. Wähle beim Erstellen eines Projekts eine Größe, oder ändere sie jederzeit beim Bearbeiten im Panel **Canvas**.',
        },
        {
          kind: 'paragraph',
          text: 'Bei **Neues Projekt** bietet der Abschnitt **Auflösung** fertige Vorgaben für gängige Plattformen. Jede Vorgabe zeigt Pixelgröße und Seitenverhältnis. Wähle **Benutzerdefiniert**, um stattdessen eine exakte Breite und Höhe einzugeben.',
        },
        {
          kind: 'table',
          headers: ['Vorgabe', 'Auflösung', 'Seitenverhältnis'],
          rows: [
            ['YouTube 1080p', '`1920x1080`', '`16:9` Querformat'],
            ['Shorts / TikTok / Reels', '`1080x1920`', '`9:16` Hochformat'],
            ['Instagram Square', '`1080x1080`', '`1:1` quadratisch'],
            ['Instagram Portrait', '`1080x1350`', '`4:5` Hochformat'],
            ['Twitter/X', '`1200x675`', '`16:9` Querformat'],
            ['LinkedIn', '`1200x627`', 'Querformat'],
            ['Benutzerdefiniert', 'Deine eigenen Werte', 'Alles, was du eingibst'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'So änderst du die Größe, nachdem das Projekt existiert:',
        },
        {
          kind: 'steps',
          items: [
            'Hebe die Auswahl aller Clips auf, damit die Eigenschaften-Seitenleiste das Panel **Canvas** zeigt.',
            'Bearbeite die Felder **W** und **H**, um Breite und Höhe des Bildes in Pixeln festzulegen.',
            'Mit **Tauschen** vertauschst du Breite und Höhe, zum Beispiel um ein Querformat-Projekt in ein Hochformat-Projekt zu verwandeln.',
            'Mit **Zurücksetzen** stellst du den Canvas wieder auf `1920x1080`.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Die Abmessungen rasten auf gerade Zahlen ein und reichen von `320x240` bis `7680x4320`. Vorhandene Clips behalten beim Ändern des Canvas ihre aktuelle Position und Skalierung, positioniere daher alles neu, was nun außerhalb des neuen Bildes liegt.',
        },
      ],
    },
    {
      title: 'Die Projektliste ordnen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Durchsuche Projekte nach Namen und sortiere oder filtere die Liste, wenn sie wächst.',
            'Nutze Vorschaubilder und Metadaten, um das Projekt zu finden, an dem du zuletzt gearbeitet hast.',
            'Der aktive Arbeitsbereich wird auf der Projektseite angezeigt, sodass du immer weißt, wo die Projekte gespeichert sind.',
            'Nutze **Duplizieren**, um eine Variante abzuzweigen, ohne das Original anzufassen.',
          ],
        },
      ],
    },
    {
      title: 'Papierkorb und Wiederherstellen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Beim Löschen wandert ein Projekt in den **Papierkorb**, statt sofort entfernt zu werden.',
            'Stelle ein Projekt im Bereich Papierkorb wieder her, solange es noch dort liegt.',
            '**Papierkorb leeren** löscht Projekte im Papierkorb und alle Medien, auf die ausschließlich sie verweisen, endgültig.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Das endgültige Löschen lässt sich nicht rückgängig machen. Prüfe daher den Namen, bevor du den Papierkorb leerst.',
        },
      ],
    },
    {
      title: 'Arbeit zwischen Arbeitsbereichen verschieben',
      blocks: [
        {
          kind: 'list',
          items: [
            'Nutze **Projekt exportieren**, um ein Bundle zu erstellen, das das Projekt samt Medien enthält.',
            'Importiere ein Bundle in einen anderen Arbeitsbereich, um denselben Schnitt auf einem anderen Rechner oder in einem anderen Ordner fortzusetzen.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Bundles sind der sichere Weg, ein Projekt an jemand anderen weiterzugeben, denn sie transportieren die verknüpften Medien zusammen mit der Zeitleiste.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
