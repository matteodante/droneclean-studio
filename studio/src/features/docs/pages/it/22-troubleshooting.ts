import type { DocPageContent } from '../../docs-content'

const page = {
  order: 22,
  slug: 'troubleshooting',
  title: 'Risoluzione dei problemi',
  description:
    'Soluzioni ai problemi di browser, spazio di lavoro, media, WebGPU, IA locale ed esportazione.',
  category: 'Reference',
  related: ['workspaces', 'export'],
  sections: [
    {
      title: 'Browser e spazio di lavoro',
      blocks: [
        {
          kind: 'table',
          headers: ['Sintomo', 'Soluzione'],
          rows: [
            [
              'Browser non supportato, o nessun selettore dello spazio di lavoro',
              'Usa Chrome o Edge 113+, che supportano le API di cui DroneClean Studio ha bisogno.',
            ],
            [
              'Brave non riesce a scegliere una cartella',
              'Attiva `brave://flags/#file-system-access-api` e riavvia Brave.',
            ],
            [
              'Permesso negato',
              'Scegli una normale cartella che puoi modificare, poi consenti l’accesso in lettura e scrittura.',
            ],
            [
              'Alla riapertura viene chiesto di ricollegare',
              'Scegli **Ricollega** per la stessa cartella; se è stata spostata, scegline un’altra.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Media e importazione',
      blocks: [
        {
          kind: 'table',
          headers: ['Sintomo', 'Soluzione'],
          rows: [
            [
              'Media mancanti',
              'Ricollega con **Concedi accesso**, **Individua**, **Individua cartella** o **Sfoglia un’altra cartella**.',
            ],
            [
              'Importazione non riuscita o codec non supportato',
              'Prova un altro formato supportato dal browser, oppure transcodifica prima il file.',
            ],
            [
              'L’importazione da URL non riesce',
              'Assicurati che il link punti al file multimediale stesso, non a una pagina che lo incorpora.',
            ],
            [
              'Anteprime o forme d’onda non aggiornate',
              'Rigenera le miniature o i proxy, oppure svuota la cache del progetto nelle impostazioni Archiviazione.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Usa **Lavora offline** solo se intendi ricollegare i file più tardi: fino ad allora le clip restano riferimenti interrotti.',
        },
      ],
    },
    {
      title: 'WebGPU e IA locale',
      blocks: [
        {
          kind: 'table',
          headers: ['Sintomo', 'Soluzione'],
          rows: [
            [
              'Effetti, scope o IA non disponibili',
              'WebGPU potrebbe essere disattivato: usa un Chrome o Edge recente, aggiorna i driver della GPU e tieni attiva l’accelerazione hardware.',
            ],
            [
              'Il download di un modello è lento o fallisce',
              'Tieni aperta la scheda, riprova con una connessione stabile e svuota la **Cache dei modelli IA locali** se un download è corrotto.',
            ],
            [
              'Memoria esaurita durante il lavoro con l’IA',
              'Usa **Scarica i modelli locali** per rilasciare i runtime.',
            ],
            [
              'Importazione LUT bloccata',
              'L’importazione di LUT (.cube) richiede un browser basato su Chromium.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Esportazione',
      blocks: [
        {
          kind: 'table',
          headers: ['Sintomo', 'Soluzione'],
          rows: [
            [
              'Codec non disponibile nel controllo preliminare',
              'Scegli un altro codec o formato, oppure abbassa risoluzione o qualità.',
            ],
            [
              'Esportazione con worker non disponibile',
              'Tieni la scheda in primo piano ed evita interazioni pesanti; sostituire gli elementi immagine animati con clip video può aiutare.',
            ],
            [
              'Esportazione grande o lenta',
              'Esporta prima un intervallo In/Out più breve, abbassa risoluzione o qualità e libera spazio su disco.',
            ],
            [
              'L’esportazione non parte',
              'Risolvi ogni avviso bloccante del controllo preliminare, poi prova con un breve intervallo per confermare che la pipeline funzioni.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
