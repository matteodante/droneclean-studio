import type { DocPageContent } from '../../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Spazi di lavoro e archiviazione',
  description:
    'Come funziona la cartella dello spazio di lavoro, dove si trovano i file, i permessi e la manutenzione delle cache.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: 'Il modello dello spazio di lavoro',
      blocks: [
        {
          kind: 'list',
          items: [
            'Uno **spazio di lavoro** è una singola cartella su disco da cui DroneClean Studio legge e in cui scrive.',
            'Tutto ciò che DroneClean Studio genera si trova lì: file di progetto, metadati dei media, miniature, forme d’onda, trascrizioni, dati delle scene, risorse IA, cache ed esportazioni.',
            'I media sorgente importati non vengono copiati nello spazio di lavoro: DroneClean Studio registra un collegamento a ogni file nel punto in cui si trova già su disco.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Poiché lo spazio di lavoro è una cartella vera, puoi farne il backup, sincronizzarla o spostarla come qualsiasi altra directory.',
        },
      ],
    },
    {
      title: 'Scegliere e cambiare spazio di lavoro',
      blocks: [
        {
          kind: 'list',
          items: [
            'Al primo avvio DroneClean Studio ti chiede di scegliere uno spazio di lavoro prima di aprire l’editor.',
            'Scegli una normale cartella tua, per esempio una cartella in Documenti. Evita i percorsi di sistema protetti.',
            'Usa il controllo **Spazi di lavoro** per aggiungere, passare da uno all’altro o rimuovere gli spazi di lavoro noti.',
            'Cambiare spazio di lavoro modifica la cartella che DroneClean Studio usa; non sposta i tuoi media sorgente.',
          ],
        },
      ],
    },
    {
      title: 'Permessi e riconnessione',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Per sicurezza, i browser possono far scadere il permesso di accesso alla cartella tra una sessione e l’altra.',
        },
        {
          kind: 'list',
          items: [
            'Quando DroneClean Studio mostra **Ricollega il tuo spazio di lavoro**, scegli **Ricollega** e concedi l’accesso in lettura e scrittura alla stessa cartella.',
            'Se l’accesso viene negato, scegli di nuovo la cartella e consenti l’accesso quando il browser lo chiede.',
            'Se la cartella è stata spostata, rinominata o eliminata, scegline un’altra.',
          ],
        },
      ],
    },
    {
      title: 'Media mancanti',
      blocks: [
        {
          kind: 'list',
          items: [
            'Media mancanti significa che DroneClean Studio, in questo momento, non riesce a leggere uno o più file sorgente collegati.',
            'Usa **Concedi accesso** quando a un file serve solo un nuovo permesso del browser.',
            'Usa **Individua** o **Individua cartella** quando un file o la sua cartella è stato spostato.',
            'Usa **Sfoglia un’altra cartella** per indicare a DroneClean Studio una nuova copia dei media.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Usa **Lavora offline** solo se prevedi di ricollegare i file più tardi: fino ad allora le clip restano riferimenti interrotti.',
        },
      ],
    },
    {
      title: 'Spostare i progetti e svuotare le cache',
      blocks: [
        {
          kind: 'list',
          items: [
            'Usa **Esporta progetto** per impacchettare un progetto e i suoi media in un bundle portatile che un altro spazio di lavoro può importare.',
            'Le azioni sulla cache del progetto cancellano i dati rigenerabili, come forme d’onda, filmstrip, fotogrammi GIF e audio decodificato.',
            'Le impostazioni di archiviazione permettono anche di rigenerare le miniature, generare i proxy mancanti ed eliminare i proxy.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Svuotare le cache non elimina mai i tuoi media sorgente: DroneClean Studio rigenera le anteprime quando il progetto ne ha bisogno.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
