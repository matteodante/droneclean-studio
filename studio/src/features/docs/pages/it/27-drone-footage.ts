import type { DocPageContent } from '../../docs-content'

// Gli strumenti propri di DroneClean Studio per il girato da drone e FPV (19 nov 2026; gli strumenti delle versioni 0.1.3-0.1.4 aggiunti il 20 nov 2026):
// ciò che le pagine di FreeCut non coprono.
const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Girato da drone: stabilizza, correggi il colore, velocità, condividi',
  description:
    'Stabilizzazione con il giroscopio e inquadratura, il profilo D-Log M, i look e il cielo, rampe di velocità con andamento, sfocatura di movimento e slow motion fluido, marcatori sul ritmo, il montaggio fluido con un clic, l’esportazione per Instagram Reels, TikTok e YouTube Shorts e l’accesso degli agenti.',
  category: 'Creative Tools',
  related: ['effects-color', 'keyframes', 'export', 'properties'],
  sections: [
    {
      title: 'Stabilizzare dai dati del giroscopio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'I file DJI e GoPro portano con sé il movimento della camera. Seleziona una clip e attiva **Stabilizza questa clip** in Proprietà › Video › Stabilizzazione: la clip viene stabilizzata da quei dati, senza una passata di analisi, e **Fluidità** e **Blocco dell’orizzonte** la regolano.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Una clip stabilizzata viene disegnata nella forma del progetto. Una clip Avata 4:3 in un progetto 9:16 riempie da sola il fotogramma verticale; non serve ridimensionarla.',
        },
        {
          kind: 'paragraph',
          text: 'L’**Inquadratura** (due cursori sotto Stabilizzazione) sposta la finestra stabilizzata di lato o su e giù dentro l’immagine, per quanto spazio lascia la stabilizzazione, così un montaggio verticale tiene il soggetto in vista. Il rombo accanto a ogni cursore ne crea i fotogrammi chiave, così l’inquadratura può seguire il soggetto per tutta la ripresa.',
        },
      ],
    },
    {
      title: 'Colore: profilo, look, correzione',
      blocks: [
        {
          kind: 'steps',
          items: [
            "Imposta il **Profilo colore** delle clip in log (D-Log M per l’Avata 2, D-Log): l’immagine piatta diventa Rec.709 prima di ogni altra cosa. I file DJI non dicono in quale profilo sono stati girati, quindi la prima importazione DJI di un progetto lo chiede una volta; **Sì, D-Log M** lo imposta su quelle clip. Il profilo è stato tarato su riprese dell'Avata 2. DJI pubblica una LUT D-Log M anche per Mini 4 Pro e Air 3 e il pannello riconosce quei droni, ma il loro colore qui non è stato verificato, e il pannello lo dice.",
            'Scegli un **Look** (un file `.cube` della libreria di look dello spazio di lavoro; **Gestisci look… › Aggiungi .cube** ne aggiunge uno) e la sua **Intensità**.',
            'Concludi in **Effetti**: Color Wheels per contrasto, luci e dettaglio dei mezzitoni; **Sky** dà a un cielo bianco coperto un blu sfumato (orizzonte, angolo, morbidezza e una protezione che lo mantiene sui pixel chiari e pallidi); un Secondary Qualifier e una Power Window fanno lo stesso a mano; Glow, Vignette e Sharpen rifiniscono l’immagine.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Anche ghiaccio e neve sono bianchi: nelle riprese con ghiaccio tieni leggero il qualificatore e lascia che la finestra sfumata colori il cielo.',
        },
      ],
    },
    {
      title: 'Velocità, sfocatura di movimento e slow motion fluido',
      blocks: [
        {
          kind: 'table',
          headers: ['Controllo', 'Che cosa fa'],
          rows: [
            [
              'Velocità',
              'Una velocità costante; la clip mantiene il suo intervallo sorgente e la sua lunghezza ne segue la velocità.',
            ],
            [
              'Curva…',
              'Una curva di velocità con fotogrammi chiave: rampa in entrata, in uscita o entrambe, ogni segmento Lineare, Morbido, Accelerazione o Decelerazione. Il pannello mostra i fotogrammi al secondo che la clip ha davvero nel suo punto più lento.',
            ],
            [
              'Rampa fluida + zoom',
              'La ricetta del reel da drone con un clic, nel pannello della velocità: veloce, circa 0,45x al centro, di nuovo veloce, con segmenti morbidi, slow motion fluido, sfocatura di movimento e uno zoom in entrata con andamento morbido.',
            ],
            [
              'Sfocatura di movimento',
              'Sopra 1x, fonde i fotogrammi sorgente che ogni fotogramma di uscita copre, con un otturatore da 90° a 360°.',
            ],
            [
              'Slow motion fluido',
              'Sotto 1x, oppure per un file a 30 fps in un progetto a 60 fps, crea i fotogrammi intermedi invece di mostrare due volte lo stesso: Fusione dei fotogrammi mescola i due fotogrammi sorgente, Flusso ottico costruisce il fotogramma dal movimento tra loro (più nitido, senza immagini doppie).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Rallenta solo il girato ripreso a una frequenza fotogrammi più alta di quella del progetto. Un file a 30 fps in un progetto a 60 fps ha già metà dei fotogrammi che gli servono: tienilo a 1x o più veloce, e non rallentare il girato a 60 fps oltre 0,5x.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Taglia sui battiti forti della canzone, non su ogni battito: fai clic con il tasto destro sulla canzone e scegli **Segna i battiti** (un marcatore su ogni colpo forte di basso), oppure segnali tu con `M`, poi lascia che ogni clip scorra da un marcatore al successivo.',
        },
      ],
    },
    {
      title: 'Montaggio fluido con un clic',
      blocks: [
        {
          kind: 'paragraph',
          text: "Metti le clip video e una canzone nella timeline, poi fai clic su **Montaggio fluido…** (il pulsante con le scintille nella barra della timeline). L'editor trova i battiti della canzone, mette le clip video una dopo l'altra dal primo battito, ognuna tagliata al numero di battute che scegli, e dà a ognuna il look del montaggio fluido: una rampa di velocità veloce, lenta, veloce con slow motion a flusso ottico, sfocatura di movimento e uno zoom in avanti con andamento. È il montaggio dei reel di droni in un solo passo.",
        },
        {
          kind: 'steps',
          items: [
            "Aggiungi la canzone e le clip alla timeline. Se non c'è nessuna clip audio, la finestra dice **Aggiungi prima una canzone alla timeline**.",
            "Fai clic su **Montaggio fluido…**, scegli la canzone se ce n'è più di una, la **Durata dell'inquadratura** (1, 2 o 4 battute; una battuta sono quattro battiti) e se aggiungere la **Breve dissolvenza incrociata a ogni taglio**.",
            'La finestra dice quante clip cambieranno. Fai clic su **Applica**.',
          ],
        },
        {
          kind: 'paragraph',
          text: "Ogni clip mantiene il suo punto di attacco, quindi taglia prima l'inizio di una clip per scegliere dove comincia la sua inquadratura. Le parti veloci consumano il girato più in fretta di quanto durano, quindi un'inquadratura di una battuta usa circa una battuta e mezza della clip. Una clip con troppo poco girato dopo il punto di attacco viene saltata, e le clip che finirebbero dopo la canzone restano come sono, dopo l'ultima inquadratura. Una clip stabilizzata mantiene la stabilizzazione. Non viene eliminato nulla e **Ctrl/Cmd+Z** annulla tutto il montaggio in un solo passo.",
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Un agente IA può fare lo stesso con una sola chiamata, `studio.clips.smoothEditTimeline({ bars, crossfade })`, e scegliere comunque da sé, prima, la parte migliore di ogni clip.',
        },
      ],
    },
    {
      title: 'Esportare per Instagram, TikTok e Shorts',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Il preset **Instagram Reel** segue la specifica Reel di Meta: MP4 H.264 alla frequenza fotogrammi del progetto, 20 Mbps a 60 fps o 12 Mbps a 30 fps, sotto il massimo di 25 Mbps di Meta, con audio AAC a 128 kbps, l’indice all’inizio del file e nessuna edit list. In un progetto verticale (9:16) il fotogramma è di 1080x1920, quello che Instagram mostra; in qualsiasi altro progetto il preset mantiene la forma del progetto (1920x1080 per un 16:9) e non la deforma mai. Instagram ricodifica ogni caricamento; dargli il suo fotogramma e la sua dimensione evita un secondo ridimensionamento.',
        },
        {
          kind: 'paragraph',
          text: 'I preset **TikTok** e **YouTube Shorts** producono lo stesso MP4 H.264 alla frequenza dei fotogrammi del progetto (fino a 60 fps): 1080x1920 in un progetto verticale, la forma del progetto stesso in qualsiasi altro. **YouTube Shorts** usa i valori 1080p pubblicati da YouTube: 12 Mbps a 60 fps o 8 Mbps a 30 fps, con audio AAC stereo a 384 kbps. TikTok non pubblica un bitrate, quindi **TikTok** usa 16 Mbps a 60 fps o 10 Mbps a 30 fps, scelti da noi, con AAC a 128 kbps. Entrambe le piattaforme ricodificano ogni caricamento. Per un video verticale, parti da un progetto verticale di 1080x1920; l’inquadratura della stabilizzazione sceglie poi la parte del girato del drone da tenere.',
        },
      ],
    },
    {
      title: 'Lasciare che un agente IA monti',
      blocks: [
        {
          kind: 'paragraph',
          text: 'L’app desktop esegue un server MCP locale per gli agenti IA sul tuo computer, attivo di default: **Impostazioni › Accesso degli agenti › Consenti agenti IA** lo disattiva o lo riattiva, e solo il tuo utente può raggiungerlo. Il pannello mostra il comando per Claude Code o la configurazione per altri client. Un agente può quindi costruire e correggere il colore di un progetto ed esportarlo attraverso lo stesso SDK usato dall’editor, e ogni modifica è un passo di annullamento che puoi vedere. Ogni chiamata che modifica il progetto lo salva.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
