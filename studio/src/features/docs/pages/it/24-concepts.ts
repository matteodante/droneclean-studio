import type { DocPageContent } from '../../docs-content'

// L’ordine 1.5 colloca questa pagina subito dopo Per iniziare nel gruppo Start.
const page = {
  order: 1.5,
  slug: 'concepts',
  title: 'Come funziona DroneClean Studio',
  description:
    'Il modello mentale: archiviazione local-first, progetti e media collegati, fotogrammi e timecode, e la pipeline GPU.',
  category: 'Start',
  related: ['workspaces', 'getting-started', 'editing-tools'],
  sections: [
    {
      title: 'Local-first, per scelta di progetto',
      blocks: [
        {
          kind: 'list',
          items: [
            'DroneClean Studio gira nel tuo browser e archivia tutto in una **cartella dello spazio di lavoro** sul tuo disco.',
            'I tuoi video e audio originali sono **collegati**, non copiati né caricati: DroneClean Studio punta ai file dove si trovano già.',
            'Progetti, cache, risorse generate ed esportazioni vengono scritti nello spazio di lavoro, quindi puoi farne il backup o spostarlo come qualsiasi cartella.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Poiché i media sono collegati, spostare o rinominare un file sorgente appare come **Media mancanti** finché non lo ricolleghi. Vedi [Spazi di lavoro e archiviazione](workspaces).',
        },
      ],
    },
    {
      title: 'Progetti, tracce e clip',
      blocks: [
        {
          kind: 'list',
          items: [
            'Un **progetto** contiene una timeline, le sue impostazioni (risoluzione e frequenza fotogrammi) e i riferimenti ai media che usi.',
            'La timeline impila le **tracce**; quelle più in alto vengono renderizzate sopra quelle più in basso.',
            'Una **clip** sulla timeline è una finestra su un file sorgente: tagliare una clip cambia quale parte della sorgente viene riprodotta, non altera il file.',
            'Un **livello di regolazione** è una clip che non porta media propri: applica i suoi effetti e il suo colore a ogni clip sottostante.',
          ],
        },
      ],
    },
    {
      title: 'Sequenze e clip composte',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio ha un solo elemento di base per **una timeline dentro il tuo progetto**: la composizione. Si presenta in due modi a seconda di come la usi.',
        },
        {
          kind: 'list',
          items: [
            'Una **composizione Motion** si apre in **Motion**, dove l’editor condiviso mantiene al loro posto media, anteprima e proprietà mentre il pannello inferiore diventa una timeline dei livelli.',
            'Una **sequenza** è una timeline autonoma nello stesso progetto, aperta da una scheda nella barra delle schede. Ogni sequenza ha le proprie tracce, clip e cronologia delle modifiche: la timeline principale è essa stessa una sequenza.',
            'Una **clip composta** prende una sezione della timeline e la ripiega in un singolo elemento multimediale riutilizzabile. Sulla timeline si comporta come una sola clip (sposta, taglia, aggiungi effetti), mentre il suo contenuto vive in una timeline propria.',
            'Le due sono la stessa cosa vista in modo diverso: apri una clip composta per modificarne il contenuto come sequenza, e qualsiasi sequenza può essere trascinata in un’altra timeline come clip composta.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Una composizione può contenerne altre, ma mai se stessa: DroneClean Studio blocca i riferimenti circolari, quindi una clip composta non può mai finire annidata dentro il proprio contenuto.',
        },
      ],
    },
    {
      title: 'Fotogrammi e timecode',
      blocks: [
        {
          kind: 'list',
          items: [
            'I tempi si misurano in **fotogrammi**. Una clip ha un fotogramma iniziale e una lunghezza in fotogrammi alla frequenza del progetto.',
            'L’anteprima mostra il **timecode**; in alcune viste puoi fare clic sull’indicazione per passare ai numeri di fotogramma.',
            'I media sorgente possono avere una frequenza fotogrammi diversa da quella del progetto, quindi DroneClean Studio converte i fotogrammi sorgente in fotogrammi del progetto quando monti.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Imposta risoluzione e frequenza fotogrammi del progetto in base alla consegna che ti serve quando crei il progetto.',
        },
      ],
    },
    {
      title: 'Tutto viene renderizzato sul tuo computer',
      blocks: [
        {
          kind: 'list',
          items: [
            'Riproduzione, effetti, colore e strumenti IA girano in locale usando la tua GPU (WebGPU) e la tua CPU (WebCodecs).',
            'I **proxy** sono copie più leggere dei media pesanti che rendono fluido il montaggio; l’esportazione finale usa sempre gli originali.',
            'Poiché non c’è rendering nel cloud, tenere aperta la scheda durante l’esportazione è importante: il rendering avviene proprio nel browser.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
