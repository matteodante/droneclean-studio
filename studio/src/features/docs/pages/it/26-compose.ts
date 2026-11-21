import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.75,
  slug: 'motion',
  title: 'Usare l’area di lavoro Motion',
  description:
    'Costruisci, temporizza, anima, collega con genitori e riutilizza composizioni 2D a livelli nell’area di lavoro Motion.',
  category: 'Creative Tools',
  related: ['motion-library', 'keyframes', 'shapes-masks', 'concepts'],
  sections: [
    {
      title: 'Aprire o creare una composizione Motion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Motion riunisce in un’unica area di lavoro la libreria media, l’anteprima della composizione, la timeline dei livelli, le proprietà, i fotogrammi chiave, il grafico e la Libreria Motion.',
        },
        {
          kind: 'steps',
          items: [
            'Scegli **Motion** nel selettore delle aree di lavoro, oppure premi `Alt+3`.',
            'Scegli una composizione esistente dal menu delle composizioni, oppure scegli **Nuova comp.**.',
            'Per promuovere le clip di una sequenza, selezionale in Montaggio, apri **Animazione** e scegli **Crea clip Motion**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Creare una clip Motion conserva le clip selezionate e la loro animazione dentro la nuova composizione. Il nuovo contenitore resta una normale clip in Montaggio.',
        },
      ],
    },
    {
      title: 'Aggiungere livelli alla composizione',
      blocks: [
        {
          kind: 'list',
          items: [
            'Trascina video, audio, immagini, testo, forme, file Lottie o un’altra composizione dalla libreria media.',
            'Scegli **Aggiungi elemento** per creare livelli **Testo**, **Tinta unita**, **Gradiente**, **Forma** o **Oggetto nullo**.',
            'Tinta unita e Gradiente creano livelli forma a pieno fotogramma che puoi ridimensionare, stilizzare, mascherare e animare.',
            'DroneClean Studio impedisce a una composizione di contenere se stessa, compreso l’annidamento circolare indiretto.',
          ],
        },
      ],
    },
    {
      title: 'Impostare la durata e l’intervallo attivo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'La durata definita dall’autore stabilisce la composizione. Le maniglie In e Out del righello definiscono l’intervallo di rendering attivo dentro quella durata.',
        },
        {
          kind: 'steps',
          items: [
            'Trascina le maniglie **In** e **Out** sopra il righello di Motion per segnare l’intervallo attivo.',
            'Scegli **Ritaglia la comp. sulla regione attiva** per accorciare la composizione definita a quell’intervallo.',
            'Scegli **Adatta allo schermo** per inquadrare la composizione definita senza cambiarne la durata.',
            'Modifica **Durata della comp.** in Proprietà e seleziona la sua unità per passare tra fotogrammi e secondi.',
            'Leggi il valore **Timecode** corrispondente sotto il controllo della durata.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Il ritaglio mantiene disponibili i controlli In e Out e adatta il nuovo intervallo. I livelli che si estendono oltre la durata definita restano visibili nella parte eccedente attenuata.',
        },
      ],
    },
    {
      title: 'Disporre e temporizzare i livelli',
      blocks: [
        {
          kind: 'list',
          items: [
            'Trascina l’estensione di un livello per spostarlo nel tempo. I livelli selezionati si spostano insieme in un unico passo di annullamento.',
            'Modifica i campi **In** e **Out** di ogni livello, oppure trascina i bordi della sua estensione per tagliarlo.',
            'Usa i controlli del livello per cambiare visibilità, blocco, solo, metodo di fusione e ordine di sovrapposizione.',
            'Trascina la maniglia a tre puntini per riordinare un livello o un gruppo. I livelli figli restano dentro il loro gruppo attuale.',
            'Seleziona due o più livelli e scegli **Gruppo di livelli**. Visibilità, blocco, solo, temporizzazione e riordino del gruppo si applicano ai suoi figli.',
            'Fai clic con il tasto destro su un livello o un gruppo per rinominarlo, raggrupparlo, separarlo, duplicarlo, copiarlo, incollarlo o eliminarlo.',
          ],
        },
      ],
    },
    {
      title: 'Animare le proprietà e i vertici del tracciato',
      blocks: [
        {
          kind: 'list',
          items: [
            'Espandi un livello per mostrare i gruppi di proprietà annidati, i controlli dei valori, i fotogrammi chiave automatici, la navigazione e i rombi dei fotogrammi chiave.',
            'Imposta il filtro delle proprietà su **Proprietà animate** quando ti servono solo le righe che contengono fotogrammi chiave.',
            'Seleziona il rombo di una proprietà per aggiungere o rimuovere un fotogramma chiave alla testina condivisa.',
            'Seleziona due fotogrammi chiave adiacenti per modificare l’andamento del loro segmento.',
            'Seleziona l’icona della curva di una proprietà per sostituire la sua corsia del dope sheet con un grafico dei valori in linea.',
            'Apri il menu del gruppo Posizione e scegli **Separa le dimensioni di Posizione** per modificare X e Y in modo indipendente.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Le forme a tracciato espongono in Motion le corsie dei vertici. Seleziona i punti del tracciato nell’anteprima, poi passa tra **Vertici selezionati** e **Tutti i vertici** sopra le righe delle proprietà.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Una volta che la Geometria del tracciato ha dei fotogrammi chiave, non puoi aggiungere, rimuovere, riordinare né cambiare il primo vertice del tracciato. Rimuovi quei fotogrammi chiave prima di cambiare la topologia del tracciato.',
        },
      ],
    },
    {
      title: 'Collegare i livelli con un Oggetto nullo',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Scegli **Aggiungi elemento > Oggetto nullo**. Un Oggetto nullo controlla le trasformazioni ma non viene renderizzato.',
            'Scegli un genitore dal menu **Genitore**, oppure trascina il pick whip del genitore su un altro livello.',
            'Rilascia normalmente per conservare la posa del figlio sul canvas.',
            'Tieni premuto **Shift** mentre rilasci per agganciare la posizione del figlio al genitore.',
            'Tieni premuto **Alt/Option** mentre rilasci per usare la posa locale definita del figlio.',
            'Fai clic con Ctrl o Command sul pick whip del figlio per scollegarlo conservandone la posa attuale.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'I genitori validi si evidenziano mentre trascini. Motion rifiuta l’auto-assegnazione come genitore, i discendenti come destinazione e i collegamenti che creerebbero un ciclo.',
        },
      ],
    },
    {
      title: 'Collegare proprietà o scrivere un’espressione',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Il collegamento a un genitore crea una gerarchia di livelli. Un **Collegamento di proprietà** fa seguire a una proprietà un’altra senza cambiare quella gerarchia.',
        },
        {
          kind: 'list',
          items: [
            'Trascina il pick whip di una proprietà su una riga compatibile in Motion, nel dope sheet o nel grafico.',
            'Collega valori scalari a valori scalari. Posizione, Scala e Ancoraggio si collegano come valori bidimensionali completi.',
            'Seleziona il pulsante delle parentesi graffe per aggiungere un’espressione in sandbox senza eliminare i fotogrammi chiave della proprietà.',
            'Usa il pick whip dell’espressione per inserire un riferimento `prop("layer-id", "property")` nella posizione del cursore di testo.',
            'Usa `value`, `preValue`, `frame`, `time`, valori scalari o `[x, y]`, aritmetica e le funzioni matematiche supportate.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio valuta prima i fotogrammi chiave, poi il Collegamento di proprietà, poi l’espressione. Anteprima ed esportazione usano lo stesso ordine.',
        },
      ],
    },
    {
      title: 'Esporre i controlli per le composizioni riutilizzate',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Apri **Controlli pubblicati** dentro la composizione sorgente.',
            'Pubblica il testo o i colori che un montatore deve poter cambiare sulle istanze posizionate.',
            'Posiziona la composizione in una normale sequenza e seleziona quell’istanza.',
            'Modifica i suoi valori pubblicati in Proprietà senza cambiare la composizione sorgente.',
            'Ripristina una singola sovrascrittura oppure usa **Ripristina tutte le sovrascritture** per riportare i valori della sorgente.',
          ],
        },
      ],
    },
    {
      title: 'Usare la composizione in Montaggio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Una composizione Motion resta una risorsa di composizione riutilizzabile. Posizionala in una sequenza, poi sposta, taglia, anima o applica effetti all’istanza come a qualsiasi altra clip.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'L’animazione interna dei livelli e l’animazione dell’intera clip restano indipendenti. Un titolo può animarsi al suo interno mentre la sua istanza posizionata si sposta o appare in dissolvenza in Montaggio.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
