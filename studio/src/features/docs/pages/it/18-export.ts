import type { DocPageContent } from '../../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: 'Esportazione',
  description:
    'Renderizza video o audio nel browser, scegli formati e intervallo e risolvi gli avvisi del controllo preliminare.',
  category: 'Output',
  related: ['render-queue', 'text-captions-subtitles', 'troubleshooting'],
  sections: [
    {
      title: 'Impostare un’esportazione',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Apri **Esporta** (`Ctrl+Shift+E`) e scegli **Esporta video** o **Esporta audio**.',
            'Renderizza l’intero progetto, oppure l’intervallo In/Out corrente quando ti serve solo una sezione.',
            'Imposta **Risoluzione** e **Qualità** in base all’obiettivo: una revisione rapida, un file da condividere o un master finale.',
            'Risolvi gli eventuali avvisi del controllo preliminare, poi renderizza.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Risoluzione e qualità più alte richiedono più tempo e producono file più grandi.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Quando un progetto ha più della timeline Principale, un menu **Sequenza** in cima alla finestra sceglie quale timeline esportare, con la sua risoluzione e il suo intervallo.',
        },
      ],
    },
    {
      title: 'Formati',
      blocks: [
        {
          kind: 'table',
          headers: ['Uscita', 'Formati'],
          rows: [
            ['Contenitori video', 'MP4, MOV, WebM, MKV'],
            ['Solo audio', 'MP3, AAC, WAV'],
            ['Traccia di sottotitoli separabile', 'WebM, MKV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'I codec disponibili dipendono dal browser; DroneClean Studio avvisa o ripiega su un’alternativa quando uno non lo è.',
        },
      ],
    },
    {
      title: 'Sottotitoli',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Quando un’esportazione video ha una trascrizione, il controllo **Sottotitoli** sceglie come vengono incluse le didascalie. Le opzioni si adattano al contenitore che hai scelto.',
        },
        {
          kind: 'table',
          headers: ['Modalità', 'Che cosa fa'],
          rows: [
            ['**Disattivati**', 'Nessuna didascalia nel video esportato.'],
            [
              '**Impressi nel video**',
              'Le didascalie vengono disegnate nel fotogramma, quindi si vedono in ogni lettore.',
            ],
            [
              '**File .srt separato** `.srt`',
              'Video pulito più un file di sottotitoli `.srt` separato, scaricato insieme.',
            ],
            [
              '**Traccia incorporata**',
              'Una traccia di sottotitoli attivabile e disattivabile, contenuta nel contenitore.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'L’opzione della traccia incorporata compare solo per `WebM` e `MKV`. Su `MP4` e `MOV`, scegli i sottotitoli impressi o un file separato, oppure cambia contenitore per avere una traccia attivabile.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Alcuni lettori nascondono di default le tracce di sottotitoli, quindi gli spettatori potrebbero doverle attivare.',
        },
      ],
    },
    {
      title: 'Controlli preliminari',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Il controllo preliminare gira prima del rendering e segnala i blocchi più comuni: un intervallo vuoto, media mancanti, un codec non disponibile, un’esportazione che ripiega sul thread principale, un file grande o un rendering lungo.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Per una verifica rapida, esporta prima un breve intervallo In/Out prima di impegnarti nel rendering completo.',
        },
      ],
    },
    {
      title: 'Renderizzare e scaricare',
      blocks: [
        {
          kind: 'list',
          items: [
            'L’avanzamento passa per preparazione, rendering, codifica e finalizzazione, e puoi **Annullare** in qualsiasi momento.',
            'L’esportazione con worker gira in background quando disponibile; l’alternativa sul thread principale richiede la scheda in primo piano e inattiva.',
            'Quando termina, scegli **Scarica** per salvare il file, che viene scritto anche nella cartella delle esportazioni del tuo spazio di lavoro.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Tieni aperta la scheda del progetto finché l’esportazione non finisce. Per eseguire più rendering in serie, aggiungili alla **Coda di rendering** invece di esportare uno alla volta.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
