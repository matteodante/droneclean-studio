import type { DocPageContent } from '../../docs-content'

const page = {
  order: 10,
  slug: 'properties',
  title: 'Proprietà della clip',
  description:
    'Trasformazione, ritaglio, opacità e fusione, e i controlli specifici per ogni tipo di clip.',
  category: 'Core Editing',
  related: ['audio', 'text-captions-subtitles', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Come la selezione guida il pannello',
      blocks: [
        {
          kind: 'list',
          items: [
            'Seleziona una clip per modificarne l’intero insieme di proprietà.',
            'Seleziona più clip per cambiare una proprietà comune a tutte insieme.',
            'Il pannello mostra le schede solo per i gruppi di proprietà che valgono per la selezione corrente.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Un valore **Misto** significa che le clip selezionate al momento non condividono quell’impostazione; cambiarlo applica un solo valore a tutte.',
        },
      ],
    },
    {
      title: 'Controlli comuni alle clip visive',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Trasformazione**: posizione, dimensione, rotazione e punto di ancoraggio.',
            '**Ritaglio**: ritaglia ogni bordo verso l’interno, con un controllo di morbidezza per il bordo del ritaglio.',
            '**Opacità** e **Fusione**: dissolvi una clip e scegli come si compone sopra i livelli sottostanti.',
            '**Video**: velocità di riproduzione e temporizzazione correlata per le clip video.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Molti controlli numerici si possono animare: cerca l’interruttore dei fotogrammi chiave accanto al valore.',
        },
      ],
    },
    {
      title: 'Controlli specifici per tipo',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo di clip', 'Controlli'],
          rows: [
            [
              'Audio',
              'Guadagno, dissolvenza in entrata/uscita, intonazione e un equalizzatore per clip (vedi Montaggio audio).',
            ],
            [
              'Testo',
              'Contenuto, carattere, dimensione, colore, allineamento, sfondo, spaziatura, effetti e animazione (vedi la pagina Testo).',
            ],
            ['Forma', 'Tipo di forma, tracciato, riempimento, contorno, maschera e sfumatura.'],
            [
              'Sottotitolo',
              'Temporizzazione e testo delle battute, più i preset di stile delle didascalie.',
            ],
            ['Colore', 'Ruote, curve e strumenti di correzione colore (vedi Effetti e colore).'],
          ],
        },
      ],
    },
    {
      title: 'Marcatori',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Il pannello delle proprietà elenca ogni marcatore del progetto sotto l’intestazione **Marcatori**, in ordine di tempo. L’elenco è sempre disponibile: compare sotto le impostazioni del canvas quando non c’è nulla di selezionato, e sotto l’editor del marcatore quando ne è selezionato uno, così puoi sfogliare e raggiungere i tuoi marcatori qualunque cosa sia selezionata.',
        },
        {
          kind: 'list',
          items: [
            'Ogni riga mostra il colore del marcatore, la sua etichetta (o un nome predefinito se non ne ha una) e il suo timecode.',
            'Seleziona una riga per renderla il marcatore attivo e portare la testina in quel punto.',
            'Usa l’icona del cestino su una riga per rimuovere quel singolo marcatore.',
            '**Cancella tutti** rimuove tutti i marcatori in una volta.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Premi `M` per inserire un marcatore alla testina. Quando l’elenco è vuoto mostra questo suggerimento.',
        },
        {
          kind: 'paragraph',
          text: 'Selezionando un marcatore si apre il suo editor sopra l’elenco, dove puoi cambiare la posizione del **Fotogramma**, modificare l’**Etichetta** e impostare il **Colore** da un campione predefinito o ripristinarlo al valore di default. Il campo **Tempo** mostra il timecode del marcatore in sola lettura, ed **Elimina marcatore** lo rimuove.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
