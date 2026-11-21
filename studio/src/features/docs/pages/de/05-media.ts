import type { DocPageContent } from '../../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Medienbibliothek',
  description:
    'Medien importieren, Dateien prüfen und Proxys, Transkripte, Untertitel und KI-Szenendaten erzeugen.',
  category: 'Core Editing',
  related: ['source-monitor', 'timeline', 'scene-browser', 'export'],
  sections: [
    {
      title: 'Medien importieren',
      blocks: [
        {
          kind: 'list',
          items: [
            'Öffne den Tab **Medien** und wähle mit **Importieren** Dateien aus, oder ziehe Dateien direkt in die Bibliothek.',
            'DroneClean Studio verarbeitet Video, Audio, Bilder, GIFs, SVGs, Lottie-Animationen (`.json` und `.lottie`) und erzeugte Assets. GIFs werden als Bildelemente importiert.',
            'Nutze **Medien von URL importieren** für einen direkten Link auf eine Mediendatei – die URL muss auf die Datei selbst zeigen, nicht auf eine Seite, die sie einbettet.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Apple-ProRes-Material wird importiert, in der Vorschau angezeigt und mit Vorschaubildern versehen wie jeder andere Clip – auch in Formaten, die Browser von sich aus nicht decodieren können. Beim Export werden ProRes-Clips in den von dir gewählten Ausgabecodec neu codiert; ein ProRes-Ausgabeformat gibt es nicht.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Der Import ganzer Ordner wird noch nicht unterstützt – ziehe die Mediendateien direkt hinein. Was sich decodieren lässt, hängt von deinem Browser ab; wenn eine Datei sich nicht importieren lässt, probiere ein anderes Format oder transcodiere sie zuerst.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Log-Material (S-Log3 und Ähnliches) sieht absichtlich flau und ausgewaschen aus – so wird es aufgenommen. Füge eine LUT oder eine Farbkorrektur hinzu, um es zurückzuholen; mit der Datei ist nichts falsch.',
        },
      ],
    },
    {
      title: 'Einen Clip prüfen',
      blocks: [
        {
          kind: 'list',
          items: [
            'Öffne **Medieninformationen**, um Codec, Abmessungen, Dauer, Bildrate, Dateigröße, Typ und Transkriptstatus zu sehen.',
            'Doppelklicke auf eine Medienkarte oder nutze **Im Quellmonitor öffnen**, um eine Quelle in der Vorschau anzusehen, bevor du sie in den Schnitt übernimmst.',
            'Medienkarten bieten Menüs für Datei, Proxy, Transkript, Eingebettete Untertitel und KI-Aktionen.',
            'Sortiere, filtere und gruppiere Assets nach Typ, wenn die Bibliothek groß wird.',
          ],
        },
      ],
    },
    {
      title: 'Hilfsdaten erzeugen',
      blocks: [
        {
          kind: 'table',
          headers: ['Aktion', 'Was du bekommst'],
          rows: [
            [
              'Proxy erstellen',
              'Eine leichtere Version eines schweren Videos für flüssigeres Schneiden; der Export verwendet weiterhin das Original.',
            ],
            [
              'Transkript erstellen',
              'Bearbeitbarer Sprachtext, den du durchsuchen und in Untertitel umwandeln kannst.',
            ],
            [
              'Eingebettete Untertitel extrahieren',
              'Aus der Datei gezogene Untertitelspuren, bereit zum Einfügen in die Zeitleiste.',
            ],
            [
              'Mit KI analysieren',
              'Lokale Szenenerkennung und Beschriftung, damit Clips im Szenenbrowser durchsuchbar werden.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Compound-Clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Fasse einen Abschnitt der Zeitleiste zu einem **Compound-Clip** zusammen, der sich wie ein einzelnes, wiederverwendbares Medienelement verhält.',
            'Compound-Clips erscheinen in der Medienbibliothek und lassen sich wie jedes andere Asset erneut platzieren.',
            'Klicke mit der rechten Maustaste auf einen Compound-Clip und wähle **Als Tab öffnen**, um ihn als eigenständige **Sequenz** zu bearbeiten.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Compound-Clips lassen sich verschachteln – einer kann einen anderen enthalten –, solange die Kette nie in sich selbst zurückführt.',
        },
      ],
    },
    {
      title: 'Lottie-Animationen',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Importiere Lottie-Dateien – rohe `.json`-Dateien oder gepackte `.lottie`-Archive – als Zeitleistenelemente, die in Vorschau und Export bildgenau gerendert werden. Wähle einen Lottie-Clip aus, um seine Bearbeitungssteuerung im Abschnitt **Lottie** des Eigenschaften-Panels zu sehen.',
        },
        {
          kind: 'list',
          items: [
            'Steuere die Wiedergabe mit **Geschwindigkeit**, **Rückwärts**, **Schleife** und **Ping-Pong**.',
            'Lege ein Segment mit **Startbild** / **Endbild** fest, um nur einen Teil der Animation abzuspielen, oder wähle einen benannten **Marker**, um das Segment dorthin springen zu lassen.',
            'Färbe die Animation um – vom Autor benannte **Farben** werden zuerst angezeigt, die übrigen Formen sind unter einem Aufklappbereich verstaut; eine gemeinsame Farbe ändert jede Form, die sie verwendet, und **Alle zurücksetzen** stellt die Originale wieder her.',
            'Bearbeite **Text**-Ebenen der Vorlage direkt und passe die bereitgestellten Skalar- und Vektorwert-Slots unter **Eigenschaften** an.',
            'Bei `.lottie`-Archiven, die mehr als eine Animation bündeln, wechselst du mit der Auswahl **Animation** zwischen ihnen; mit der Auswahl **Thema** tauschst du die Paletten, wenn die Datei Themen mitbringt.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Änderungen an Farbe, Text, Slots und Segment erscheinen live im Canvas, während du ziehst oder tippst, und werden als ein einziger Rückgängig-Schritt übernommen. Das Bearbeiten von Animation, Thema, Marker, Segment und Vorlage wirkt jeweils auf einen ausgewählten Lottie-Clip.',
        },
      ],
    },
    {
      title: 'Fehlende Medien beheben',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Fehlende Medien erscheinen, wenn eine verknüpfte Datei verschoben, umbenannt oder gelöscht wurde oder eine erneuerte Berechtigung braucht. Nutze **Zugriff erlauben**, **Suchen**, **Ordner suchen** oder **Anderen Ordner durchsuchen**, um die Verknüpfung wiederherzustellen. Nutze **Offline arbeiten** nur, wenn du später neu verknüpfen willst.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
