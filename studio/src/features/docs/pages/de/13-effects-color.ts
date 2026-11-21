import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'Effekte und Farbe',
  description:
    'GPU-Effekte hinzufügen und stapeln, mit Rädern und Kurven die Farbe korrigieren, Scopes lesen, LUTs anwenden und Korrekturen isolieren.',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: 'Effekte hinzufügen und verwalten',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Wähle einen Clip aus und öffne den Abschnitt **Effekte** in den Eigenschaften.',
            'Nutze **Effekt hinzufügen** und suche dann oder wähle aus einer Kategorie. Du kannst auch eingebaute **Vorgaben** oder deine eigenen gespeicherten Vorgaben hinzufügen.',
            'Ordne den Stapel mit **Nach oben** und **Nach unten** neu – die Reihenfolge ändert, wie Effekte zusammenwirken.',
            'Deaktiviere, setze zurück oder entferne einen Effekt in seinem Panel; numerische Parameter lassen sich per Keyframe animieren.',
          ],
        },
      ],
    },
    {
      title: 'Der Effektkatalog',
      blocks: [
        {
          kind: 'table',
          headers: ['Kategorie', 'Effekte'],
          rows: [
            [
              'Farbe',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['Weichzeichnen', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              'Verzerren',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, Ripple Glass, Glass Mosaic, Blocks, Droste und weitere',
            ],
            [
              'Stilisieren',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, VHS, Halftone, Dither, ASCII, Ink, Pixel Sort, Block Glitch, Color Glitch',
            ],
            ['Keying', 'Chroma Key (Entfernen von Greenscreen und Bluescreen)'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Alle Effekte werden auf der GPU (WebGPU) gerendert. Zu den jüngsten Neuzugängen gehören **Gradient Map**, **VHS**, **CRT**, **Droste**, **Block Glitch**, die Verzerrungen **Ripple Glass** und **Glass Mosaic**, **Ink** und **Pixel Sort**.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**ASCII** kann eigene Zeichen rendern: Stelle **Character Set** auf **Benutzerdefiniert**, gib unter **Eigene Zeichen** deine Zeichen ein (die Reihe geht vom dichtesten zum hellsten) und wähle eine **Schriftart** (Monospace, Courier, Consolas oder Lucida Console). Zu den eingebauten Sets gehören ASCII-Verlauf, Dicht, Binär und Symbole.',
        },
      ],
    },
    {
      title: 'Farbeingaben und die Pipette',
      blocks: [
        {
          kind: 'list',
          items: [
            'Jeder Farbregler akzeptiert einen **Hex**-Wert; tippe ihn direkt in das Feld ein (die Vorschau aktualisiert sich dabei fortlaufend).',
            'Wo Transparenz unterstützt wird, nimmt das Feld 8-stelliges Hex (`#rrggbbaa`) an und die Farbauswahl bietet zusätzlich einen Alpha-Regler.',
            'Klicke auf die **Pipette**, um eine Farbe von beliebiger Stelle in der App oder der Vorschau aufzunehmen; eine Lupe folgt dem Cursor, damit du das exakte Pixel triffst – klicke dann, um zu übernehmen.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Die Pipette ist ein in die App eingebauter Sampler (nicht der native des Browsers) und braucht keine Berechtigungsabfrage. Dasselbe Werkzeug steckt hinter den Rädern im Arbeitsbereich Farbe.',
        },
      ],
    },
    {
      title: 'Farbkorrektur im Arbeitsbereich Farbe',
      blocks: [
        {
          kind: 'list',
          items: [
            'Wechsle in den Arbeitsbereich **Farbe** (`Alt+2`) und wähle einen Clip aus; Räder und Kurven sind bereits bereit, noch bevor eine Farbkorrektur existiert.',
            '**Farbräder** passen Schatten, Mitteltöne, Lichter und Versatz an, mit Weißabgleich-Pipetten und automatischer Balance.',
            '**Kurven** bearbeiten die Kanäle Master, Rot, Grün und Blau; klicke auf eine Kurve, um einen Punkt hinzuzufügen, und doppelklicke auf einen Punkt, um ihn zu entfernen.',
            'Vergleiche mit **Vorher**, **Nachher** und **Geteilt** und kopiere einen Look zwischen Clips mit **Farbkorrektur kopieren** und **Farbkorrektur einfügen**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Farbkorrektur umgehen** zeigt das unkorrigierte Bild in der Vorschau, wirkt sich aber nie auf Exporte aus.',
        },
      ],
    },
    {
      title: 'Die Scopes lesen',
      blocks: [
        {
          kind: 'table',
          headers: ['Scope', 'Zeigt'],
          rows: [
            ['Waveform', 'Helligkeits- und Farbverteilung, von oben nach unten'],
            ['RGB Parade', 'Die Kanäle Rot, Grün und Blau nebeneinander'],
            ['Vectorscope', 'Farbton und Sättigung'],
            ['Histogram', 'Die Verteilung der Tonwerte'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Schalte die Scopes mit **Farb-Scopes anzeigen** um. Waveform und Histogram bieten außerdem RGB-, Einzelkanal- und Luma-Ansichten (Y).',
        },
      ],
    },
    {
      title: 'LUTs und isolierte Korrekturen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Füge den Effekt **LUT (.cube)** hinzu, wähle **.cube-LUT importieren** und stelle dann die **Intensität** ein, um ihn einzublenden.',
            'Der **Secondary Qualifier** legt eine Korrektur auf einen Bereich von Farbton, Sättigung und Luminanz.',
            'Das **Power Window** begrenzt eine Korrektur auf eine Ellipsen- oder Rechteckmaske mit weicher Kante und Invertierung.',
            'Füge eine **Einstellungsebene** hinzu, um jeden Clip auf den darunterliegenden Spuren zu korrigieren oder mit Effekten zu versehen.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Der LUT-Import erfordert einen Chromium-basierten Browser.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
