import type { DocPageContent } from '../../docs-content'

// DroneClean Studio's own tools for drone and FPV footage (19 Nov 2026; the tools of 0.1.3-0.1.4 added 20 Nov 2026):
// what FreeCut's pages do not cover.
const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Drohnenaufnahmen: stabilisieren, graden, beschleunigen, teilen',
  description:
    'Gyro-Stabilisierung und Bildausschnitt, das Profil D-Log M, Looks und der Himmel, Geschwindigkeitsrampen mit Easing, Bewegungsunschärfe und flüssige Zeitlupe, Beat-Marker, der weiche Schnitt mit einem Klick, der Export als Instagram Reel und der Agenten-Zugriff.',
  category: 'Creative Tools',
  related: ['effects-color', 'keyframes', 'export', 'properties'],
  sections: [
    {
      title: 'Aus den Gyro-Daten stabilisieren',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DJI- und GoPro-Dateien tragen die Bewegung der Kamera in sich. Wähle einen Clip aus und schalte unter Eigenschaften › Video › Stabilisierung **Diesen Clip stabilisieren** ein: Der Clip wird aus diesen Daten beruhigt, ganz ohne Analysedurchlauf, und mit **Glättung** und **Horizontsperre** stimmst du ihn ab.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Ein stabilisierter Clip wird in der Form des Projekts gezeichnet. Ein 4:3-Avata-Clip in einem 9:16-Projekt füllt das Hochformat von selbst; du musst ihn nicht skalieren.',
        },
        {
          kind: 'paragraph',
          text: 'Der **Ausschnitt** (zwei Regler unter Stabilisierung) verschiebt das stabilisierte Fenster seitlich oder nach oben und unten innerhalb des Bildes, soweit die Stabilisierung Spielraum lässt, sodass ein Hochformat-Schnitt sein Motiv im Bild behält. Die Raute neben jedem Regler setzt dafür einen Keyframe, sodass der Ausschnitt dem Motiv durch die Einstellung folgen kann.',
        },
      ],
    },
    {
      title: 'Farbe: Profil, Look, Farbkorrektur',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Lege das **Farbprofil** von Log-Clips fest (D-Log M für die Avata 2, D-Log): Das flache Bild wird vor allem anderen zu Rec.709. DJI-Dateien verraten nicht, in welchem Profil sie aufgenommen wurden, daher fragt der erste DJI-Import eines Projekts einmal nach; **Ja, D-Log M** setzt es bei diesen Clips. Das Profil wurde an Material der Avata 2 angepasst. DJI bietet auch für die Mini 4 Pro und die Air 3 eine D-Log-M-LUT an, und das Panel erkennt diese Drohnen, aber ihre Farben wurden hier nicht geprüft, und das Panel sagt das.',
            'Wähle einen **Look** (eine `.cube`-Datei aus der Look-Bibliothek des Arbeitsbereichs; mit **Looks verwalten… › .cube hinzufügen** fügst du einen hinzu) und seine **Intensität**.',
            'Schließe in **Effekte** ab: Color Wheels für Kontrast, Lichter und Details in den Mitten; **Sky** gibt einem weißen, bedeckten Himmel einen abgestuften Blauton (Horizont, Winkel, Weichheit und ein Schutz, der ihn auf den hellen, blassen Pixeln hält); ein Secondary Qualifier und ein Power Window tun dasselbe von Hand; Glow, Vignette und Sharpen runden das Bild ab.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Auch Eis und Schnee sind weiß: Halte bei vereisten Aufnahmen den Qualifier zurückhaltend und lass das abgestufte Fenster den Himmel einfärben.',
        },
      ],
    },
    {
      title: 'Geschwindigkeit, Bewegungsunschärfe und flüssige Zeitlupe',
      blocks: [
        {
          kind: 'table',
          headers: ['Regler', 'Was er bewirkt'],
          rows: [
            [
              'Geschwindigkeit',
              'Eine konstante Geschwindigkeit; der Clip behält seinen Quellbereich und seine Länge folgt.',
            ],
            [
              'Kurve…',
              'Eine Geschwindigkeitskurve mit Keys: Rampe hinein, Rampe hinaus oder beides, jedes Segment Linear, Weich, Langsam beginnen oder Langsam enden. Das Panel zeigt die Bilder pro Sekunde, die der Clip an seiner langsamsten Stelle wirklich hat.',
            ],
            [
              'Weiche Rampe + Zoom',
              'Das Rezept für Drohnen-Reels mit einem Klick, im Geschwindigkeits-Panel: schnell, in der Mitte etwa 0,45x, wieder schnell, mit weichen Segmenten, flüssiger Zeitlupe, Bewegungsunschärfe und einem weich auslaufenden Zoom.',
            ],
            [
              'Bewegungsunschärfe',
              'Über 1x mischt sie die Quellframes, die jedes Ausgabebild abdeckt, mit einem Shutter von 90° bis 360°.',
            ],
            [
              'Flüssige Zeitlupe',
              'Unter 1x oder bei einer 30-fps-Datei in einem 60-fps-Projekt erzeugt sie die Zwischenbilder, statt ein Bild doppelt zu zeigen: Bildmischung mischt die beiden Quellframes, Optischer Fluss baut das Bild aus der Bewegung dazwischen auf (schärfer, ohne Doppelbilder).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Verlangsame nur Material, das mit einer höheren Bildrate als das Projekt aufgenommen wurde. Eine 30-fps-Datei in einem 60-fps-Projekt hat bereits nur die Hälfte der nötigen Bilder: Lass sie bei 1x oder schneller, und verlangsame 60-fps-Material nicht über 0,5x hinaus.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Schneide auf die starken Beats des Songs, nicht auf jeden Beat: Klicke mit der rechten Maustaste auf den Song und wähle **Beats markieren** (ein Marker bei jedem starken Basschlag), oder markiere sie selbst mit `M` und lass dann jeden Clip von einem Marker zum nächsten laufen.',
        },
      ],
    },
    {
      title: 'Weicher Schnitt mit einem Klick',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Lege deine Videoclips und einen Song auf die Timeline und klicke auf **Weicher Schnitt…** (die Schaltfläche mit den Funken in der Timeline-Leiste). Der Editor findet die Beats des Songs, legt die Videoclips ab dem ersten Beat lückenlos hintereinander, jeden auf die gewählte Zahl von Takten gekürzt, und gibt jedem den Look des weichen Schnitts: eine Geschwindigkeitsrampe schnell, langsam, schnell mit Zeitlupe per optischem Fluss, Bewegungsunschärfe und einen weichen Zoom hinein. So entsteht der Schnitt der Drohnen-Reels in einem Schritt.',
        },
        {
          kind: 'steps',
          items: [
            'Lege den Song und die Clips auf die Timeline. Gibt es keinen Audioclip, zeigt der Dialog **Füge zuerst einen Song zur Timeline hinzu**.',
            'Klicke auf **Weicher Schnitt…**, wähle den Song, falls es mehrere gibt, die **Länge der Einstellung** (1, 2 oder 4 Takte; ein Takt sind vier Beats) und ob du eine **Kurze Überblendung an jedem Schnitt** möchtest.',
            'Der Dialog sagt, wie viele Clips sich ändern. Klicke auf **Anwenden**.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Jeder Clip behält seinen In-Punkt; kürze also zuerst den Anfang eines Clips, um zu wählen, wo seine Einstellung beginnt. Die schnellen Teile verbrauchen Material schneller, als sie dauern, deshalb nutzt eine Einstellung von einem Takt etwa anderthalb Takte des Clips. Ein Clip mit zu wenig Material nach seinem In-Punkt wird übersprungen, und Clips, die nach dem Song enden würden, bleiben unverändert hinter der letzten Einstellung. Ein stabilisierter Clip behält seine Stabilisierung. Es wird nichts gelöscht, und **Ctrl/Cmd+Z** macht den ganzen Schnitt in einem Schritt rückgängig.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Ein KI-Agent kann dasselbe mit einem einzigen Aufruf, `studio.clips.smoothEditTimeline({ bars, crossfade })`, und vorher trotzdem selbst den besten Teil jedes Clips auswählen.',
        },
      ],
    },
    {
      title: 'Export für Instagram',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Die Vorgabe **Instagram Reel** folgt der Reel-Spezifikation von Meta: H.264-MP4 mit der Bildrate des Projekts, 1080x1920 (das Bild, das Instagram zeigt), 20 Mbit/s bei 60 fps oder 12 Mbit/s bei 30 fps, unter dem Maximum von 25 Mbit/s bei Meta, mit AAC-Ton bei 128 kbit/s, dem Index am Dateianfang und ohne Edit List. Instagram codiert jeden Upload neu; wenn du ihm sein eigenes Bild und seine eigene Größe gibst, vermeidest du eine zweite Skalierung.',
        },
        {
          kind: 'paragraph',
          text: 'Die Voreinstellungen **TikTok** und **YouTube Shorts** liefern dasselbe vertikale H.264-MP4 in 1080x1920 mit der Bildrate des Projekts (bis 60 fps). **YouTube Shorts** nutzt die von YouTube veröffentlichten 1080p-Raten: 12 Mbit/s bei 60 fps oder 8 Mbit/s bei 30 fps, mit AAC-Stereo bei 384 kbit/s. TikTok veröffentlicht keine Bitrate, deshalb nutzt **TikTok** 16 Mbit/s bei 60 fps oder 10 Mbit/s bei 30 fps, von uns gewählt, mit AAC bei 128 kbit/s. Beide Plattformen kodieren jeden Upload neu.',
        },
      ],
    },
    {
      title: 'Einen KI-Agenten schneiden lassen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Die Desktop-App betreibt einen lokalen MCP-Server für KI-Agenten auf deinem Computer, standardmäßig an: **Einstellungen › Agenten-Zugriff › KI-Agenten erlauben** schaltet ihn aus oder wieder an, und nur dein Benutzer kann ihn erreichen. Das Panel zeigt den Befehl für Claude Code oder die Konfiguration für andere Clients. Ein Agent kann dann über dasselbe SDK, das der Editor nutzt, ein Projekt aufbauen, graden und exportieren, und jede Änderung ist ein Rückgängig-Schritt, den du sehen kannst. Jeder Aufruf, der das Projekt ändert, speichert es.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
