import type { DocPageContent } from '../../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Impostazioni',
  description:
    'Le schede Generali, Timeline, IA, Archiviazione e Privacy, più dove si impostano lingua e scorciatoie.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'Le schede',
      blocks: [
        {
          kind: 'table',
          headers: ['Scheda', 'Che cosa imposti'],
          rows: [
            [
              'Generali',
              'Salvataggio automatico sì/no e intervallo (5–30 min); profondità della cronologia di annullamento (10–200 passi); suoni dell’interfaccia (sì/no, volume, tema sonoro).',
            ],
            [
              'Timeline',
              'Aggancio di default; mostra forme d’onda e filmstrip; estrai i filmstrip all’importazione.',
            ],
            [
              'IA',
              'Intervallo di campionamento delle didascalie (secondi o fotogrammi); stile di didascalia predefinito.',
            ],
            [
              'Archiviazione',
              'Genera i proxy mancanti; svuota la cache del progetto; rigenera le miniature; elimina i proxy; gestisci l’IA locale.',
            ],
            [
              'Privacy',
              "Segnalazioni di arresto anomalo e statistiche d’uso anonime, ciascuna attiva o disattivata (entrambe disattivate finché non le consenti); nell'app desktop anche **Controlla le nuove versioni** (attiva di base).",
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Svuotare la cache del progetto rimuove i dati rigenerabili (forme d’onda, filmstrip, fotogrammi GIF, audio decodificato); non elimina mai i media sorgente. Usa **Ripristina** nell’intestazione della finestra per ripristinare i valori predefiniti.',
        },
      ],
    },
    {
      title: 'Nuove versioni',
      blocks: [
        {
          kind: 'paragraph',
          text: "L'app desktop non è firmata, quindi non può aggiornarsi da sola. Invece, all'avvio (al massimo una volta al giorno) chiede a GitHub il numero dell'ultima versione e, se ne esiste una più recente, mostra una piccola scheda con **Scarica** (apre la pagina di quella versione nel browser) e **Più tardi** (la nasconde fino a domani). Durante il rendering di un'esportazione non compare nulla. È l'unica richiesta che l'app fa senza che tu la chieda, per questo ha un interruttore: **Impostazioni › Privacy › Controlla le nuove versioni**, attivo di base. GitHub vede il tuo indirizzo IP; non viene inviato nient'altro su di te o sul tuo lavoro, e con l'interruttore spento non parte nessuna richiesta. L'editor web è sempre all'ultima versione e non controlla mai.",
        },
      ],
    },
    {
      title: 'Suoni dell’interfaccia',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio può riprodurre discreti suoni sintetizzati dell’interfaccia: brevi segnali che confermano azioni come selezionare, confermare, attivare ed eliminare. Sono **disattivati di default**, su richiesta, e non influiscono mai sull’audio esportato.',
        },
        {
          kind: 'steps',
          items: [
            'Apri **Impostazioni** e vai alla scheda **Generali**.',
            'Attiva **Suoni dell’interfaccia**.',
            'Regola **Volume dei suoni** a piacere (0–100%).',
            'Scegli un **Tema sonoro** (**Signature**, **Velvet** o **Crisp**) e usa il pulsante **Anteprima** per ascoltarlo.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'I suoni sono soppressi mentre l’anteprima è in riproduzione, così non si mescolano mai all’audio che stai monitorando; le esportazioni sono silenziose per scelta. Attivando l’interruttore si sente una breve conferma.',
        },
      ],
    },
    {
      title: 'Segnalazioni di arresto anomalo e statistiche d’uso',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio non invia nulla su di te o sul tuo lavoro se non lo consenti. La prima volta che si apre chiede, in una scheda nell’angolo in basso a sinistra, se inviare **segnalazioni di arresto anomalo** e **statistiche d’uso anonime**; finché non rispondi, e dopo **Non consentire**, non viene inviato nulla. Puoi cambiare l’una o l’altra in qualsiasi momento in **Impostazioni › Privacy**.',
        },
        {
          kind: 'table',
          headers: ['Segnalazione', 'Che cosa viene inviato', 'Dove'],
          rows: [
            [
              'Segnalazioni di arresto anomalo',
              'L’errore, il punto del codice dell’editor in cui è avvenuto, la versione e il sistema operativo. Percorsi e nomi di file vengono rimossi dai messaggi prima che escano.',
              'Sentry, nell’UE',
            ],
            [
              'Statistiche d’uso',
              'Che l’app è stata aperta, che è stato creato un progetto (dimensione e frequenza fotogrammi), che un’esportazione è terminata (formato, dimensione e durata), che un agente IA si è collegato o che un’ombra è stata rimossa (la sua durata), sotto un id casuale di questa installazione che viene dimenticato quando disattivi le statistiche.',
              'PostHog, nell’UE',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Non vengono mai inviati: il tuo girato, i fotogrammi, i nomi di file e cartelle, i nomi dei progetti o il tuo account. Il tuo indirizzo IP non viene memorizzato. L’app desktop conserva la tua risposta nella sua cartella del profilo, l’editor web nel tuo browser.',
        },
      ],
    },
    {
      title: 'Personalizzare le scorciatoie da tastiera',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Le scorciatoie da tastiera sono completamente personalizzabili, ma l’editor è una finestra a sé, che si apre dal pulsante **Scorciatoie da tastiera** nella barra degli strumenti, non da questa finestra delle impostazioni. Ha una tastiera interattiva su schermo, ricerca e filtri **Personalizzata** / **Conflitti** / **Non assegnate**, registrazione per riassegnare, associazioni alternative, valori predefiniti per singolo comando e **Ripristina tutto**, rilevamento dei conflitti e **Importa** / **Esporta** di preset JSON.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Vedi la pagina **Scorciatoie da tastiera** per l’elenco completo dei comandi e una guida passo passo alla riassegnazione.',
        },
      ],
    },
    {
      title: 'Impostato altrove',
      blocks: [
        {
          kind: 'list',
          items: [
            'La **lingua** dell’interfaccia è un controllo separato nella barra degli strumenti, non fa parte di questa finestra; DroneClean Studio è disponibile in 10 lingue.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Al momento DroneClean Studio usa un unico tema scuro; non c’è un selettore del tema.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
