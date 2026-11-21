import type { DocPageContent } from '../../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Grundlagen der Zeitleiste',
  description:
    'Spuren, Clips hinzufügen, Auswahl, Teilen und Verbinden, Löschen, Einrasten, Marker, Bereiche, Sequenzen und Zoom.',
  category: 'Core Editing',
  related: ['editing-tools', 'preview', 'media', 'export', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Spuren',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Videospuren** enthalten visuelle Elemente: Video, Bilder, Text, Formen, Untertitel und Einstellungsebenen.',
            '**Audiospuren** enthalten Audioclips und das mit Videodateien verknüpfte Audio.',
            'Füge Spuren mit **Videospur hinzufügen** oder **Audiospur hinzufügen** hinzu, wenn du mehr Platz brauchst.',
            'Zur Spursteuerung gehören **Sperren**, **Solo**, **Aktivieren/Deaktivieren** (Sichtbarkeit) und die Sync-Sperre.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Spurgruppen sind eine Ebene tief und wirken als Kopfzeilen – Stummschaltung, Sichtbarkeit und Sperre werden von einer Gruppe an ihre Spuren weitergegeben.',
        },
      ],
    },
    {
      title: 'Clips hinzufügen und anordnen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ziehe einen Clip aus dem Medien-Panel auf eine Video- oder Audiospur.',
            'Nutze das Werkzeug **Auswahl** (`V`), um Clips zu verschieben und neu anzuordnen.',
            '**Verknüpfte Auswahl** sorgt dafür, dass sich ein Videoclip und sein Audio gemeinsam bewegen; löse die Verknüpfung, um nur einen von beiden zu bearbeiten.',
            'Verschiebe ein ausgewähltes Element mit `Shift+Arrow` (1 px) oder `Ctrl+Shift+Arrow` (10 px).',
          ],
        },
      ],
    },
    {
      title: 'Teilen, Verbinden und Löschen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Teile am Abspielkopf mit `Alt+C`, oder nutze das Werkzeug **Rasiermesser** (`C`), um dort zu schneiden, wo du klickst.',
            'Verbinde angrenzende Abschnitte desselben Clips mit `Shift+J`.',
            '**Löschen** hinterlässt eine Lücke; **Ripple löschen** (`Ctrl+Delete`) entfernt den Clip und schließt die Lücke.',
            'Nutze **Alle Lücken schließen**, um Clips zusammenzuschieben und leeren Raum auf einer Spur zu entfernen.',
          ],
        },
      ],
    },
    {
      title: 'Einrasten, Marker und Bereiche',
      blocks: [
        {
          kind: 'list',
          items: [
            'Schalte das Einrasten mit `S` um, damit Clips an nahe Schnitte, Marker und den Abspielkopf einrasten.',
            'Setze mit `M` einen Marker für Notizen und Zeitreferenzen; springe mit `[` und `]` zwischen Markern.',
            'Setze einen In-Punkt (`I`) und einen Out-Punkt (`O`), um einen Bereich für Vorschau und Export festzulegen; entferne sie mit `Alt+X`.',
          ],
        },
      ],
    },
    {
      title: 'Sequenzen (mehrere Zeitleisten)',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Eine **Sequenz** ist eine in sich geschlossene Zeitleiste mit eigenen Spuren, Clips, Markern und In/Out-Bereich. Die Tab-Leiste über der Zeitleiste listet die **Haupt**-Zeitleiste und jede Sequenz auf – klicke auf einen Tab, um zu wechseln, welche du bearbeitest.',
        },
        {
          kind: 'list',
          items: [
            'Erstelle eine Sequenz mit der Schaltfläche **+** am Ende der Tab-Leiste; sie öffnet sich als eigener Tab.',
            'Wechsle zwischen Sequenzen per Klick auf einen Tab; der Tab **Haupt** steht immer an erster Stelle.',
            'Doppelklicke auf einen Tab, um ihn **umzubenennen**, oder nutze das Tab-Optionsmenü (⋮) für **Umbenennen**, **Tab schließen** und **Sequenz löschen**.',
            '**Tab schließen** entfernt nur den Tab – die Sequenz bleibt im Medien-Panel und in allen Clips verfügbar, die auf sie verweisen. **Sequenz löschen** entfernt sie vollständig (rückgängig machbar), samt allen Clips, die auf sie verweisen.',
            'Ein **Compound-Clip** lässt sich als Sequenz-Tab öffnen – klicke im Medien-Panel mit der rechten Maustaste auf einen Compound-Clip und wähle **Als Tab öffnen**, um ihn als eigenständige Zeitleiste zu bearbeiten.',
            'Lege eine Sequenz auf der Zeitleiste ab, um sie als Clip zu verschachteln (bezeichnet mit **Sequenz**); doppelklicke auf diesen Clip, um zu seinem Tab zu springen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Jede Sequenz behält ihre eigenen Marker, ihren In/Out-Bereich, ihre Ansicht und ihren Rückgängig-Verlauf – beim Wechseln der Tabs vermischt sich nichts.',
        },
      ],
    },
    {
      title: 'Zoom und Rückgängig',
      blocks: [
        {
          kind: 'list',
          items: [
            'Zoome mit `Ctrl+=` und `Ctrl+-`, passe den gesamten Schnitt mit `\\` ein und kehre mit `Shift+\\` zu 100 % zurück.',
            'Der Zoom ändert nur die Ansicht, nie das Timing der Clips.',
            'Mache mit `Ctrl+Z` rückgängig und stelle mit `Ctrl+Shift+Z` wieder her; die Tiefe des Rückgängig-Verlaufs lässt sich in den Einstellungen festlegen.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
