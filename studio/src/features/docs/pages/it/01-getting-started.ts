import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Per iniziare',
  description:
    'Che cos’è DroneClean Studio, che cosa serve al tuo browser e il tuo primo montaggio, dall’avvio all’esportazione.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'Che cos’è DroneClean Studio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio è un editor video **local-first** che gira interamente nel tuo browser: niente account, niente caricamenti, niente rendering su un server. Montaggio, effetti, colore, strumenti IA ed esportazione funzionano tutti sul tuo computer, con la tua GPU e la tua CPU.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'I tuoi media restano sul tuo dispositivo. DroneClean Studio si collega ai file originali e scrive progetti, cache ed esportazioni in una **cartella dello spazio di lavoro** che scegli tu: non viene inviato nulla al cloud.',
        },
      ],
    },
    {
      title: 'Che cosa serve al tuo browser',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio usa API web moderne, quindi il percorso supportato è un browser Chromium recente.',
        },
        {
          kind: 'table',
          headers: ['Browser', 'Stato'],
          rows: [
            ['Chrome / Edge 113+', 'Supporto completo'],
            ['Brave', 'Funziona dopo aver attivato il flag della File System Access API'],
            ['Safari / Firefox', 'Non ancora supportati per il flusso di lavoro completo'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio usa la File System Access API (cartelle dello spazio di lavoro), WebCodecs (decodifica ed esportazione), WebGPU (effetti, colore, IA) e OPFS (cache). Tieni attiva l’accelerazione hardware e i driver della GPU aggiornati.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave può bloccare l’accesso alle cartelle. Apri `brave://flags/#file-system-access-api`, impostalo su **Enabled**, poi riavvia Brave.',
        },
      ],
    },
    {
      title: 'Il tuo primo montaggio',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Apri DroneClean Studio in un browser supportato e, quando richiesto, scegli una **cartella dello spazio di lavoro** in cui puoi leggere e scrivere.',
            'Nella pagina Progetti scegli **Nuovo progetto** e imposta risoluzione e frequenza fotogrammi del montaggio.',
            'Apri la scheda **Media** e usa **Importa** per aggiungere i file, oppure trascina i media direttamente nella libreria.',
            'Trascina una clip dal pannello Media su una traccia della timeline.',
            'Premi `Space` per riprodurre e usa `Left` e `Right` per avanzare di un fotogramma alla volta.',
            'Salva con `Ctrl+S` mentre lavori, poi scegli **Esporta** per renderizzare il video finito.',
          ],
        },
      ],
    },
    {
      title: 'Verifica che tutto funzioni',
      blocks: [
        {
          kind: 'list',
          items: [
            'Il selettore dello spazio di lavoro si apre e accetta una cartella normale (non un percorso di sistema protetto).',
            'I media importati compaiono come schede nel pannello Media, con le miniature.',
            'La riproduzione parte dalla timeline quando premi `Space`.',
            'L’esportazione si apre e il controllo preliminare non segnala problemi bloccanti.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Se un passaggio non riesce, consulta la pagina **Risoluzione dei problemi** per il sintomo corrispondente.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
