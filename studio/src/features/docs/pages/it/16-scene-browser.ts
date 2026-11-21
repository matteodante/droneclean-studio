import type { DocPageContent } from '../../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: 'Navigatore scene e analisi IA',
  description:
    'Analizza i media in locale per descrivere le scene, poi cerca per parola chiave, significato o colore.',
  category: 'Creative Tools',
  related: ['media', 'local-ai', 'source-monitor'],
  sections: [
    {
      title: 'Analizzare con l’IA',
      blocks: [
        {
          kind: 'list',
          items: [
            'Esegui **Analizza con IA** su una clip dalla libreria media, oppure dal menu **Analizza** del Navigatore scene.',
            'L’analisi gira interamente sul tuo computer: rileva le scene, descrive ciascuna, estrae una tavolozza di colori e costruisce embedding di testo e immagine.',
            'Scegli **Analizza i nuovi media** per le clip senza didascalie, oppure **Rianalizza tutto** per aggiornare ogni cosa.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'I risultati sono messi in cache in base al contenuto, quindi i media identici vengono riutilizzati invece di essere analizzati di nuovo.',
        },
      ],
    },
    {
      title: 'Aprire il Navigatore scene',
      blocks: [
        {
          kind: 'list',
          items: [
            'Apri il Navigatore scene dalla libreria media, oppure con `Ctrl+Shift+F`.',
            'Cerca nelle didascalie IA e nei dati di scena prodotti da Analizza con IA.',
            'Imposta l’ambito su tutti i media analizzati o su una singola clip, e ordina per **Pertinenza**, **Posizione temporale** o **Nome del media**.',
            'Passa tra **Vista a elenco** e **Vista a griglia** a seconda che tu voglia sfogliare o scorrere.',
          ],
        },
      ],
    },
    {
      title: 'Modalità di ricerca',
      blocks: [
        {
          kind: 'table',
          headers: ['Modalità', 'Trova in base a'],
          rows: [
            [
              'Parola chiave',
              'Le parole esatte di una didascalia: ottima per un oggetto o un’etichetta specifici.',
            ],
            [
              'Semantica',
              'Il significato, quindi «tramonto sull’acqua» trova scene correlate (al primo uso scarica un piccolo modello, ~22 MB).',
            ],
            ['Colore', 'Una tavolozza simile: scegli un campione dalla tavolozza della libreria.'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'I risultati portano etichette di corrispondenza (Forte, Buona o Discreta) e indicano se la corrispondenza è per parola chiave, significato, somiglianza visiva o colore.',
        },
      ],
    },
    {
      title: 'Usare un risultato',
      blocks: [
        {
          kind: 'list',
          items: [
            'Fai clic su una scena per vederla in anteprima nel monitor sorgente.',
            'Trascina una scena sulla timeline per aggiungere quel momento al tuo montaggio.',
            'Se non viene trovato nulla, verifica che la clip sia stata analizzata: solo i media analizzati sono ricercabili.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
