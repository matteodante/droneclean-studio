import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.5,
  slug: 'motion-library',
  title: 'Bewegung anwenden und wiederverwenden',
  description:
    'Bearbeitbare Vorgaben anwenden, Live-Verhalten hinzufügen, Textbewegung anpassen und Animationen zur Wiederverwendung speichern.',
  category: 'Creative Tools',
  related: ['motion', 'keyframes', 'properties', 'text-captions-subtitles'],
  sections: [
    {
      title: 'Die passende Animationsfläche wählen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio nutzt ein einziges Animationssystem an zwei Orten. Verwende den kompakten Tab **Animation**, während du einen Sequenz-Clip bearbeitest, oder öffne **Motion** für Arbeit an geschichteten Kompositionen.',
        },
        {
          kind: 'table',
          headers: ['Bereich', 'Wofür du ihn nutzt'],
          rows: [
            [
              'Schnitt > Animation',
              'Gängige Vorgaben, Status angewendeter Animationen, Textbewegung sowie das Erstellen oder erneute Öffnen eines Motion-Clips',
            ],
            [
              'Motion > Motion-Bibliothek',
              'Der vollständige Vorgabenkatalog, Live-Verhalten, gespeicherte Animationen und Steuerung der ausgewählten Ebene',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Wähle einen oder mehrere Clips im Schnitt aus und wähle **Motion-Clip erstellen**, um sie in einer geschichteten Komposition zu bewahren. Wähle einen vorhandenen Motion-Clip aus und wähle **In Motion öffnen**, um seine Ebenen zu bearbeiten.',
        },
      ],
    },
    {
      title: 'Eine bearbeitbare Vorgabe anwenden',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Wähle einen oder mehrere Clips oder Motion-Ebenen aus.',
            'Wähle eine Vorgabe unter **Eingang**, **Ausgang** oder **Betonung**.',
            'Stelle **Beim Anwenden** auf **Bereich ersetzen**, um Bewegung mit derselben Absicht auszutauschen, oder auf **Keyframes zusammenführen**, um vorhandene Keyframes zu behalten.',
            'Öffne die Eigenschaftszeilen oder den Wertegraphen, um die erzeugten Keyframes anzupassen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Der Abschnitt **Angewendet** listet manuelle Keyframes und jede Anwendung einer Vorgabe getrennt auf. Wähle einen Eintrag aus, um den Abspielkopf an seinen ersten Keyframe zu setzen.',
        },
      ],
    },
    {
      title: 'Ein Live-Verhalten hinzufügen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Live-Verhalten werden während der Wiedergabe ausgewertet, ohne Keyframes zu erzeugen. Lass sie live für anpassbare Bewegung oder backe sie, wenn du Kontrolle auf Frame-Ebene brauchst.',
        },
        {
          kind: 'table',
          headers: ['Verhalten', 'Ergebnis'],
          rows: [
            ['Schwebende Drift', 'Versetzt Position und Drehung'],
            ['Schwanken', 'Dreht hin und her'],
            ['Atempuls', 'Ändert Größe und Deckkraft'],
            ['Rotation', 'Dreht kontinuierlich'],
            ['Mikro-Wackeln', 'Fügt zufallsbasiertes (Seed) Zittern in Position und Drehung hinzu'],
          ],
        },
        {
          kind: 'list',
          items: [
            'Wähle eine Verhaltenskachel aus, um es mit Standardeinstellungen anzuwenden.',
            'Passe **Intensität** und **Dauer** über seine Steuerung für angewendete Verhalten an.',
            'Lies das schraffierte Band in der Motion-Zeitleiste, um zu sehen, wo prozedurale Bewegung läuft.',
            'Wende ein Verhalten auf mehrere Clips an, um ihre Phasen zu versetzen, statt jeden Clip im Gleichschritt zu bewegen.',
          ],
        },
      ],
    },
    {
      title: 'Textbewegung auf der Zeitleiste anpassen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Textbewegung animiert Zeichen, Wörter, Zeilen oder den ganzen Clip über die Live-Slots **Eingang**, **Ausgang** und **Schleife**.',
        },
        {
          kind: 'list',
          items: [
            'Wähle einen Text-Clip aus und wähle dann für jeden Slot eine Vorgabe im Tab **Animation** oder in der Motion-Bibliothek.',
            'Ziehe in Motion die Kante eines Textbewegungs-Bands, um seine Dauer zu ändern.',
            'Ziehe ein Band **Eingang** oder **Ausgang** vom Clip-Rand weg, um seinen Anfang oder sein Ende zu versetzen.',
            'Wähle seinen Eintrag unter **Angewendet** aus, um den Abspielkopf an das Band zu setzen.',
          ],
        },
      ],
    },
    {
      title: 'Angewendete Animation prüfen und bereinigen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Nutze **Angewendet**, um manuelle Keyframes, erzeugte Keyframes, Live-Verhalten und Textbewegung zu unterscheiden.',
            'Entferne eine Anwendung einer Vorgabe, ohne nicht zugehörige Keyframes zu löschen.',
            'Entferne ein Live-Verhalten oder einen Textbewegungs-Slot in seiner eigenen Zeile.',
            'Wenn ein Trim Keys außerhalb des Clips zurücklässt, nutze **Animation trimmen**, um nur diese abgelegten Keyframes zu löschen.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '**Animation trimmen** ändert gespeicherte Animation. Nutze die Aktion im Hinweis oder Rückgängig, wenn du die entfernten Keys zurückbrauchst.',
        },
      ],
    },
    {
      title: 'Bewegung backen, speichern und wiederverwenden',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Wähle **In Keyframes backen**, um Live-Verhalten von Ebenen in bearbeitbare Eigenschafts-Keys abzutasten.',
            'Wähle einen Clip mit der Animation aus, die du behalten willst.',
            'Wähle **Animation speichern**, gib einen Namen ein und speichere sie in der Projektbibliothek.',
            'Wende die gespeicherte Animation auf einen anderen kompatiblen Clip oder eine andere Ebene an.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Gespeicherte Animationen können bearbeitbare Keyframes, Live-Verhalten von Ebenen, Textbewegung oder eine Kombination enthalten. Exportierte Projekte tragen ihre Bibliothek gespeicherter Animationen mit.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
