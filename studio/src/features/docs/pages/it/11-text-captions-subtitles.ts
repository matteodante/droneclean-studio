import type { DocPageContent } from '../../docs-content'

const page = {
  order: 11,
  slug: 'text-captions-subtitles',
  title: 'Testo, didascalie e sottotitoli',
  description:
    'Aggiungi e stilizza clip di testo, genera didascalie da una trascrizione e importa le tracce di sottotitoli incorporate.',
  category: 'Creative Tools',
  related: ['motion-library', 'motion', 'shapes-masks', 'properties', 'local-ai'],
  sections: [
    {
      title: 'Tre cose affini',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo', 'Che cos’è', 'Da dove parte'],
          rows: [
            [
              'Clip di testo',
              'Un elemento autonomo della timeline in cui scrivi',
              'La scheda Testo',
            ],
            [
              'Didascalie',
              'Righe generate che accompagnano una clip video o audio',
              'La trascrizione di una clip',
            ],
            [
              'Sottotitoli',
              'Una traccia di battute sulla timeline',
              'Una traccia incorporata, o didascalie unite',
            ],
          ],
        },
      ],
    },
    {
      title: 'Aggiungere e stilizzare una clip di testo',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Apri la scheda **Testo**, poi fai clic su **Aggiungi testo** o su un modello per inserire il testo alla testina, oppure trascina un modello sulla timeline o sul canvas.',
            'Scegli un layout (**Singolo**, **2 parti**, **3 parti**) e un preset di stile come Clean, Lower Third, Cinematic o Neon.',
            'Nella sezione **Testo** imposta carattere, dimensione (8–500 px), peso, colore, sfondo, allineamento, spaziatura, interlinea, margine interno e raggio.',
            'Aggiungi ombra o contorno in **Effetti**, e anima il testo in **Animazione del testo**.',
          ],
        },
      ],
    },
    {
      title: 'Animazione del testo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Nella sezione **Animazione del testo** (nelle proprietà del testo o nella libreria **Motion** del livello selezionato), ogni carattere, parola o riga può animarsi in modo indipendente. L’animazione del testo resta dal vivo e procedurale, quindi non ci sono fotogrammi chiave di livello da gestire.',
        },
        {
          kind: 'steps',
          items: [
            'Seleziona una clip di testo e apri la sezione **Animazione del testo**.',
            'Scegli un preset nella riga **Ingresso**, **Uscita** o **Ciclo**. **Ingresso** parte all’inizio della clip, **Uscita** alla fine, e **Ciclo** gira in continuazione tra le due.',
            'Fai di nuovo clic sul preset attivo (o sulla sua ✕) per rimuoverlo: un preset per riga.',
            'Regola i controlli che compaiono sotto il preset attivo.',
            'In Motion, trascina il bordo di una banda di movimento del testo per cambiarne la durata, oppure trascina una banda Ingresso o Uscita lontano dal bordo della clip per sfasarla.',
          ],
        },
        {
          kind: 'table',
          headers: ['Controllo', 'Che cosa fa'],
          rows: [
            [
              'Si applica a',
              'L’unità che ogni preset anima: Carattere, Parola, Riga o Intera clip.',
            ],
            ['Durata', 'Lunghezza, in fotogrammi, dell’animazione di ogni unità.'],
            [
              'Sfasamento',
              'Fotogrammi di ritardo tra un’unità e l’altra, per un effetto a cascata.',
            ],
            ['Ordine', 'Quale unità si anima per prima: Avanti, Indietro, Dal centro o Casuale.'],
            ['Intensità', 'Scala la forza dell’effetto, dallo 0 al 200 per cento.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'L’elenco **Applicati** mostra ogni slot di movimento del testo attivo. Seleziona una voce per portare la testina sulla sua banda nella timeline.',
        },
      ],
    },
    {
      title: 'Didascalie da una trascrizione',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Genera una trascrizione per la clip dalla libreria Media o dal pannello Trascrizione.',
            'Usa **Genera didascalie** (o lascia che DroneClean Studio attivi automaticamente le didascalie della trascrizione) dal menu contestuale della clip.',
            'Modifica temporizzazione e testo delle battute, e scegli un preset di stile (Netflix, YouTube, Bold Yellow, Outlined, TikTok) nella sezione **Sottotitolo**.',
            'Regola colore, dimensione, posizione verticale delle didascalie e uno sfondo facoltativo.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Usa **Unisci le didascalie in un segmento** per trasformare le didascalie della trascrizione in un segmento di sottotitoli autonomo.',
        },
      ],
    },
    {
      title: 'Sottotitoli incorporati e importati',
      blocks: [
        {
          kind: 'list',
          items: [
            'Usa **Estrai sottotitoli incorporati** su una scheda media per cercare tracce di sottotitoli in un file.',
            'Nella finestra **Sottotitoli incorporati**, scegli una traccia: ogni riga mostra lingua, codec e numero di battute.',
            'Inserisci la traccia per aggiungere le sue battute alla timeline come segmento di sottotitoli.',
            'Modifica inizio, fine e testo di ogni battuta nella sezione **Sottotitolo**, e imposta Corsivo, Grassetto o Sottolineato per l’intera battuta.',
          ],
        },
      ],
    },
    {
      title: 'Sottotitoli in esportazione',
      blocks: [
        {
          kind: 'note',
          tone: 'info',
          text: 'Attiva **Incorpora sottotitoli** nelle impostazioni di esportazione per includere le didascalie della trascrizione come traccia di sottotitoli (MP4, MKV, WebM). Alcuni lettori nascondono di default le tracce di sottotitoli, quindi gli spettatori potrebbero doverle attivare.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
