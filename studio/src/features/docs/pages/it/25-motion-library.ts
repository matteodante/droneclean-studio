import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.5,
  slug: 'motion-library',
  title: 'Applicare e riutilizzare il movimento',
  description:
    'Applica preset modificabili, aggiungi comportamenti dal vivo, regola il movimento del testo e salva l’animazione per riutilizzarla.',
  category: 'Creative Tools',
  related: ['motion', 'keyframes', 'properties', 'text-captions-subtitles'],
  sections: [
    {
      title: 'Scegliere la superficie di animazione giusta',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio usa un unico sistema di animazione in due posti. Usa la scheda compatta **Animazione** mentre modifichi una clip di sequenza, oppure apri **Motion** per il lavoro di composizione a livelli.',
        },
        {
          kind: 'table',
          headers: ['Superficie', 'A che cosa serve'],
          rows: [
            [
              'Montaggio > Animazione',
              'Preset comuni, stato delle animazioni applicate, movimento del testo e creazione o riapertura di una clip Motion',
            ],
            [
              'Motion > Libreria Motion',
              'Il catalogo completo dei preset, i comportamenti dal vivo, le animazioni salvate e i controlli del livello selezionato',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Seleziona una o più clip di Montaggio e scegli **Crea clip Motion** per conservarle dentro una composizione a livelli. Seleziona una clip Motion esistente e scegli **Apri in Motion** per modificarne i livelli.',
        },
      ],
    },
    {
      title: 'Applicare un preset modificabile',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Seleziona una o più clip o livelli Motion.',
            'Scegli un preset in **Ingresso**, **Uscita** o **Enfasi**.',
            'Imposta **All’applicazione** su **Sostituisci** per scambiare un movimento con la stessa intenzione, oppure su **Aggiungi** per mantenere i fotogrammi chiave esistenti.',
            'Apri le righe delle proprietà o il grafico dei valori per regolare i fotogrammi chiave generati.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'La sezione **Applicati** elenca separatamente i fotogrammi chiave manuali e ogni applicazione di preset. Seleziona una voce per portare la testina sul suo primo fotogramma chiave.',
        },
      ],
    },
    {
      title: 'Aggiungere un comportamento dal vivo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'I comportamenti dal vivo vengono valutati durante la riproduzione senza creare fotogrammi chiave. Lasciali dal vivo per un movimento regolabile, oppure convertili quando ti serve un controllo a livello di fotogramma.',
        },
        {
          kind: 'table',
          headers: ['Comportamento', 'Risultato'],
          rows: [
            ['Deriva fluttuante', 'Sposta posizione e rotazione'],
            ['Ondeggiamento', 'Ruota avanti e indietro'],
            ['Pulsazione del respiro', 'Cambia dimensione e opacità'],
            ['Rotazione', 'Ruota in modo continuo'],
            [
              'Micro vibrazione',
              'Aggiunge un tremolio casuale ma ripetibile a posizione e rotazione',
            ],
          ],
        },
        {
          kind: 'list',
          items: [
            'Seleziona la tessera di un comportamento per applicarlo con le impostazioni predefinite.',
            'Regola **Intensità** e **Durata** dai suoi controlli applicati.',
            'Leggi la banda tratteggiata nella timeline di Motion per vedere dove agisce il movimento procedurale.',
            'Applica un comportamento a più clip per sfasarne le fasi, invece di muovere ogni clip all’unisono.',
          ],
        },
      ],
    },
    {
      title: 'Regolare il movimento del testo sulla timeline',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Il movimento del testo anima caratteri, parole, righe o l’intera clip attraverso slot dal vivo **Ingresso**, **Uscita** e **Ciclo**.',
        },
        {
          kind: 'list',
          items: [
            'Seleziona una clip di testo, poi scegli un preset per ogni slot nella scheda **Animazione** o nella Libreria Motion.',
            'Trascina il bordo di una banda di movimento del testo in Motion per cambiarne la durata.',
            'Trascina una banda **Ingresso** o **Uscita** lontano dal bordo della clip per sfasarne l’inizio o la fine.',
            'Seleziona la sua voce in **Applicati** per portare la testina sulla banda.',
          ],
        },
      ],
    },
    {
      title: 'Rivedere e ripulire l’animazione applicata',
      blocks: [
        {
          kind: 'list',
          items: [
            'Usa **Applicati** per distinguere fotogrammi chiave manuali, fotogrammi chiave generati, comportamenti dal vivo e movimento del testo.',
            'Rimuovi una singola applicazione di preset senza eliminare i fotogrammi chiave non correlati.',
            'Rimuovi un comportamento dal vivo o uno slot di movimento del testo dalla sua riga.',
            'Quando un taglio lascia fotogrammi chiave fuori dalla clip, usa **Taglia animazione** per eliminare solo quei fotogrammi chiave parcheggiati.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '**Taglia animazione** modifica l’animazione memorizzata. Usa l’azione nel messaggio o Annulla se ti servono di nuovo i fotogrammi chiave rimossi.',
        },
      ],
    },
    {
      title: 'Convertire, salvare e riutilizzare il movimento',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Scegli **Converti in fotogrammi chiave** per campionare i comportamenti dal vivo dei livelli in fotogrammi chiave modificabili delle proprietà.',
            'Seleziona una clip con l’animazione che vuoi conservare.',
            'Scegli **Salva animazione**, inserisci un nome e salvala nella libreria del progetto.',
            'Applica l’animazione salvata a un’altra clip o a un altro livello compatibile.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le animazioni salvate possono includere fotogrammi chiave modificabili, comportamenti dal vivo dei livelli, movimento del testo o una combinazione. I progetti esportati portano con sé la loro libreria di animazioni salvate.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
