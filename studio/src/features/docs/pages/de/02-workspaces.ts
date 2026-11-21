import type { DocPageContent } from '../../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Arbeitsbereiche und Speicher',
  description:
    'Wie der Arbeitsbereich-Ordner funktioniert, wo Dateien liegen, Berechtigungen und Cache-Pflege.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: 'Das Arbeitsbereich-Modell',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ein **Arbeitsbereich** ist ein einzelner Ordner auf der Festplatte, aus dem DroneClean Studio liest und in den es schreibt.',
            'Alles, was DroneClean Studio erzeugt, liegt dort: Projektdateien, Medien-Metadaten, Vorschaubilder, Wellenformen, Transkripte, Szenendaten, KI-Assets, Caches und Exporte.',
            'Importierte Quellmedien werden nicht in den Arbeitsbereich kopiert – DroneClean Studio merkt sich für jede Datei eine Verknüpfung dorthin, wo sie bereits auf der Festplatte liegt.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Da der Arbeitsbereich ein echter Ordner ist, kannst du ihn wie jedes andere Verzeichnis sichern, synchronisieren oder verschieben.',
        },
      ],
    },
    {
      title: 'Arbeitsbereiche auswählen und wechseln',
      blocks: [
        {
          kind: 'list',
          items: [
            'Beim ersten Start fragt DroneClean Studio nach einem Arbeitsbereich, bevor sich der Editor öffnet.',
            'Wähle einen normalen Ordner, der dir gehört – zum Beispiel einen Ordner in „Dokumente“. Vermeide geschützte Systemorte.',
            'Mit der Steuerung **Arbeitsbereiche** fügst du bekannte Arbeitsbereiche hinzu, wechselst zwischen ihnen oder entfernst sie.',
            'Das Wechseln ändert, welchen Ordner DroneClean Studio verwendet; deine Quellmedien werden dabei nicht verschoben.',
          ],
        },
      ],
    },
    {
      title: 'Berechtigungen und erneutes Verbinden',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Aus Sicherheitsgründen können Browser die Ordnerberechtigung zwischen Sitzungen ablaufen lassen.',
        },
        {
          kind: 'list',
          items: [
            'Wenn DroneClean Studio **Verbinde deinen Arbeitsbereich erneut** anzeigt, wähle **Erneut verbinden** und gewähre Lese- und Schreibzugriff auf denselben Ordner.',
            'Wenn der Zugriff verweigert wird, wähle den Ordner erneut aus und erlaube den Zugriff, sobald der Browser nachfragt.',
            'Wenn der Ordner verschoben, umbenannt oder gelöscht wurde, wähle stattdessen einen anderen Ordner.',
          ],
        },
      ],
    },
    {
      title: 'Fehlende Medien',
      blocks: [
        {
          kind: 'list',
          items: [
            'Fehlende Medien bedeutet, dass DroneClean Studio eine oder mehrere verknüpfte Quelldateien derzeit nicht lesen kann.',
            'Nutze **Zugriff erlauben**, wenn für eine Datei nur die Browser-Berechtigung erneuert werden muss.',
            'Nutze **Suchen** oder **Ordner suchen**, wenn eine Datei oder ihr Ordner verschoben wurde.',
            'Nutze **Anderen Ordner durchsuchen**, um DroneClean Studio auf eine neue Kopie der Medien zu verweisen.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Nutze **Offline arbeiten** nur, wenn du die Dateien später neu verknüpfen willst; bis dahin bleiben die Clips defekte Verweise.',
        },
      ],
    },
    {
      title: 'Projekte verschieben und Caches leeren',
      blocks: [
        {
          kind: 'list',
          items: [
            'Nutze **Projekt exportieren**, um ein Projekt samt Medien in ein portables Bundle zu packen, das ein anderer Arbeitsbereich importieren kann.',
            'Die Cache-Aktionen eines Projekts leeren erneut erzeugbare Daten wie Wellenformen, Filmstreifen, GIF-Frames und decodiertes Audio.',
            'In den Speichereinstellungen kannst du außerdem Vorschaubilder neu erzeugen, fehlende Proxys generieren und Proxys löschen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Das Leeren von Caches löscht nie deine Quellmedien; DroneClean Studio erzeugt Vorschauen neu, wenn das Projekt sie braucht.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
