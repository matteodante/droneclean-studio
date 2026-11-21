import type { DocPageContent } from '../../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Montaggio di base sulla timeline',
  description:
    'Tracce, aggiunta delle clip, selezione, taglio e unione, eliminazione, aggancio, marcatori, intervalli, sequenze e zoom.',
  category: 'Core Editing',
  related: ['editing-tools', 'preview', 'media', 'export', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Tracce',
      blocks: [
        {
          kind: 'list',
          items: [
            'Le **Tracce video** contengono gli elementi visivi: video, immagini, testo, forme, didascalie e livelli di regolazione.',
            'Le **Tracce audio** contengono le clip audio e l’audio collegato ai file video.',
            'Aggiungi tracce con **Aggiungi traccia video** o **Aggiungi traccia audio** quando ti serve più spazio.',
            'I controlli della traccia includono **Blocca**, **Solo**, **Attiva/Disattiva** (visibilità) e il blocco sincronia.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'I gruppi di tracce hanno un solo livello di profondità e fanno da intestazione: silenziamento, visibilità e blocco passano da un gruppo alle sue tracce.',
        },
      ],
    },
    {
      title: 'Aggiungere e disporre le clip',
      blocks: [
        {
          kind: 'list',
          items: [
            'Trascina una clip dal pannello Media su una traccia video o audio.',
            'Usa lo strumento **Selezione** (`V`) per spostare e riorganizzare le clip.',
            'La **Selezione collegata** mantiene una clip video e il suo audio in movimento insieme; scollegali per modificarne uno da solo.',
            'Sposta di poco un elemento selezionato con `Shift+Arrow` (1 px) o `Ctrl+Shift+Arrow` (10 px).',
          ],
        },
      ],
    },
    {
      title: 'Tagliare, unire ed eliminare',
      blocks: [
        {
          kind: 'list',
          items: [
            'Taglia alla testina con `Alt+C`, oppure usa lo strumento **Rasoio** (`C`) per tagliare dove fai clic.',
            'Unisci sezioni adiacenti della stessa clip con `Shift+J`.',
            '**Elimina** lascia uno spazio vuoto; **Elimina e chiudi lo spazio** (`Ctrl+Delete`) rimuove la clip e chiude il vuoto.',
            'Usa **Chiudi tutti gli spazi vuoti** per avvicinare le clip e togliere lo spazio vuoto su una traccia.',
          ],
        },
      ],
    },
    {
      title: 'Aggancio, marcatori e intervalli',
      blocks: [
        {
          kind: 'list',
          items: [
            'Attiva o disattiva l’aggancio con `S`, così le clip si agganciano ai tagli vicini, ai marcatori e alla testina.',
            'Aggiungi un marcatore con `M` per appunti e riferimenti temporali; salta tra i marcatori con `[` e `]`.',
            'Imposta un punto In (`I`) e un punto Out (`O`) per definire un intervallo per anteprima ed esportazione; cancellali con `Alt+X`.',
          ],
        },
      ],
    },
    {
      title: 'Sequenze (timeline multiple)',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Una **sequenza** è una timeline autonoma con le sue tracce, clip, marcatori e intervallo In/Out. La barra delle schede sopra la timeline elenca la timeline **Principale** più ogni sequenza: fai clic su una scheda per cambiare quella che stai modificando.',
        },
        {
          kind: 'list',
          items: [
            'Crea una sequenza con il pulsante **+** in fondo alla barra delle schede; si apre in una scheda propria.',
            'Cambia sequenza facendo clic su una scheda; la scheda **Principale** è sempre la prima.',
            'Fai doppio clic su una scheda per **rinominarla**, oppure usa il menu delle opzioni della scheda (⋮) per **Rinomina**, **Chiudi scheda** ed **Elimina sequenza**.',
            '**Chiudi scheda** rimuove solo la scheda: la sequenza resta disponibile nel pannello Media e in tutte le clip che la richiamano. **Elimina sequenza** la rimuove del tutto (si può annullare), insieme a tutte le clip che la richiamano.',
            'Una **clip composta** si può aprire come scheda di sequenza: nel pannello Media, fai clic con il tasto destro su una clip composta e scegli **Apri come scheda** per modificarla come timeline autonoma.',
            'Trascina una sequenza sulla timeline per annidarla come clip (con l’etichetta **Sequenza**); fai doppio clic su quella clip per passare alla sua scheda.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ogni sequenza conserva i propri marcatori, intervallo In/Out, vista e cronologia di annullamento: cambiare scheda non li mescola mai.',
        },
      ],
    },
    {
      title: 'Zoom e annullamento',
      blocks: [
        {
          kind: 'list',
          items: [
            'Fai zoom con `Ctrl+=` e `Ctrl+-`, adatta l’intero montaggio con `\\`, e torna al 100% con `Shift+\\`.',
            'Lo zoom cambia solo la vista, mai la temporizzazione delle clip.',
            'Annulla con `Ctrl+Z` e ripeti con `Ctrl+Shift+Z`; la profondità della cronologia di annullamento si configura in Impostazioni.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
