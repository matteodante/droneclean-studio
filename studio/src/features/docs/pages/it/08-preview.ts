import type { DocPageContent } from '../../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Anteprima e riproduzione',
  description:
    'Riproduci, avanza di un fotogramma, ingrandisci il monitor, passa a schermo intero, salva fotogrammi, usa la riproduzione proxy, abbassa la risoluzione di riproduzione e renderizza in anticipo un tratto per una riproduzione fluida.',
  category: 'Core Editing',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Riprodurre e spostarsi',
      blocks: [
        {
          kind: 'list',
          items: [
            'Riproduci e metti in pausa con i controlli dell’anteprima o con `Space`.',
            'Avanza un fotogramma alla volta con `Left` e `Right` per controlli precisi al fotogramma.',
            'Salta all’inizio della timeline con `Home` e alla fine con `End`.',
            'Leggi il display del timecode per confermare l’esatta posizione della testina.',
          ],
        },
      ],
    },
    {
      title: 'Inquadrare la vista',
      blocks: [
        {
          kind: 'list',
          items: [
            'Regola lo zoom dell’anteprima per ispezionare i dettagli; questo non cambia il canvas di esportazione.',
            'Usa **Schermo intero** per rivedere movimento o inquadratura, ed Esci da schermo intero per tornare indietro.',
            'Usa **Salva fotogramma** per scrivere il fotogramma corrente in un file immagine.',
            'Le sovrapposizioni di trasformazione, maschera e modifica compaiono sul monitor quando è selezionato un elemento corrispondente.',
          ],
        },
      ],
    },
    {
      title: 'Prestazioni di riproduzione e audio',
      blocks: [
        {
          kind: 'list',
          items: [
            'Quando esistono i proxy, DroneClean Studio li usa per riprodurre con più fluidità i media pesanti; le esportazioni usano comunque gli originali.',
            'Il controllo del volume del monitor influisce solo sulla riproduzione locale.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le esportazioni usano il mix del progetto, quindi il volume del monitor non cambia mai l’audio renderizzato.',
        },
      ],
    },
    {
      title: 'Risoluzione di riproduzione',
      blocks: [
        {
          kind: 'paragraph',
          text: "Il pulsante accanto all'interruttore dei proxy nella barra di trasporto imposta la risoluzione di riproduzione: **Completa**, **1/2** o **1/4**. Una risoluzione più bassa disegna meno pixel per ogni fotogramma che l'anteprima calcola da sé (clip con effetti, stabilizzazione, rampe di velocità, sfocatura di movimento), quindi i tratti pesanti scorrono più veloci; l'immagine è più morbida. L'impostazione vale per tutta l'app e non cambia mai un'esportazione.",
        },
      ],
    },
    {
      title: 'Renderizzare un tratto in anticipo',
      blocks: [
        {
          kind: 'paragraph',
          text: "Le clip stabilizzate con slow motion a flusso ottico e sfocatura di movimento possono essere troppo pesanti per l'anteprima in tempo reale. Renderizzale in anticipo, come in After Effects, e si riproducono alla frequenza piena.",
        },
        {
          kind: 'steps',
          items: [
            'Segna il tratto con In e Out (`I` e `O`), oppure non segnarne nessuno per renderizzare tutta la timeline.',
            "Apri il menu **Render dell'anteprima** nella barra della timeline, accanto ai pulsanti In/Out, e scegli **Renderizza da In a Out**, oppure premi `Enter`.",
            "Segui l'avanzamento nella barra di trasporto; la X lì annulla e tiene quello che è già renderizzato.",
            "Una linea verde lungo il bordo inferiore del righello segna i fotogrammi che ora si riproducono dall'anteprima renderizzata.",
          ],
        },
        {
          kind: 'list',
          items: [
            'I fotogrammi vengono renderizzati alla risoluzione di riproduzione attuale e tenuti in memoria (fino a 1 GB, circa quattro minuti e mezzo a 1080p 60 fps) finché non chiudi il progetto.',
            "Qualsiasi modifica che cambia un fotogramma (una clip, un effetto, un fotogramma chiave, una transizione, la stabilizzazione, la velocità, le dimensioni o la frequenza del progetto, la risoluzione di riproduzione o l'interruttore dei proxy) toglie subito quei fotogrammi dalla linea verde: l'anteprima li ricalcola dal vivo, mai un'immagine vecchia.",
            "Renderizzare di nuovo calcola solo i fotogrammi che mancano. **Elimina l'anteprima renderizzata** nello stesso menu libera la memoria.",
            "Le esportazioni non usano mai l'anteprima renderizzata: renderizzano sempre dal progetto.",
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: "Se il computer non riesce a codificare i fotogrammi alle dimensioni dell'anteprima, o si raggiunge il limite di memoria, un messaggio lo dice e l'anteprima resta dal vivo.",
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
