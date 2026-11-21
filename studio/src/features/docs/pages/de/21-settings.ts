import type { DocPageContent } from '../../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Einstellungen',
  description:
    'Die Tabs Allgemein, Zeitleiste, KI, Speicher und Datenschutz sowie wo Sprache und Tastenkürzel eingestellt werden.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'Die Tabs',
      blocks: [
        {
          kind: 'table',
          headers: ['Tab', 'Was du einstellst'],
          rows: [
            [
              'Allgemein',
              'Automatisches Speichern ein/aus und Intervall (5–30 Min.); Tiefe des Rückgängig-Verlaufs (10–200 Schritte); Interface-Sounds (ein/aus, Lautstärke, Sound-Thema).',
            ],
            [
              'Zeitleiste',
              'Standardmäßig einrasten; Wellenformen und Filmstreifen anzeigen; Filmstreifen beim Import extrahieren.',
            ],
            [
              'KI',
              'Abtastintervall für Untertitel (Sekunden oder Bilder); Standard-Untertitelstil.',
            ],
            [
              'Speicher',
              'Fehlende Proxys erzeugen; Projekt-Cache leeren; Vorschaubilder neu erzeugen; Proxys löschen; lokale KI verwalten.',
            ],
            [
              'Datenschutz',
              'Absturzberichte und anonyme Nutzungsstatistiken, jeweils ein oder aus (beide aus, bis du sie erlaubst); in der Desktop-App außerdem **Nach neuen Versionen suchen** (standardmäßig an).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Das Leeren des Projekt-Caches entfernt erneut erzeugbare Daten (Wellenformen, Filmstreifen, GIF-Frames, decodiertes Audio); es löscht nie Quellmedien. Nutze **Zurücksetzen** in der Kopfzeile des Dialogs, um die Standardwerte wiederherzustellen.',
        },
      ],
    },
    {
      title: 'Neue Versionen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Die Desktop-App ist nicht signiert und kann sich deshalb nicht selbst aktualisieren. Stattdessen fragt sie beim Start (höchstens einmal am Tag) GitHub nach der Nummer der neuesten Version und zeigt, wenn es eine neuere gibt, eine kleine Karte mit **Herunterladen** (öffnet die Seite dieser Version in deinem Browser) und **Später** (blendet sie bis morgen aus). Während ein Export gerendert wird, erscheint nichts. Das ist die einzige Anfrage, die die App stellt, ohne dass du darum bittest, deshalb gibt es einen Schalter: **Einstellungen › Datenschutz › Nach neuen Versionen suchen**, standardmäßig an. GitHub sieht deine IP-Adresse; sonst wird nichts über dich oder deine Arbeit gesendet, und mit ausgeschaltetem Schalter wird keine Anfrage gestellt. Der Web-Editor ist immer auf dem neuesten Stand und prüft nie.',
        },
      ],
    },
    {
      title: 'Interface-Sounds',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio kann dezente synthetisierte Interface-Sounds abspielen – kurze Signale, die Aktionen wie Auswählen, Bestätigen, Umschalten und Löschen quittieren. Sie sind **standardmäßig aus**, müssen aktiv eingeschaltet werden und beeinflussen nie das exportierte Audio.',
        },
        {
          kind: 'steps',
          items: [
            'Öffne **Einstellungen** und gehe zum Tab **Allgemein**.',
            'Schalte **Interface-Sounds** ein.',
            'Stelle die **Lautstärke** nach Geschmack ein (0–100 %).',
            'Wähle ein **Sound-Thema** – **Signature**, **Velvet** oder **Crisp** – und höre es mit der Schaltfläche **Vorschau** an.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Die Sounds werden unterdrückt, während die Vorschau abspielt, damit sie nie in das Audio gelangen, das du abhörst; Exporte sind absichtlich stumm. Beim Einschalten des Schalters erklingt eine kurze Bestätigung.',
        },
      ],
    },
    {
      title: 'Absturzberichte und Nutzungsstatistiken',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio sendet nichts über dich oder deine Arbeit, solange du es nicht erlaubst. Beim ersten Öffnen fragt es in einer Karte unten links, ob es **Absturzberichte** und **anonyme Nutzungsstatistiken** senden soll; bis du antwortest und nach **Nicht erlauben** wird nichts gesendet. Ändere beides jederzeit unter **Einstellungen › Datenschutz**.',
        },
        {
          kind: 'table',
          headers: ['Bericht', 'Was gesendet wird', 'Wohin'],
          rows: [
            [
              'Absturzberichte',
              'Der Fehler, die Stelle im Code des Editors, die Version und das Betriebssystem. Pfade und Dateinamen werden aus den Meldungen entfernt, bevor sie das Gerät verlassen.',
              'Sentry, in der EU',
            ],
            [
              'Nutzungsstatistiken',
              'Dass die App geöffnet, ein Projekt erstellt (seine Größe und Bildrate), ein Export abgeschlossen (sein Format, seine Größe und Länge), ein KI-Agent verbunden oder ein Schatten entfernt wurde (seine Länge), unter einer zufälligen ID dieser Installation, die vergessen wird, wenn du die Statistiken ausschaltest.',
              'PostHog, in der EU',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Nie gesendet werden: deine Aufnahmen, Bilder, Datei- und Ordnernamen, Projektnamen oder dein Konto. Deine IP-Adresse wird nicht gespeichert. Die Desktop-App speichert deine Antwort in ihrem Profilordner, der Web-Editor in deinem Browser.',
        },
      ],
    },
    {
      title: 'Tastenkürzel anpassen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Tastenkürzel sind vollständig anpassbar, aber der Editor dafür ist ein eigener Dialog, der über die Schaltfläche **Tastenkürzel** in der Symbolleiste geöffnet wird – nicht dieser Einstellungsdialog. Er bietet eine interaktive Bildschirmtastatur, Suche und die Filter **Benutzerdefiniert** / **Konflikte** / **Nicht zugewiesen**, Aufnehmen zum Neubelegen, alternative Belegungen, Standardwerte pro Befehl und mit **Alle zurücksetzen**, Konflikterkennung sowie JSON-Vorgaben mit **Importieren** / **Exportieren**.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Auf der Seite **Tastenkürzel** findest du die vollständige Befehlsliste und eine Schritt-für-Schritt-Anleitung zum Neubelegen.',
        },
      ],
    },
    {
      title: 'Anderswo eingestellt',
      blocks: [
        {
          kind: 'list',
          items: [
            'Die **Sprache** der Oberfläche ist ein eigener Regler in der Symbolleiste und nicht Teil dieses Dialogs; DroneClean Studio erscheint in 10 Sprachen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio verwendet derzeit ein einziges dunkles Design; es gibt keine Designauswahl.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
