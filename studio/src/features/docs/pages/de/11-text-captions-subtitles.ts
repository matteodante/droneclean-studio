import type { DocPageContent } from '../../docs-content'

const page = {
  order: 11,
  slug: 'text-captions-subtitles',
  title: 'Text, Untertitel und Transkript-Untertitel',
  description:
    'Text-Clips hinzufügen und gestalten, Untertitel aus einem Transkript erzeugen und eingebettete Untertitelspuren importieren.',
  category: 'Creative Tools',
  related: ['motion-library', 'motion', 'shapes-masks', 'properties', 'local-ai'],
  sections: [
    {
      title: 'Drei verwandte Dinge',
      blocks: [
        {
          kind: 'table',
          headers: ['Art', 'Was es ist', 'Ausgangspunkt'],
          rows: [
            [
              'Text-Clip',
              'Ein eigenständiges Zeitleistenelement, in das du tippst',
              'Der Tab Text',
            ],
            [
              'Untertitel aus Transkript',
              'Erzeugte Zeilen, die an einem Video- oder Audioclip hängen',
              'Das Transkript eines Clips',
            ],
            [
              'Untertitel',
              'Eine Cue-Spur auf der Zeitleiste',
              'Eine eingebettete Spur oder zusammengefasste Untertitel',
            ],
          ],
        },
      ],
    },
    {
      title: 'Einen Text-Clip hinzufügen und gestalten',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Öffne den Tab **Text** und klicke dann auf **Text hinzufügen** oder auf eine Vorlage, um Text am Abspielkopf zu platzieren – oder ziehe eine Vorlage auf die Zeitleiste oder den Canvas.',
            'Wähle ein Layout (**Einzeln**, **2 Abschnitte**, **3 Abschnitte**) und eine Stilvorgabe wie Clean, Lower Third, Cinematic oder Neon.',
            'Lege im Abschnitt **Text** Schrift, Größe (8–500 px), Stärke, Farbe, Hintergrund, Ausrichtung, Abstand, Zeilenhöhe, Innenabstand und Radius fest.',
            'Füge unter **Effekte** Schatten oder Kontur hinzu und animiere den Text unter **Textanimation**.',
          ],
        },
      ],
    },
    {
      title: 'Textanimation',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Im Abschnitt **Textanimation** (in den Texteigenschaften oder in der **Motion**-Bibliothek der ausgewählten Ebene) kann jedes Zeichen, Wort oder jede Zeile unabhängig animiert werden. Die Textanimation bleibt live und prozedural, sodass es keine Ebenen-Keyframes zu verwalten gibt.',
        },
        {
          kind: 'steps',
          items: [
            'Wähle einen Text-Clip aus und öffne den Abschnitt **Textanimation**.',
            'Wähle eine Vorgabe in der Zeile **Eingang**, **Ausgang** oder **Schleife**. **Eingang** läuft am Clipanfang, **Ausgang** am Clipende und **Schleife** läuft dazwischen kontinuierlich.',
            'Klicke erneut auf die aktive Vorgabe (oder auf ihr ✕), um sie zu entfernen – pro Zeile gibt es eine Vorgabe.',
            'Passe die Regler an, die unter der aktiven Vorgabe erscheinen.',
            'Ziehe in Motion die Kante eines Textbewegungs-Bands, um seine Dauer zu ändern, oder ziehe ein Eingang- oder Ausgang-Band vom Clip-Rand weg, um es zu versetzen.',
          ],
        },
        {
          kind: 'table',
          headers: ['Regler', 'Was er bewirkt'],
          rows: [
            [
              'Anwenden auf',
              'Die Einheit, die jede Vorgabe animiert: Zeichen, Wort, Zeile oder Ganzer Clip.',
            ],
            ['Dauer', 'Länge der Animation jeder Einheit, in Frames.'],
            [
              'Versatz',
              'Frames Verzögerung zwischen den einzelnen Einheiten, für einen Kaskadeneffekt.',
            ],
            [
              'Reihenfolge',
              'Welche Einheit zuerst animiert wird: Vorwärts, Rückwärts, Von der Mitte oder Zufällig.',
            ],
            ['Intensität', 'Skaliert die Effektstärke von 0 bis 200 Prozent.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Die Liste **Angewendet** zeigt jeden aktiven Textbewegungs-Slot. Wähle einen Eintrag aus, um den Abspielkopf an sein Band auf der Zeitleiste zu setzen.',
        },
      ],
    },
    {
      title: 'Untertitel aus einem Transkript',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Erzeuge ein Transkript für den Clip in der Medienbibliothek oder im Transkript-Panel.',
            'Nutze im Kontextmenü des Clips **Untertitel erzeugen** (oder lass DroneClean Studio Transkript-Untertitel automatisch aktivieren).',
            'Bearbeite Timing und Text der Cues und wähle im Abschnitt **Untertitel** eine Stilvorgabe (Netflix, YouTube, Bold Yellow, Outlined, TikTok).',
            'Passe Untertitelfarbe, Größe, vertikale Position und einen optionalen Hintergrund an.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Nutze **Untertitel zu Segment zusammenfassen**, um Transkript-Untertitel in ein eigenständiges Untertitelsegment umzuwandeln.',
        },
      ],
    },
    {
      title: 'Eingebettete und importierte Untertitel',
      blocks: [
        {
          kind: 'list',
          items: [
            'Nutze **Eingebettete Untertitel extrahieren** auf einer Medienkarte, um eine Datei nach Untertitelspuren zu durchsuchen.',
            'Wähle im Dialog **Eingebettete Untertitel** eine Spur aus – jede Zeile zeigt ihre Sprache, ihren Codec und die Anzahl der Cues.',
            'Füge die Spur ein, um ihre Cues als Untertitelsegment zur Zeitleiste hinzuzufügen.',
            'Bearbeite Start, Ende und Text jedes Cues im Abschnitt **Untertitel** und setze für den ganzen Cue Kursiv, Fett oder Unterstrichen.',
          ],
        },
      ],
    },
    {
      title: 'Untertitel beim Export',
      blocks: [
        {
          kind: 'note',
          tone: 'info',
          text: 'Aktiviere in den Exporteinstellungen **Untertitel einbetten**, um Transkript-Untertitel als Untertitelspur einzuschließen (MP4, MKV, WebM). Manche Player blenden Untertitelspuren standardmäßig aus, sodass Zuschauer sie womöglich einschalten müssen.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
