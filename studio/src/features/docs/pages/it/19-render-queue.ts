import type { DocPageContent } from '../../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: 'Coda di rendering',
  description:
    'Metti in coda più esportazioni, dividi un rendering in segmenti, gestisci la coda e trova i file salvati.',
  category: 'Output',
  related: ['export'],
  sections: [
    {
      title: 'Mettere in coda le esportazioni',
      blocks: [
        {
          kind: 'list',
          items: [
            'Dalla finestra Esporta, scegli **Aggiungi alla coda** invece di renderizzare subito.',
            'Metti in coda l’intero progetto o l’intervallo corrente.',
            'Apri la coda in qualsiasi momento dal pulsante **Coda di rendering** nella barra degli strumenti, che mostra il numero di lavori in tempo reale.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le esportazioni in coda vengono renderizzate una alla volta e salvate nella cartella delle esportazioni del tuo spazio di lavoro.',
        },
      ],
    },
    {
      title: 'Dividere in segmenti',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Dividi in segmenti** trasforma un rendering in più lavori.',
            'Usa **Un segmento per marcatore** per spezzare il rendering in corrispondenza dei marcatori della timeline.',
            'Oppure dividi in blocchi fissi di un certo numero di secondi.',
          ],
        },
      ],
    },
    {
      title: 'Gestire la coda',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Pausa** e **Riprendi** la coda per controllare quando avviene il rendering.',
            'Sposta un lavoro in coda **Su** o **Giù** per cambiarne l’ordine.',
            '**Annulla** un lavoro in corso o in coda, **Riprova** uno non riuscito e **Rimuovi** i lavori terminati.',
            'Lo stato di un lavoro indica In coda, Rendering in corso, Fatto, Non riuscito o Annullato; usa **Cancella completati** o **Cancella tutto** per fare ordine.',
          ],
        },
      ],
    },
    {
      title: 'Esportazioni salvate',
      blocks: [
        {
          kind: 'list',
          items: [
            'Passa alla scheda **Esportazioni salvate** per vedere i file completati.',
            'Da lì puoi scaricare o eliminare un’esportazione salvata.',
            'I file si trovano in questa cartella del progetto all’interno del tuo spazio di lavoro.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
