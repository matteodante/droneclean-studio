import type { DocPageContent } from '../../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Vorschau und Wiedergabe',
  description:
    'Abspielen, Bild für Bild weiterschalten, den Monitor zoomen, Vollbild, Einzelbilder speichern, Proxy-Wiedergabe nutzen, die Wiedergabeauflösung senken und einen Bereich vorab rendern, damit er flüssig läuft.',
  category: 'Core Editing',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Abspielen und navigieren',
      blocks: [
        {
          kind: 'list',
          items: [
            'Spiele ab und pausiere mit den Vorschau-Steuerelementen oder mit `Space`.',
            'Gehe mit `Left` und `Right` bildweise vor und zurück, um bildgenau zu prüfen.',
            'Springe mit `Home` an den Anfang der Zeitleiste und mit `End` ans Ende.',
            'Lies die Timecode-Anzeige ab, um die genaue Position des Abspielkopfs zu bestätigen.',
          ],
        },
      ],
    },
    {
      title: 'Die Ansicht einrichten',
      blocks: [
        {
          kind: 'list',
          items: [
            'Passe den Vorschau-Zoom an, um Details zu prüfen; das ändert die Export-Leinwand nicht.',
            'Nutze **Vollbild**, wenn du Bewegung oder Bildausschnitt prüfst, und beende das Vollbild, um zurückzukehren.',
            'Nutze **Bild speichern**, um das aktuelle Bild in eine Bilddatei zu schreiben.',
            'Overlays für Transformation, Masken und Bearbeitung erscheinen auf dem Monitor, wenn ein passendes Element ausgewählt ist.',
          ],
        },
      ],
    },
    {
      title: 'Wiedergabeleistung und Audio',
      blocks: [
        {
          kind: 'list',
          items: [
            'Wenn Proxys vorhanden sind, nutzt DroneClean Studio sie für eine flüssigere Wiedergabe schwerer Medien; Exporte verwenden weiterhin die Originale.',
            'Die Lautstärkeregelung des Monitors wirkt nur auf die lokale Wiedergabe.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Exporte verwenden den Projektmix, daher ändert die Monitorlautstärke nie das gerenderte Audio.',
        },
      ],
    },
    {
      title: 'Wiedergabeauflösung',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Die Schaltfläche neben dem Proxy-Schalter in der Transportleiste stellt die Wiedergabeauflösung ein: **Voll**, **1/2** oder **1/4**. Eine niedrigere Auflösung zeichnet weniger Pixel für jedes Bild, das die Vorschau selbst berechnet (Clips mit Effekten, Stabilisierung, Geschwindigkeitsrampen, Bewegungsunschärfe), sodass schwere Stellen schneller laufen; das Bild ist weicher. Die Einstellung gilt für die ganze App und ändert nie einen Export.',
        },
      ],
    },
    {
      title: 'Einen Bereich vorab rendern',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Stabilisierte Clips mit Zeitlupe per optischem Fluss und Bewegungsunschärfe können für eine Echtzeit-Vorschau zu schwer sein. Rendere sie vorab, wie in After Effects, dann laufen sie mit voller Bildrate.',
        },
        {
          kind: 'steps',
          items: [
            'Markiere den Bereich mit In und Out (`I` und `O`) oder setze keine, um die gesamte Timeline zu rendern.',
            'Öffne das Menü **Vorschau rendern** in der Timeline-Leiste neben den In/Out-Schaltflächen und wähle **Von In bis Out rendern**, oder drücke `Enter`.',
            'Verfolge den Fortschritt in der Transportleiste; das X dort bricht ab und behält, was schon gerendert ist.',
            'Eine grüne Linie am unteren Rand des Lineals markiert die Bilder, die jetzt aus der gerenderten Vorschau laufen.',
          ],
        },
        {
          kind: 'list',
          items: [
            'Die Bilder werden mit der aktuellen Wiedergabeauflösung gerendert und im Arbeitsspeicher gehalten (bis 1 GB, etwa viereinhalb Minuten bei 1080p und 60 fps), bis du das Projekt schließt.',
            'Jede Änderung, die ein Bild ändert (ein Clip, ein Effekt, ein Keyframe, ein Übergang, die Stabilisierung, die Geschwindigkeit, Größe oder Bildrate des Projekts, die Wiedergabeauflösung oder der Proxy-Schalter), nimmt diese Bilder sofort von der grünen Linie: Die Vorschau berechnet sie wieder live, nie ein altes Bild.',
            'Ein erneutes Rendern berechnet nur die fehlenden Bilder. **Gerenderte Vorschau löschen** im selben Menü gibt den Speicher frei.',
            'Exporte nutzen die gerenderte Vorschau nie: Sie rendern immer aus dem Projekt.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Kann der Computer Bilder in der Vorschaugröße nicht kodieren oder ist das Speicherlimit erreicht, sagt eine Meldung das, und die Vorschau bleibt live.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
