import type { DocPageContent } from '../../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Scorciatoie da tastiera',
  description:
    'Le scorciatoie predefinite per gruppo, più come cercarle, riassegnarle e ripristinarle.',
  category: 'Reference',
  sections: [
    {
      title: 'Riproduzione',
      blocks: [
        {
          kind: 'table',
          headers: ['Azione', 'Scorciatoia'],
          rows: [
            ['Riproduci / Pausa', '`Space`'],
            ['Fotogramma precedente / successivo', '`Left` / `Right`'],
            ['Punto di aggancio precedente / successivo', '`Up` / `Down`'],
            ['Vai all’inizio / alla fine', '`Home` / `End`'],
          ],
        },
      ],
    },
    {
      title: 'Montaggio',
      blocks: [
        {
          kind: 'table',
          headers: ['Azione', 'Scorciatoia'],
          rows: [
            ['Dividi alla testina', '`Alt+C`'],
            ['Dividi al cursore', '`Shift+C`'],
            ['Unisci', '`Shift+J`'],
            ['Elimina / Elimina e chiudi lo spazio', '`Delete` / `Ctrl+Delete`'],
            ['Inserisci fermo immagine', '`Shift+F`'],
            ['Collega / Scollega le clip', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['Attiva/disattiva selezione collegata', '`Shift+L`'],
            ['Sposta di 1 px / 10 px', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: 'Strumenti',
      blocks: [
        {
          kind: 'table',
          headers: ['Strumento', 'Scorciatoia'],
          rows: [
            ['Selezione', '`V`'],
            ['Modifica taglio', '`T`'],
            ['Rasoio', '`C`'],
            ['Cambia velocità', '`R`'],
            ['Slip', '`Y`'],
            ['Slide', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple e rolling sono comportamenti di taglio dello strumento **Modifica taglio**, non strumenti separati con una scorciatoia propria.',
        },
      ],
    },
    {
      title: 'Cronologia, vista e appunti',
      blocks: [
        {
          kind: 'table',
          headers: ['Azione', 'Scorciatoia'],
          rows: [
            ['Annulla / Ripeti', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['Copia / Taglia / Incolla', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['Attiva/disattiva aggancio / aggancio al canvas', '`S` / `Shift+S`'],
            ['Zoom avanti / indietro', '`Ctrl+=` / `Ctrl+-`'],
            ['Adatta allo schermo / 100%', '`\\` / `Shift+\\`'],
            ['Area di lavoro Montaggio / Colore / Motion', '`Alt+1` / `Alt+2` / `Alt+3`'],
          ],
        },
      ],
    },
    {
      title: 'Marcatori e fotogrammi chiave',
      blocks: [
        {
          kind: 'table',
          headers: ['Azione', 'Scorciatoia'],
          rows: [
            ['Aggiungi / Rimuovi marcatore', '`M` / `Shift+M`'],
            ['Marcatore precedente / successivo', '`[` / `]`'],
            ['Cancella fotogrammi chiave', '`Shift+A`'],
            ['Aggiungi fotogramma chiave al livello Montaggio selezionato', '`K`'],
            ['Vista grafico / foglio / divisa dei fotogrammi chiave', '`1` / `2` / `3`'],
            ['Fotogramma chiave precedente / successivo della proprietà', '`Alt+[` / `Alt+]`'],
            ['Attiva/disattiva i fotogrammi chiave automatici per la proprietà attiva', '`A`'],
            ['Adatta i fotogrammi chiave selezionati', '`F`'],
          ],
        },
      ],
    },
    {
      title: 'Monitor sorgente e progetto',
      blocks: [
        {
          kind: 'table',
          headers: ['Azione', 'Scorciatoia'],
          rows: [
            ['Segna In / Out', '`I` / `O`'],
            ['Cancella In/Out', '`Alt+X`'],
            ["Render dell'anteprima (da In a Out, o tutta la timeline)", '`Enter`'],
            ['Modifica con inserimento / sovrascrittura', '`,` / `.`'],
            ['Salva', '`Ctrl+S`'],
            ['Esporta', '`Ctrl+Shift+E`'],
            ['Apri il Navigatore scene', '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: 'Personalizzare le scorciatoie',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Ogni associazione qui sopra è un valore predefinito fornito con l’app. Apri il nuovo editor delle scorciatoie dal pulsante **Scorciatoie da tastiera** (icona della tastiera) nella barra degli strumenti dell’editor per riassegnare qualsiasi comando ai tasti che preferisci.',
        },
        {
          kind: 'steps',
          items: [
            'Cerca i comandi per nome, oppure filtra per i gruppi **Personalizzata**, **Conflitti** o **Non assegnate**.',
            'Scegli un comando e premi **Registra**, poi tieni premuti i modificatori e premi il tasto finale.',
            'Se la combinazione è già in uso, l’editor segnala il conflitto: scegli **Sovrascrivi** per riassegnarla, oppure scegli tasti diversi.',
            'Usa **Rimuovi** per cancellare un’associazione, oppure aggiungi un’associazione alternativa accanto a quella principale.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Usa **Ripristina** per ripristinare un singolo comando, o **Ripristina tutto** per riportare ogni scorciatoia al valore predefinito. Puoi anche **Esportare** le tue associazioni in un file di preset e **Importarlo** su un’altra macchina.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
