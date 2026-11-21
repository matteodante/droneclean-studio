import type { DocPageContent } from '../../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Strumenti IA locali',
  description:
    'Sintesi vocale, generazione musicale e trascrizione nel browser, con cache locale dei modelli.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: 'Come funziona l’IA locale',
      blocks: [
        {
          kind: 'list',
          items: [
            'Gli strumenti IA girano nel tuo browser usando il tuo hardware: non viene inviato nulla a un server.',
            'La prima volta che usi un modello viene scaricato una sola volta e poi conservato in cache in locale per riutilizzarlo.',
            'Un indicatore di stato mostra i passaggi di caricamento, attività, pronto ed errore mentre un modello è in esecuzione.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Alcuni strumenti richiedono Chrome o Edge 113+ (o Safari 26+) e il supporto WebGPU. Il primo download di un modello può essere grande.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Le licenze dei modelli vincolano te, non noi: la musica generata con MusicGen è solo per uso non commerciale (CC BY-NC 4.0), e la voce di Supertonic è sotto la licenza OpenRAIL-M, che vieta alcuni usi. La scheda IA lo dice prima che tu generi.',
        },
      ],
    },
    {
      title: 'Sintesi vocale',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Apri la scheda **IA** ed espandi **Sintesi vocale**, poi scrivi o incolla il tuo copione.',
            'Scegli un motore (vedi la tabella), poi una voce e, dove supportati, velocità, lingua e tag espressivi.',
            'Ascolta il risultato, poi **Salva e inserisci** per mettere l’audio collegato alla testina, oppure **Salva nella libreria**.',
          ],
        },
        {
          kind: 'table',
          headers: ['Motore', 'Lingue', 'Gira su'],
          rows: [
            ['Kokoro', 'Inglese', 'WebGPU'],
            ['MOSS Nano', '20 lingue', 'CPU'],
            ['Supertonic 3', '31 lingue', 'ONNX locale'],
          ],
        },
      ],
    },
    {
      title: 'Generazione musicale',
      blocks: [
        {
          kind: 'list',
          items: [
            'Espandi **Generazione musicale** e descrivi il brano con un prompt, oppure parti da un preset come Lo-fi Chill o EDM vivace.',
            'Imposta la lunghezza in secondi, poi **Genera musica**; la prima volta il modello viene scaricato e conservato in cache.',
            'Ascolta la clip, poi **Salva e inserisci** nella timeline o **Salva nella libreria**.',
          ],
        },
      ],
    },
    {
      title: 'Trascrizione',
      blocks: [
        {
          kind: 'list',
          items: [
            'La trascrizione si trova nella libreria Media e nel flusso di lavoro Trascrizione, separata dalla scheda IA.',
            '**Parakeet** è il motore predefinito veloce e copre molte lingue europee.',
            'Sono disponibili anche i modelli Whisper (Tiny, Base, Small, Large v3 Turbo), e DroneClean Studio ripiega su Whisper quando serve.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Una trascrizione alimenta le didascalie, la ricerca nella trascrizione e la rimozione delle parole riempitive: generane una presto.',
        },
      ],
    },
    {
      title: 'Gestire modelli e runtime',
      blocks: [
        {
          kind: 'list',
          items: [
            'Apri le impostazioni **Archiviazione** per gestire l’IA locale.',
            'Usa **Cache dei modelli IA locali** per ispezionare o svuotare i modelli scaricati: utile se un download è corrotto.',
            'Usa **Scarica i modelli locali** per rilasciare i runtime e liberare memoria.',
            'I lavori lunghi si possono annullare se non ti serve più il risultato.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
