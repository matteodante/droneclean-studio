import type { DocPageContent } from '../../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Montaggio audio',
  description:
    'Registra una voce fuori campo, regola guadagno e dissolvenze della clip, intonazione, equalizzatore per clip, mixer e indicatori, e pulisci silenzi e parole riempitive.',
  category: 'Creative Tools',
  related: ['properties', 'local-ai'],
  sections: [
    {
      title: 'Regolare una clip',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Seleziona una clip e apri la scheda **Audio** in Proprietà.',
        },
        {
          kind: 'table',
          headers: ['Controllo', 'Intervallo'],
          rows: [
            ['Guadagno', 'da -60 dB a +12 dB (−60 dB di fatto silenzia la clip)'],
            ['Dissolvenza in entrata / Dissolvenza in uscita', 'da 0 a 5 secondi ciascuna'],
            ['Intonazione', 'Semitoni e Centesimi, indipendenti dalla velocità'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Puoi anche trascinare la linea del volume e le maniglie delle dissolvenze direttamente sulla clip nella timeline, e il **Guadagno** può avere fotogrammi chiave per salire o scendere nel corso di una clip.',
        },
      ],
    },
    {
      title: 'Intonazione e tono',
      blocks: [
        {
          kind: 'list',
          items: [
            'I controlli **Intonazione** spostano l’altezza del suono senza cambiare la velocità della clip. Per cambiare invece la velocità, usa **Velocità** nella scheda Video.',
            'La sezione **Equalizzatore** offre per ogni clip un editor di curva per modellare il tono.',
          ],
        },
      ],
    },
    {
      title: 'Mixer e indicatori',
      blocks: [
        {
          kind: 'list',
          items: [
            'Apri gli **Indicatori** audio per vedere i livelli stereo e individuare il clipping mentre riproduci.',
            'Usa il **Mixer** per bilanciare i livelli in tutto il progetto.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Il volume del monitor nell’anteprima influisce solo sulla riproduzione locale e non cambia mai il mix esportato.',
        },
      ],
    },
    {
      title: 'Registrare una voce fuori campo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Il pulsante **Registra voce fuori campo** (microfono) nella barra degli strumenti della timeline registra una narrazione a tempo con il tuo progetto. La cattura avviene **mentre la timeline è in riproduzione**, e la registrazione finita finisce su una nuova traccia audio ancorata alla posizione della testina da cui sei partito.',
        },
        {
          kind: 'steps',
          items: [
            'Sposta la testina dove deve iniziare la voce fuori campo.',
            'Fai clic sul pulsante del **microfono**: la timeline inizia a riprodurre e parte la registrazione.',
            'Usa **Metti in pausa la registrazione** per fermare insieme testina e microfono, **Riprendi la registrazione** per continuare, e **Ferma e salva** per concludere e inserire la clip su una nuova traccia audio.',
            'Fai clic su **Annulla registrazione** (la ✕) per scartare la ripresa senza aggiungere nulla.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Apri le **Impostazioni del microfono** (la ▾ accanto al pulsante) per scegliere un dispositivo di ingresso e regolare la cattura. L’indicatore di livello lì è attivo in tempo reale, così puoi controllare il microfono prima di registrare.',
        },
        {
          kind: 'table',
          headers: ['Impostazione', 'Che cosa fa'],
          rows: [
            ['Riduzione del rumore', 'Riduce il rumore di fondo costante. Attiva di default.'],
            [
              'Guadagno automatico',
              'Mantiene la tua voce a un livello costante. Attivo di default.',
            ],
            [
              'Silenzia la timeline durante la registrazione',
              'Silenzia il monitor della timeline, così l’audio degli altoparlanti non entra nel microfono. Attivo di default.',
            ],
            [
              'Scostamento di sincronia',
              'Sposta la clip registrata prima o dopo per compensare la latenza dell’ingresso (fino a ±1000 ms).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Usa le cuffie, così l’audio del progetto non viene mai catturato dal microfono: poi puoi disattivare **Silenzia la timeline durante la registrazione** per sentire il mix mentre narri.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Durante la registrazione lo spostamento è disattivato, e premere `Space` o raggiungere la fine della timeline conclude la ripresa. Così la registrazione resta agganciata alla testina e non può mai andare fuori sincrono.',
        },
      ],
    },
    {
      title: 'Ripulire i dialoghi',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Rimuovi silenzi** trova gli intervalli di silenzio e li taglia; l’impostazione **Silenzio minimo** controlla quanto deve durare una pausa, e la finestra stima quanto verrà rimosso.',
            '**Rimuovi parole riempitive** rileva parole come “ehm” e “uhm” dalla trascrizione e dall’audio e le rimuove.',
            'Entrambi gli strumenti mostrano gli intervalli che rimuoveranno, così puoi vedere l’anteprima prima di applicare la modifica.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Una trascrizione migliora il rilevamento delle parole riempitive, quindi generane una prima per ottenere i risultati migliori.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
