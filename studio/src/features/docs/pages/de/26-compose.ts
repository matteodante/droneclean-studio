import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.75,
  slug: 'motion',
  title: 'Den Motion-Arbeitsbereich nutzen',
  description:
    'Geschichtete 2D-Kompositionen im Motion-Arbeitsbereich aufbauen, timen, animieren, verknüpfen und wiederverwenden.',
  category: 'Creative Tools',
  related: ['motion-library', 'keyframes', 'shapes-masks', 'concepts'],
  sections: [
    {
      title: 'Eine Motion-Komposition öffnen oder erstellen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Motion hält Medienbibliothek, Kompositionsvorschau, Ebenen-Zeitleiste, Eigenschaften, Keyframes, Graph und Motion-Bibliothek in einem Arbeitsbereich zusammen.',
        },
        {
          kind: 'steps',
          items: [
            'Wähle **Motion** im Arbeitsbereich-Umschalter oder drücke `Alt+3`.',
            'Wähle eine vorhandene Komposition im Kompositionsmenü oder wähle **Neue Komp.**.',
            'Um Sequenz-Clips hochzustufen, wähle sie im Schnitt aus, öffne **Animation** und wähle **Motion-Clip erstellen**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Beim Erstellen eines Motion-Clips bleiben die ausgewählten Clips und ihre Animation in der neuen Komposition erhalten. Der neue Wrapper bleibt im Schnitt ein normaler Clip.',
        },
      ],
    },
    {
      title: 'Der Komposition Ebenen hinzufügen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ziehe Video, Audio, Bilder, Text, Formen, Lottie-Dateien oder eine andere Komposition aus der Medienbibliothek.',
            'Wähle **Element hinzufügen**, um Ebenen vom Typ **Text**, **Volltonfarbe**, **Verlauf**, **Form** oder **Null-Objekt** zu erstellen.',
            'Volltonfarbe und Verlauf erzeugen vollflächige Formebenen, die du skalieren, gestalten, maskieren und animieren kannst.',
            'DroneClean Studio verhindert, dass eine Komposition sich selbst enthält, auch bei indirekter zirkulärer Verschachtelung.',
          ],
        },
      ],
    },
    {
      title: 'Dauer und aktiven Bereich festlegen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Die erstellte Dauer definiert die Komposition. Die Griffe „Ein“ und „Aus“ des Lineals definieren den aktiven Renderbereich innerhalb dieser Dauer.',
        },
        {
          kind: 'steps',
          items: [
            'Ziehe die Griffe **Ein** und **Aus** über dem Motion-Lineal, um den aktiven Bereich zu markieren.',
            'Wähle **Komposition auf aktiven Bereich zuschneiden**, um die erstellte Komposition auf diesen Bereich zu kürzen.',
            'Wähle **Zoom auf Inhalt**, um die erstellte Komposition einzupassen, ohne ihre Dauer zu ändern.',
            'Bearbeite **Komp-Dauer** in den Eigenschaften und wähle ihre Einheit, um zwischen Frames und Sekunden zu wechseln.',
            'Lies den passenden **Timecode**-Wert unter der Dauersteuerung ab.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Beim Trimmen bleiben die Steuerelemente Ein und Aus verfügbar und der neue Bereich wird eingepasst. Ebenen, die über die erstellte Dauer hinausreichen, bleiben im abgedunkelten Überhang sichtbar.',
        },
      ],
    },
    {
      title: 'Ebenen anordnen und timen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ziehe eine Ebenenspanne, um sie zeitlich zu verschieben. Ausgewählte Ebenen bewegen sich gemeinsam in einem Rückgängig-Schritt.',
            'Bearbeite die Felder **Ein** und **Aus** jeder Ebene oder ziehe die Kanten ihrer Spanne, um sie zu trimmen.',
            'Nutze die Ebenensteuerung, um Sichtbarkeit, Sperre, Solo, Mischmodus und Stapelreihenfolge zu ändern.',
            'Ziehe den Griff mit den drei Punkten, um eine Ebene oder Gruppe neu anzuordnen. Untergeordnete Ebenen bleiben in ihrer aktuellen Gruppe.',
            'Wähle zwei oder mehr Ebenen aus und wähle **Ebenengruppe**. Sichtbarkeit, Sperre, Solo, Timing und Neuanordnung der Gruppe gelten für ihre untergeordneten Ebenen.',
            'Klicke mit der rechten Maustaste auf eine Ebene oder Gruppe, um sie umzubenennen, zu gruppieren, die Gruppierung aufzuheben, zu duplizieren, zu kopieren, einzufügen oder zu löschen.',
          ],
        },
      ],
    },
    {
      title: 'Eigenschaften und Pfadpunkte animieren',
      blocks: [
        {
          kind: 'list',
          items: [
            'Klappe eine Ebene auf, um verschachtelte Eigenschaftsgruppen, Wertregler, Auto-Key, Navigation und Keyframe-Rauten zu sehen.',
            'Stelle den Eigenschaftsfilter auf **Animiert**, wenn du nur Zeilen mit Keys brauchst.',
            'Wähle die Raute einer Eigenschaft aus, um am gemeinsamen Abspielkopf einen Key hinzuzufügen oder zu entfernen.',
            'Wähle zwei benachbarte Keys aus, um das Easing ihres Segments zu bearbeiten.',
            'Wähle das Kurvensymbol einer Eigenschaft aus, um ihre Dope-Sheet-Spur durch einen eingebetteten Wertegraphen zu ersetzen.',
            'Öffne das Menü der Gruppe Position und wähle **Positionsdimensionen trennen**, um X und Y unabhängig zu bearbeiten.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Pfadformen zeigen in Motion Spuren für ihre Punkte. Wähle Pfadpunkte in der Vorschau aus und wechsle dann über den Eigenschaftszeilen zwischen **Ausgewählte Punkte** und **Alle Punkte**.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Sobald die Pfadgeometrie Keyframes hat, kannst du den ersten Pfadpunkt nicht mehr hinzufügen, entfernen, umordnen oder ändern. Entferne diese Keys, bevor du die Pfadtopologie änderst.',
        },
      ],
    },
    {
      title: 'Ebenen mit einem Null-Objekt verknüpfen',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Wähle **Element hinzufügen > Null-Objekt**. Ein Null-Objekt steuert Transformationen, wird aber nicht gerendert.',
            'Wähle ein übergeordnetes Element im Menü **Übergeordnet** oder ziehe den Parent-Pick-Whip auf eine andere Ebene.',
            'Lasse normal los, um die Canvas-Pose des untergeordneten Elements zu bewahren.',
            'Halte beim Loslassen **Shift** gedrückt, um die Position des untergeordneten Elements an das übergeordnete einrasten zu lassen.',
            'Halte beim Loslassen **Alt/Option** gedrückt, um die erstellte lokale Pose des untergeordneten Elements zu verwenden.',
            'Klicke mit Ctrl oder Command auf den Pick-Whip des untergeordneten Elements, um die Verknüpfung zu lösen und dabei seine aktuelle Pose zu bewahren.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Gültige übergeordnete Ziele werden beim Ziehen hervorgehoben. Motion lehnt Selbst-Verknüpfung, untergeordnete Ziele und Verknüpfungen ab, die einen Zyklus erzeugen würden.',
        },
      ],
    },
    {
      title: 'Eigenschaften verknüpfen oder einen Ausdruck schreiben',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Eine Parent-Verknüpfung erzeugt eine Ebenenhierarchie. Eine **Eigenschaftsverknüpfung** lässt eine Eigenschaft einer anderen folgen, ohne diese Hierarchie zu ändern.',
        },
        {
          kind: 'list',
          items: [
            'Ziehe den Pick-Whip einer Eigenschaft auf eine kompatible Zeile in Motion, im Dope Sheet oder im Graphen.',
            'Verknüpfe Skalarwerte mit Skalarwerten. Position, Skalierung und Anker werden als vollständige zweidimensionale Werte verknüpft.',
            'Wähle die Schaltfläche mit den geschweiften Klammern, um einen Ausdruck in einer Sandbox hinzuzufügen, ohne die Keyframes der Eigenschaft zu löschen.',
            'Nutze den Pick-Whip des Ausdrucks, um am Textcursor einen Verweis `prop("layer-id", "property")` einzufügen.',
            'Verwende `value`, `preValue`, `frame`, `time`, Skalar- oder `[x, y]`-Werte, Arithmetik und die unterstützten mathematischen Funktionen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio wertet zuerst die Keyframes aus, dann die Eigenschaftsverknüpfung, dann den Ausdruck. Vorschau und Export verwenden dieselbe Reihenfolge.',
        },
      ],
    },
    {
      title: 'Steuerung für wiederverwendete Kompositionen bereitstellen',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Öffne **Veröffentlichte Steuerelemente** in der Quellkomposition.',
            'Veröffentliche den Text oder die Farben, die ein Editor an platzierten Instanzen ändern soll.',
            'Platziere die Komposition in einer normalen Sequenz und wähle diese Instanz aus.',
            'Bearbeite ihre veröffentlichten Werte in den Eigenschaften, ohne die Quellkomposition zu ändern.',
            'Setze eine Überschreibung zurück oder nutze **Alle Überschreibungen zurücksetzen**, um die Quellwerte wiederherzustellen.',
          ],
        },
      ],
    },
    {
      title: 'Die Komposition im Schnitt verwenden',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Eine Motion-Komposition bleibt ein wiederverwendbares Kompositions-Asset. Platziere sie in einer Sequenz und verschiebe, trimme, animiere oder versehe die Instanz mit Effekten wie jeden anderen Clip.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Die interne Ebenenanimation und die Animation des ganzen Clips bleiben unabhängig. Ein Titel kann intern animiert sein, während seine platzierte Instanz sich im Schnitt bewegt oder ausblendet.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
