import type { DocPageContent } from '../../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Audiobearbeitung',
  description:
    'Ein Voiceover aufnehmen, Clip-Verstärkung und Ein-/Ausblendungen, Tonhöhe, EQ pro Clip, Mixer und Pegelanzeigen sowie das Bereinigen von Stille und Füllwörtern.',
  category: 'Creative Tools',
  related: ['properties', 'local-ai'],
  sections: [
    {
      title: 'Einen Clip anpassen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Wähle einen Clip aus und öffne den Tab **Audio** in den Eigenschaften.',
        },
        {
          kind: 'table',
          headers: ['Regler', 'Bereich'],
          rows: [
            ['Verstärkung', '-60 dB bis +12 dB (−60 dB schaltet den Clip praktisch stumm)'],
            ['Einblenden / Ausblenden', 'je 0 bis 5 Sekunden'],
            ['Tonhöhe', 'Halbtöne und Cent, unabhängig von der Geschwindigkeit'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Du kannst die Lautstärkelinie und die Blendengriffe auch direkt am Clip in der Zeitleiste ziehen, und die **Verstärkung** lässt sich per Keyframe über einen Clip hinweg anheben oder absenken.',
        },
      ],
    },
    {
      title: 'Tonhöhe und Klang',
      blocks: [
        {
          kind: 'list',
          items: [
            'Die Regler unter **Tonhöhe** verschieben die Tonhöhe, ohne die Clip-Geschwindigkeit zu ändern. Um stattdessen die Geschwindigkeit zu ändern, nutze **Geschwindigkeit** im Tab Video.',
            'Der Abschnitt **Equalizer** gibt jedem Clip einen Kurveneditor zur Klangformung.',
          ],
        },
      ],
    },
    {
      title: 'Mixer und Pegelanzeigen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Öffne die Audio-**Pegelanzeigen**, um beim Abspielen die Stereopegel zu beobachten und Übersteuerung zu erkennen.',
            'Nutze den **Mixer**, um die Pegel im ganzen Projekt auszubalancieren.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Die Monitorlautstärke in der Vorschau wirkt nur auf die lokale Wiedergabe und ändert nie den exportierten Mix.',
        },
      ],
    },
    {
      title: 'Ein Voiceover aufnehmen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Die Schaltfläche **Voiceover aufnehmen** (Mikrofon) in der Zeitleisten-Symbolleiste nimmt einen Sprechertext im Takt deines Projekts auf. Die Aufnahme läuft, **während die Zeitleiste abgespielt wird**, und die fertige Aufnahme landet auf einer neuen Audiospur, verankert an der Position des Abspielkopfs, an der du gestartet hast.',
        },
        {
          kind: 'steps',
          items: [
            'Setze den Abspielkopf dorthin, wo das Voiceover beginnen soll.',
            'Klicke auf die Schaltfläche **Mikrofon** – die Zeitleiste beginnt abzuspielen und die Aufnahme startet.',
            'Nutze **Aufnahme pausieren**, um Abspielkopf und Mikrofon gemeinsam anzuhalten, **Aufnahme fortsetzen**, um weiterzumachen, und **Stoppen und speichern**, um zu beenden und den Clip auf einer neuen Audiospur abzulegen.',
            'Klicke auf **Aufnahme abbrechen** (das ✕), um die Aufnahme zu verwerfen, ohne etwas hinzuzufügen.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Öffne die **Mikrofoneinstellungen** (das ▾ neben der Schaltfläche), um ein Eingabegerät zu wählen und die Aufnahme abzustimmen. Die Pegelanzeige dort läuft live, sodass du dein Mikrofon vor der Aufnahme prüfen kannst.',
        },
        {
          kind: 'table',
          headers: ['Einstellung', 'Was sie bewirkt'],
          rows: [
            [
              'Rauschunterdrückung',
              'Verringert gleichmäßiges Hintergrundrauschen. Standardmäßig an.',
            ],
            [
              'Automatische Verstärkung',
              'Hält deine Stimme auf einem gleichbleibenden Pegel. Standardmäßig an.',
            ],
            [
              'Zeitleiste während der Aufnahme stummschalten',
              'Schaltet den Zeitleisten-Monitor stumm, damit Lautsprecher-Audio nicht ins Mikrofon gelangt. Standardmäßig an.',
            ],
            [
              'Sync-Versatz',
              'Verschiebt den aufgenommenen Clip früher oder später, um die Eingabelatenz auszugleichen (bis zu ±1000 ms).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Nutze Kopfhörer, damit das Projekt-Audio nie vom Mikrofon aufgenommen wird – dann kannst du **Zeitleiste während der Aufnahme stummschalten** ausschalten, um den Mix beim Sprechen zu hören.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Das Springen in der Zeitleiste ist während der Aufnahme deaktiviert, und `Space` oder das Erreichen des Zeitleistenendes beendet die Aufnahme. So bleibt die Aufnahme an den Abspielkopf gebunden und kann nie aus dem Takt geraten.',
        },
      ],
    },
    {
      title: 'Dialoge bereinigen',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Stille entfernen** findet stille Bereiche und schneidet sie heraus; die Einstellung **Mindestdauer der Stille** legt fest, wie lang eine Pause sein muss, und der Dialog schätzt, wie viel entfernt wird.',
            '**Füllwörter entfernen** erkennt Wörter wie „äh“ und „ähm“ anhand von Transkript und Audio und entfernt sie.',
            'Beide Werkzeuge zeigen die Bereiche, die sie entfernen werden, sodass du eine Vorschau sehen kannst, bevor du die Bearbeitung anwendest.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Ein Transkript verbessert die Erkennung von Füllwörtern, erzeuge daher zuerst eines, um die besten Ergebnisse zu erzielen.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
