import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Erste Schritte',
  description:
    'Was DroneClean Studio ist, was dein Browser braucht und dein erster Schnitt vom Start bis zum Export.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'Was DroneClean Studio ist',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio ist ein **Local-first**-Videoeditor, der vollständig in deinem Browser läuft – ohne Konto, ohne Upload und ohne Server-Rendering. Schnitt, Effekte, Farbe, KI-Werkzeuge und Export laufen komplett auf deinem eigenen Rechner mit deiner GPU und CPU.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Deine Medien bleiben auf deinem Gerät. DroneClean Studio verknüpft die Originaldateien und schreibt Projekte, Caches und Exporte in einen **Arbeitsbereich-Ordner**, den du auswählst – nichts wird in die Cloud gesendet.',
        },
      ],
    },
    {
      title: 'Was dein Browser braucht',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio setzt auf moderne Web-APIs, daher ist ein aktueller Chromium-Browser der unterstützte Weg.',
        },
        {
          kind: 'table',
          headers: ['Browser', 'Status'],
          rows: [
            ['Chrome / Edge 113+', 'Vollständig unterstützt'],
            [
              'Brave',
              'Funktioniert, nachdem du das Flag für die File System Access API aktiviert hast',
            ],
            ['Safari / Firefox', 'Für den vollständigen Workflow noch nicht unterstützt'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio nutzt die File System Access API (Arbeitsbereich-Ordner), WebCodecs (Decodierung und Export), WebGPU (Effekte, Farbe, KI) und OPFS (Caches). Lass die Hardwarebeschleunigung eingeschaltet und halte die GPU-Treiber aktuell.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave kann den Ordnerzugriff blockieren. Öffne `brave://flags/#file-system-access-api`, stelle es auf **Enabled** und starte Brave neu.',
        },
      ],
    },
    {
      title: 'Dein erster Schnitt',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Öffne DroneClean Studio in einem unterstützten Browser und wähle, wenn du dazu aufgefordert wirst, einen **Arbeitsbereich-Ordner**, den du lesen und beschreiben kannst.',
            'Wähle auf der Projektseite **Neues Projekt** und lege Auflösung und Bildrate für den Schnitt fest.',
            'Öffne den Tab **Medien** und füge mit **Importieren** Dateien hinzu, oder ziehe Medien direkt in die Bibliothek.',
            'Ziehe einen Clip aus dem Medien-Panel auf eine Spur der Zeitleiste.',
            'Drücke `Space` zum Abspielen und nutze `Left` und `Right`, um bildweise vor- und zurückzugehen.',
            'Speichere beim Arbeiten mit `Ctrl+S` und wähle dann **Exportieren**, um das fertige Video zu rendern.',
          ],
        },
      ],
    },
    {
      title: 'Prüfen, ob dein Setup funktioniert',
      blocks: [
        {
          kind: 'list',
          items: [
            'Die Arbeitsbereich-Auswahl öffnet sich und akzeptiert einen normalen Ordner (keinen geschützten Systemort).',
            'Importierte Medien erscheinen als Karten mit Vorschaubildern im Medien-Panel.',
            'Die Wiedergabe startet in der Zeitleiste, wenn du `Space` drückst.',
            'Der Export öffnet sich und die Vorabprüfung meldet keine blockierenden Probleme.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Wenn ein Schritt fehlschlägt, findest du auf der Seite **Fehlerbehebung** das passende Symptom.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
