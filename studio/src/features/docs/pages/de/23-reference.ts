import type { DocPageContent } from '../../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: 'Referenz',
  description: 'Unterstützte Formate und ein Glossar der in diesem Handbuch verwendeten Begriffe.',
  category: 'Reference',
  related: ['concepts', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Formate',
      blocks: [
        {
          kind: 'table',
          headers: ['Verwendung', 'Typen'],
          rows: [
            ['Import', 'Video, Audio, Bild, GIF, SVG, erzeugte Assets, Compound-Clips'],
            ['Videoexport', 'MP4, MOV, WebM, MKV'],
            ['Audioexport', 'MP3, AAC, WAV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Die Codec-Unterstützung hängt davon ab, was dein Browser decodieren und codieren kann.',
        },
      ],
    },
    {
      title: 'Begriffe zum Schnitt',
      blocks: [
        {
          kind: 'table',
          headers: ['Begriff', 'Bedeutung'],
          rows: [
            [
              'In/Out-Bereich',
              'Ein markierter Anfang und ein markiertes Ende für Quellbearbeitungen und Exportbereiche.',
            ],
            [
              'Quellreserve',
              'Reserveframes jenseits einer Clipkante, die für Trims und Übergänge nötig sind.',
            ],
            [
              'Ripple-Bearbeitung',
              'Eine Bearbeitung, die späteres Material verschiebt, um Platz auf der Zeitleiste zu öffnen oder zu schließen.',
            ],
            [
              'Rolling-Bearbeitung',
              'Eine Bearbeitung, die den Schnitt zwischen zwei benachbarten Clips verschiebt.',
            ],
            [
              'Slip-Bearbeitung',
              'Ändert die Quellframes in einem Clip, ohne den Clip zu verschieben.',
            ],
            [
              'Slide-Bearbeitung',
              'Verschiebt einen Clip und passt dabei seine benachbarten Schnitte an.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Funktionsbegriffe',
      blocks: [
        {
          kind: 'table',
          headers: ['Begriff', 'Bedeutung'],
          rows: [
            [
              'Arbeitsbereich',
              'Der Ordner, aus dem DroneClean Studio liest und in den es schreibt.',
            ],
            [
              'Proxy',
              'Eine leichtere, erzeugte Kopie schwerer Medien für eine flüssigere Wiedergabe.',
            ],
            [
              'Compound-Clip',
              'Ein Abschnitt der Zeitleiste, zu einem einzigen wiederverwendbaren Medienelement gruppiert.',
            ],
            [
              'Einstellungsebene',
              'Eine Ebene, deren Effekte und Farbkorrektur auf die darunterliegenden Clips wirken.',
            ],
            [
              'Keyframe',
              'Ein zu einem bestimmten Zeitpunkt gesetzter Wert, um eine Eigenschaft zu animieren.',
            ],
            ['LUT', 'Eine Lookup-Tabelle (.cube), die eine Farbtransformation anwendet.'],
            [
              'Patch-Ziel',
              'Die Spur der Zeitleiste, an die eine Bearbeitung aus dem Quellmonitor gesendet wird.',
            ],
            [
              'Render-Warteschlange',
              'Eine geordnete Liste von Exporten, die nacheinander gerendert werden.',
            ],
            ['Vorabprüfung', 'Die Bereitschaftsprüfung, die vor dem Start eines Exports läuft.'],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
