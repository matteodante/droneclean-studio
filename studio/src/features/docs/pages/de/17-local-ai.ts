import type { DocPageContent } from '../../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Lokale KI-Werkzeuge',
  description:
    'Text-zu-Sprache, Musikgenerierung und Transkription direkt im Browser, mit lokalem Modell-Cache.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: 'So funktioniert lokale KI',
      blocks: [
        {
          kind: 'list',
          items: [
            'KI-Werkzeuge laufen in deinem Browser auf deiner eigenen Hardware – nichts wird an einen Server gesendet.',
            'Wenn du ein Modell zum ersten Mal verwendest, wird es einmal heruntergeladen und danach lokal zur Wiederverwendung zwischengespeichert.',
            'Eine Statusanzeige zeigt die Zustände Laden, Aktiv, Bereit und Fehler, während ein Modell läuft.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Einige Werkzeuge erfordern Chrome oder Edge 113+ (oder Safari 26+) und WebGPU-Unterstützung. Der erste Modell-Download kann groß sein.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Modelllizenzen binden dich, nicht uns: Mit MusicGen erzeugte Musik ist nur für nichtkommerzielle Nutzung bestimmt (CC BY-NC 4.0), und Supertonic-Sprache steht unter der OpenRAIL-M-Lizenz, die manche Verwendungen verbietet. Der Tab KI weist darauf hin, bevor du etwas erzeugst.',
        },
      ],
    },
    {
      title: 'Text zu Sprache',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Öffne den Tab **KI** und klappe **Text zu Sprache** auf, tippe oder füge dann dein Skript ein.',
            'Wähle eine Engine (siehe Tabelle), dann eine Stimme und, wo unterstützt, Geschwindigkeit, Sprache und ausdrucksstarke Tags.',
            'Höre dir das Ergebnis an und wähle dann **Speichern und einfügen**, um verknüpftes Audio am Abspielkopf abzulegen, oder **In Bibliothek speichern**.',
          ],
        },
        {
          kind: 'table',
          headers: ['Engine', 'Sprachen', 'Läuft auf'],
          rows: [
            ['Kokoro', 'Englisch', 'WebGPU'],
            ['MOSS Nano', '20 Sprachen', 'CPU'],
            ['Supertonic 3', '31 Sprachen', 'Lokales ONNX'],
          ],
        },
      ],
    },
    {
      title: 'Musikgenerierung',
      blocks: [
        {
          kind: 'list',
          items: [
            'Klappe **Musik generieren** auf und beschreibe den Titel mit einem Prompt, oder starte mit einer Vorgabe wie Lo-fi chill oder Upbeat EDM.',
            'Lege die Länge in Sekunden fest und wähle dann **Musik generieren**; beim ersten Durchlauf wird das Modell heruntergeladen und zwischengespeichert.',
            'Höre dir den Clip an und wähle dann **Speichern und einfügen** in die Zeitleiste oder **In Bibliothek speichern**.',
          ],
        },
      ],
    },
    {
      title: 'Transkription',
      blocks: [
        {
          kind: 'list',
          items: [
            'Die Transkription liegt in der Medienbibliothek und im Transkript-Workflow, getrennt vom Tab KI.',
            '**Parakeet** ist die schnelle Standard-Engine und deckt viele europäische Sprachen ab.',
            'Whisper-Modelle (Tiny, Base, Small, Large v3 Turbo) sind ebenfalls verfügbar, und DroneClean Studio weicht bei Bedarf auf Whisper aus.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Ein Transkript speist Untertitel, die Transkriptsuche und das Entfernen von Füllwörtern – erzeuge also früh eines.',
        },
      ],
    },
    {
      title: 'Modelle und Laufzeiten verwalten',
      blocks: [
        {
          kind: 'list',
          items: [
            'Öffne die Einstellungen **Speicher**, um die lokale KI zu verwalten.',
            'Nutze den **Cache für lokale KI-Modelle**, um heruntergeladene Modelle zu prüfen oder zu leeren – nützlich, wenn ein Download beschädigt ist.',
            'Nutze **Lokale Modelle entladen**, um Laufzeiten freizugeben und Speicher zu gewinnen.',
            'Lange Aufträge lassen sich abbrechen, wenn du das Ergebnis nicht mehr brauchst.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
