import type { DocPageContent } from '../../docs-content'

const page = {
  order: 9,
  slug: 'source-monitor',
  title: 'Flusso di lavoro del monitor sorgente',
  description:
    'Visualizza una sorgente, segna un intervallo In/Out, scegli le tracce di destinazione e inserisci o sovrascrivi sulla timeline.',
  category: 'Core Editing',
  related: ['media', 'timeline', 'scene-browser'],
  sections: [
    {
      title: 'Aprire una sorgente',
      blocks: [
        {
          kind: 'list',
          items: [
            'Fai doppio clic su una scheda media, oppure usa **Apri nel monitor sorgente** da Informazioni sul media, per caricare una sorgente.',
            'L’intestazione del monitor mostra il nome del file sorgente, con un controllo di chiusura per uscirne.',
            'La riproduzione della sorgente è indipendente dall’anteprima della timeline, quindi puoi scorrere una sorgente senza spostare la testina della timeline.',
            'Fai clic sull’indicazione del timecode per passare tra la visualizzazione a timecode e quella a numero di fotogramma.',
          ],
        },
      ],
    },
    {
      title: 'Segnare un intervallo In/Out',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Spostati sul primo fotogramma che vuoi e premi `I` (**Segna punto In**).',
            'Spostati sul fotogramma successivo all’ultimo che vuoi e premi `O` (**Segna punto Out**): il punto Out è escluso.',
            'Rifinisci trascinando la maniglia In, la maniglia Out o l’intero intervallo sulla barra.',
            'Usa **Riproduci da In a Out** per rivedere solo l’intervallo, oppure `Alt+X` per cancellarlo e usare l’intera sorgente.',
          ],
        },
      ],
    },
    {
      title: 'Scegliere le tracce di destinazione',
      blocks: [
        {
          kind: 'list',
          items: [
            'L’interruttore **V** attiva o disattiva la destinazione video della sorgente; l’interruttore **A** fa lo stesso per l’audio.',
            'Ogni interruttore ha un selettore di destinazione: **Auto**, una traccia specifica per nome, oppure **Crea alla modifica** per creare una nuova traccia.',
            'Un video con audio posiziona una coppia collegata di video e audio sulle tracce di destinazione V e A.',
            'La traccia attiva della timeline precompila le destinazioni V e A corrispondenti.',
          ],
        },
      ],
    },
    {
      title: 'Inserire e sovrascrivere',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Entrambe le modifiche posizionano l’intervallo segnato sul fotogramma corrente della testina della timeline, poi portano la testina alla fine della nuova clip.',
        },
        {
          kind: 'table',
          headers: ['Modifica', 'Tasto', 'Che cosa fa'],
          rows: [
            [
              'Inserisci',
              '`,`',
              'Inserisce l’intervallo e spinge a destra tutto il materiale successivo sulle tracce di destinazione.',
            ],
            [
              'Sovrascrivi',
              '`.`',
              'Sostituisce qualsiasi materiale della timeline sotto l’intervallo, lasciando al loro posto le clip circostanti.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le immagini diventano di default una clip da **tre secondi** alla modifica, a meno che tu non segni un intervallo più breve.',
        },
      ],
    },
    {
      title: 'Se una modifica non si applica',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Attiva prima almeno una delle destinazioni **V** o **A**. Per modificare l’audio attiva **A**; per modificare un video senza audio o un’immagine attiva **V**. Anche una traccia di destinazione bloccata impedisce la modifica: sbloccala e riprova.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
