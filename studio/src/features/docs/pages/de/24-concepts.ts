import type { DocPageContent } from '../../docs-content'

// order 1.5 places this right after Getting Started in the Start group.
const page = {
  order: 1.5,
  slug: 'concepts',
  title: 'So funktioniert DroneClean Studio',
  description:
    'Das mentale Modell: Local-first-Speicherung, Projekte und verknüpfte Medien, Frames und Timecode sowie die GPU-Pipeline.',
  category: 'Start',
  related: ['workspaces', 'getting-started', 'editing-tools'],
  sections: [
    {
      title: 'Local-first, von Grund auf',
      blocks: [
        {
          kind: 'list',
          items: [
            'DroneClean Studio läuft in deinem Browser und speichert alles in einem **Arbeitsbereich-Ordner** auf deiner Festplatte.',
            'Dein originales Video und Audio werden **verknüpft**, nicht kopiert oder hochgeladen – DroneClean Studio verweist auf die Dateien dort, wo sie bereits liegen.',
            'Projekte, Caches, erzeugte Assets und Exporte werden in den Arbeitsbereich geschrieben, sodass du ihn wie jeden Ordner sichern oder verschieben kannst.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Da Medien verknüpft sind, erscheint das Verschieben oder Umbenennen einer Quelldatei als **Fehlende Medien**, bis du sie neu verknüpfst. Siehe [Arbeitsbereiche und Speicher](workspaces).',
        },
      ],
    },
    {
      title: 'Projekte, Spuren und Clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ein **Projekt** enthält eine Zeitleiste, ihre Einstellungen (Auflösung und Bildrate) und Verweise auf die verwendeten Medien.',
            'Die Zeitleiste stapelt **Spuren**; höhere Spuren werden über niedrigeren gerendert.',
            'Ein **Clip** auf der Zeitleiste ist ein Fenster in eine Quelldatei – das Trimmen eines Clips ändert, welcher Teil der Quelle abgespielt wird, es verändert die Datei nicht.',
            'Eine **Einstellungsebene** ist ein Clip ohne eigene Medien – sie wendet ihre Effekte und Farbe auf jeden Clip darunter an.',
          ],
        },
      ],
    },
    {
      title: 'Sequenzen und Compound-Clips',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio hat einen einzigen Grundbaustein für **eine Zeitleiste innerhalb deines Projekts** – eine Komposition. Sie zeigt sich auf zwei Arten, je nachdem, wie du sie nutzt.',
        },
        {
          kind: 'list',
          items: [
            'Eine **Motion-Komposition** öffnet sich in **Motion**, wo der gemeinsame Editor deine Medien, die Vorschau und die Eigenschaften an Ort und Stelle lässt, während das untere Dock zu einer Ebenen-Zeitleiste wird.',
            'Eine **Sequenz** ist eine eigenständige Zeitleiste im selben Projekt, die über einen Tab in der Tab-Leiste geöffnet wird. Jede Sequenz hat eigene Spuren, Clips und einen eigenen Bearbeitungsverlauf – die Haupt-Zeitleiste ist selbst eine Sequenz.',
            'Ein **Compound-Clip** nimmt einen Abschnitt der Zeitleiste und faltet ihn zu einem einzigen wiederverwendbaren Medienelement zusammen. Auf der Zeitleiste verhält er sich wie ein Clip – verschieben, trimmen, Effekte hinzufügen –, während sein Inhalt in einer eigenen Zeitleiste liegt.',
            'Beide sind dasselbe, anders betrachtet: Öffne einen Compound-Clip, um seinen Inhalt als Sequenz zu bearbeiten, und jede Sequenz lässt sich als Compound-Clip in eine andere Zeitleiste legen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Eine Komposition kann andere Kompositionen enthalten, aber nie sich selbst – DroneClean Studio blockiert zirkuläre Verweise, sodass ein Compound-Clip nie in seinem eigenen Inhalt verschachtelt landen kann.',
        },
      ],
    },
    {
      title: 'Frames und Timecode',
      blocks: [
        {
          kind: 'list',
          items: [
            'Zeit wird in **Frames** gemessen. Ein Clip hat ein Startbild und eine Länge in Frames bei der Bildrate des Projekts.',
            'Die Vorschau zeigt **Timecode**; klicke in manchen Ansichten auf die Anzeige, um zu Bildnummern zu wechseln.',
            'Quellmedien können eine andere Bildrate als das Projekt haben, daher rechnet DroneClean Studio beim Schneiden Quellframes in Projektframes um.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Stelle Auflösung und Bildrate des Projekts beim Erstellen passend zu deinem Lieferziel ein.',
        },
      ],
    },
    {
      title: 'Alles wird auf deinem Rechner gerendert',
      blocks: [
        {
          kind: 'list',
          items: [
            'Wiedergabe, Effekte, Farbe und KI-Werkzeuge laufen lokal mit deiner GPU (WebGPU) und CPU (WebCodecs).',
            '**Proxys** sind leichtere Kopien schwerer Medien, die das Schneiden flüssig machen; der finale Export verwendet immer die Originale.',
            'Da es kein Cloud-Rendering gibt, ist es wichtig, den Tab beim Export geöffnet zu lassen – das Rendern geschieht direkt im Browser.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
