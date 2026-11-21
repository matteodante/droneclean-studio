import type { DocPageContent } from '../../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: 'Riferimento',
  description: 'I formati supportati e un glossario dei termini usati in questa guida.',
  category: 'Reference',
  related: ['concepts', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Formati',
      blocks: [
        {
          kind: 'table',
          headers: ['Uso', 'Tipi'],
          rows: [
            ['Importazione', 'Video, audio, immagini, GIF, SVG, risorse generate, clip composte'],
            ['Esportazione video', 'MP4, MOV, WebM, MKV'],
            ['Esportazione audio', 'MP3, AAC, WAV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Il supporto dei codec dipende da ciò che il tuo browser sa decodificare e codificare.',
        },
      ],
    },
    {
      title: 'Termini di montaggio',
      blocks: [
        {
          kind: 'table',
          headers: ['Termine', 'Significato'],
          rows: [
            [
              'Intervallo In/Out',
              'Un inizio e una fine segnati, usati per le modifiche dalla sorgente e per gli intervalli di esportazione.',
            ],
            [
              'Margine sorgente',
              'Fotogrammi di riserva oltre il bordo di una clip, necessari per tagli e transizioni.',
            ],
            [
              'Modifica ripple',
              'Una modifica che sposta il materiale successivo per aprire o chiudere spazio sulla timeline.',
            ],
            ['Modifica rolling', 'Una modifica che sposta il taglio tra due clip adiacenti.'],
            [
              'Modifica slip',
              'Cambia i fotogrammi sorgente dentro una clip senza spostare la clip.',
            ],
            ['Modifica slide', 'Sposta una clip regolando i tagli adiacenti.'],
          ],
        },
      ],
    },
    {
      title: 'Termini delle funzioni',
      blocks: [
        {
          kind: 'table',
          headers: ['Termine', 'Significato'],
          rows: [
            ['Spazio di lavoro', 'La cartella da cui DroneClean Studio legge e in cui scrive.'],
            [
              'Proxy',
              'Una copia generata più leggera di un media pesante, usata per una riproduzione più fluida.',
            ],
            [
              'Clip composta',
              'Una sezione di timeline raggruppata in un singolo elemento multimediale riutilizzabile.',
            ],
            [
              'Livello di regolazione',
              'Un livello i cui effetti e la cui correzione colore si applicano alle clip sottostanti.',
            ],
            [
              'Fotogramma chiave',
              'Un valore impostato a un istante preciso per animare una proprietà.',
            ],
            ['LUT', 'Una tabella di lookup (.cube) che applica una trasformazione del colore.'],
            [
              'Destinazione di patch',
              'La traccia della timeline a cui viene inviata una modifica dal monitor sorgente.',
            ],
            [
              'Coda di rendering',
              'Un elenco ordinato di esportazioni che vengono renderizzate una alla volta.',
            ],
            [
              'Controllo preliminare',
              'La verifica di prontezza che gira prima dell’avvio di un’esportazione.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
