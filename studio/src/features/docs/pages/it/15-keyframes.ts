import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Animare con i fotogrammi chiave',
  description:
    'Anima i valori di trasformazione, ritaglio, testo, effetti e audio con fotogrammi chiave, andamento ed editor delle curve.',
  category: 'Creative Tools',
  related: ['motion', 'motion-library', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Scegliere dove modificare i fotogrammi chiave',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Montaggio mantiene compatto il lavoro sui fotogrammi chiave. Motion espone il dope sheet completo dei livelli e il grafico, per un lavoro più profondo su tempi e curve.',
        },
        {
          kind: 'table',
          headers: ['Superficie', 'Flusso di lavoro dei fotogrammi chiave'],
          rows: [
            [
              'Montaggio',
              'Seleziona una clip e premi `K` per aggiungere un fotogramma chiave alla sua proprietà attiva. Apri **Animazione** in Proprietà per i preset e lo stato di applicazione.',
            ],
            [
              'Motion',
              'Espandi un livello per vedere le righe delle proprietà, i rombi dei fotogrammi chiave, l’andamento dei segmenti e un grafico dei valori in linea.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'In Motion, la testina condivisa, la selezione, l’aggancio, il righello, le corsie delle proprietà e il grafico usano lo stesso asse temporale.',
        },
      ],
    },
    {
      title: 'Aggiungere un fotogramma chiave',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Sposta la testina sul fotogramma in cui vuoi inserire il fotogramma chiave.',
            'Digita un valore accanto a un parametro e premi `Enter`, oppure fai clic sul **rombo** nella riga del parametro.',
            'Spostati su un altro fotogramma e imposta un secondo valore per creare movimento tra i due.',
            'Attiva i **fotogrammi chiave automatici** con l’icona del timer, o premi `A`, per registrare automaticamente le successive modifiche di valore.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Non puoi aggiungere un fotogramma chiave dentro una regione di transizione, né con la testina fuori dai limiti della clip: lì il rombo è disattivato.',
        },
      ],
    },
    {
      title: 'Che cosa puoi animare',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo di clip', 'Valori animabili'],
          rows: [
            [
              'Tutte le clip visive',
              'Posizione X / Y, larghezza, altezza, rotazione, opacità, raggio degli angoli',
            ],
            [
              'Video',
              'Aggiunge punto di ancoraggio, i quattro bordi del ritaglio, morbidezza del ritaglio e volume',
            ],
            [
              'Testo',
              'Aggiunge scala del preset, dimensione del carattere, interlinea, margine interno, raggio dello sfondo, ombra e contorno',
            ],
            ['Audio', 'Volume in decibel'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Anche gli effetti contribuiscono con i propri parametri animabili: cerca l’interruttore dei fotogrammi chiave accanto a ogni cursore.',
        },
      ],
    },
    {
      title: 'Dare forma al movimento',
      blocks: [
        {
          kind: 'list',
          items: [
            'Fai clic sul **connettore** tra due fotogrammi chiave per aprire l’**editor dell’andamento**.',
            'Sfoglia le curve preimpostate in **Andamento cubico** e **Molla**. Filtra per **Tutti**, **In**, **Out** o **Ingresso-Uscita**.',
            'Scegli **Mantieni** per conservare il valore precedente fino al fotogramma chiave successivo.',
            'Passa a **Modifica** per modellare direttamente la curva: trascina le due maniglie di controllo sul grafico, oppure digita valori esatti. Le molle espongono **tensione**, **attrito** e **massa** e mostrano in anteprima il loro vero rimbalzo.',
            'Senti i tempi su **Posizione**, **Scala**, **Rotazione** oppure **Opacità** nell’anteprima dal vivo, e metti in **Pausa** il ciclo.',
            'Salva una curva ritoccata come **preset personalizzato** con **Salva come**, **Aggiornalo** più tardi, oppure **Ripristina** il preset da cui proviene. I preset personalizzati sono salvati sul tuo dispositivo e compaiono in ogni progetto.',
            'Copia, taglia, incolla ed elimina i fotogrammi chiave, seleziona gruppi con il rettangolo di selezione, trascina per cambiarne la temporizzazione e trascina con `Alt` per duplicare.',
          ],
        },
      ],
    },
    {
      title: 'Lavorare nel grafico dei valori',
      blocks: [
        {
          kind: 'list',
          items: [
            'Scegli una proprietà dal menu a tendina per modificarne la curva, oppure lascia su tutte per vedere le altre come curve sfumate in sovrapposizione. Accanto compare il numero di fotogrammi chiave della proprietà attiva.',
            'Il grafico disegna una **griglia** etichettata, con fotogrammi o secondi in orizzontale e valori in verticale, così puoi leggere le posizioni a colpo d’occhio.',
            'Inquadra la curva con **Adatta al contenuto**, oppure sposta la vista con **Ingrandisci** / **Riduci** e la rotellina del mouse. **Ripristina vista** torna all’adattamento predefinito.',
            'Scorri i fotogrammi chiave con le frecce **precedente** / **successivo**, poi digita un fotogramma esatto (**F**) e un valore (**V**) per il fotogramma chiave selezionato.',
            'Mentre trascini un fotogramma chiave, tieni premuto **Shift** per bloccarlo su un asse, oppure **Alt** per la regolazione fine.',
          ],
        },
      ],
    },
    {
      title: 'Convertire e ripulire il movimento generato',
      blocks: [
        {
          kind: 'paragraph',
          text: 'I comportamenti dal vivo come deriva, respiro, vibrazione e rotazione vengono valutati durante la riproduzione senza creare fotogrammi chiave sulle proprietà.',
        },
        {
          kind: 'list',
          items: [
            'Scegli **Converti in fotogrammi chiave** per trasformare i comportamenti dal vivo dei livelli in fotogrammi chiave modificabili.',
            'Usa **Applicati** per raggiungere i fotogrammi chiave manuali o il primo fotogramma di un preset generato.',
            'Usa **Taglia animazione** quando il taglio di una clip lascia fotogrammi chiave memorizzati fuori dalla sua durata visibile.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Leggi [Applicare e riutilizzare il movimento](motion-library) per preset, comportamenti dal vivo, movimento del testo, conversione e animazioni salvate.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
