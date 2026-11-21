import type { DocPageContent } from '../../docs-content'

const page = {
  order: 22,
  slug: 'troubleshooting',
  title: 'Fehlerbehebung',
  description:
    'Lösungen für Probleme mit Browser, Arbeitsbereich, Medien, WebGPU, lokaler KI und Export.',
  category: 'Reference',
  related: ['workspaces', 'export'],
  sections: [
    {
      title: 'Browser und Arbeitsbereich',
      blocks: [
        {
          kind: 'table',
          headers: ['Symptom', 'Lösung'],
          rows: [
            [
              'Nicht unterstützter Browser oder keine Arbeitsbereich-Auswahl',
              'Nutze Chrome oder Edge 113+, die die von DroneClean Studio benötigten APIs unterstützen.',
            ],
            [
              'Brave kann keinen Ordner auswählen',
              'Aktiviere `brave://flags/#file-system-access-api` und starte Brave neu.',
            ],
            [
              'Berechtigung verweigert',
              'Wähle einen normalen Ordner, den du bearbeiten kannst, und erlaube dann Lese- und Schreibzugriff.',
            ],
            [
              'Beim erneuten Öffnen wird zum erneuten Verbinden aufgefordert',
              'Wähle **Erneut verbinden** für denselben Ordner; wenn er verschoben wurde, wähle einen anderen Ordner.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Medien und Import',
      blocks: [
        {
          kind: 'table',
          headers: ['Symptom', 'Lösung'],
          rows: [
            [
              'Fehlende Medien',
              'Verknüpfe neu mit **Zugriff erlauben**, **Suchen**, **Ordner suchen** oder **Anderen Ordner durchsuchen**.',
            ],
            [
              'Import fehlgeschlagen oder nicht unterstützter Codec',
              'Probiere ein anderes vom Browser unterstütztes Format oder transcodiere die Datei zuerst.',
            ],
            [
              'Import per URL schlägt fehl',
              'Stelle sicher, dass der Link auf die Mediendatei selbst zeigt, nicht auf eine Seite, die sie einbettet.',
            ],
            [
              'Veraltete Vorschauen oder Wellenformen',
              'Erzeuge Vorschaubilder oder Proxys neu oder leere den Projekt-Cache in den Speichereinstellungen.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Nutze **Offline arbeiten** nur, wenn du die Dateien später neu verknüpfen willst – bis dahin bleiben die Clips defekte Verweise.',
        },
      ],
    },
    {
      title: 'WebGPU und lokale KI',
      blocks: [
        {
          kind: 'table',
          headers: ['Symptom', 'Lösung'],
          rows: [
            [
              'Effekte, Scopes oder KI nicht verfügbar',
              'WebGPU ist möglicherweise aus – nutze ein aktuelles Chrome oder Edge, aktualisiere die GPU-Treiber und lass die Hardwarebeschleunigung eingeschaltet.',
            ],
            [
              'Ein Modell-Download ist langsam oder schlägt fehl',
              'Lass den Tab geöffnet, versuche es bei stabiler Verbindung erneut und leere den **Cache für lokale KI-Modelle**, wenn ein Download beschädigt ist.',
            ],
            [
              'Speichermangel bei KI-Arbeit',
              'Nutze **Lokale Modelle entladen**, um Laufzeiten freizugeben.',
            ],
            [
              'LUT-Import blockiert',
              'Der Import von LUT (.cube) erfordert einen Chromium-basierten Browser.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Export',
      blocks: [
        {
          kind: 'table',
          headers: ['Symptom', 'Lösung'],
          rows: [
            [
              'Codec in der Vorabprüfung nicht verfügbar',
              'Wähle einen anderen Codec oder ein anderes Format oder senke Auflösung oder Qualität.',
            ],
            [
              'Worker-Export nicht verfügbar',
              'Lass den Tab im Fokus und vermeide aufwendige Interaktion; es kann helfen, animierte Bildelemente durch Videoclips zu ersetzen.',
            ],
            [
              'Großer oder langsamer Export',
              'Exportiere einen kürzeren In/Out-Bereich, senke Auflösung oder Qualität und schaffe zuerst Speicherplatz.',
            ],
            [
              'Export startet nicht',
              'Behebe jede blockierende Warnung der Vorabprüfung und probiere dann einen kurzen Bereich, um zu bestätigen, dass die Pipeline funktioniert.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
