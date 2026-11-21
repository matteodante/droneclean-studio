import type { DocPageContent } from '../../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Libreria media',
  description:
    'Importa i media, ispeziona i file e genera proxy, trascrizioni, didascalie e dati di scena IA.',
  category: 'Core Editing',
  related: ['source-monitor', 'timeline', 'scene-browser', 'export'],
  sections: [
    {
      title: 'Importare i media',
      blocks: [
        {
          kind: 'list',
          items: [
            'Apri la scheda **Media** e usa **Importa** per scegliere i file, oppure trascinali direttamente nella libreria.',
            'DroneClean Studio gestisce video, audio, immagini, GIF, SVG, animazioni Lottie (`.json` e `.lottie`) e risorse generate. Le GIF vengono importate come elementi immagine.',
            'Usa **Importa media da URL** per un link diretto a un file multimediale: l’URL deve puntare al file stesso, non a una pagina che lo incorpora.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'I filmati Apple ProRes si importano, si visualizzano in anteprima e generano le miniature come qualsiasi altra clip, anche nei formati che i browser non sanno decodificare da soli. Quando esporti, le clip ProRes vengono ricodificate nel codec di uscita che scegli; non esiste un formato di uscita ProRes.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'L’importazione di cartelle non è ancora supportata: trascina direttamente i file multimediali. Ciò che si decodifica dipende dal browser; se un file non si importa, prova un formato diverso o transcodificalo prima.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Il girato in log (S-Log3 e simili) appare piatto e slavato per costruzione: è così che viene ripreso. Aggiungi una LUT o una correzione colore per recuperarlo; il file non ha nulla che non va.',
        },
      ],
    },
    {
      title: 'Ispezionare una clip',
      blocks: [
        {
          kind: 'list',
          items: [
            'Apri **Informazioni sul media** per vedere codec, dimensioni, durata, frequenza fotogrammi, dimensione del file, tipo e stato della trascrizione.',
            'Fai doppio clic su una scheda media, oppure usa **Apri nel monitor sorgente**, per vedere in anteprima una sorgente prima di montarla.',
            'Le schede media offrono menu per File, Proxy, Trascrizione, Didascalie incorporate e azioni IA.',
            'Ordina, filtra e raggruppa le risorse per tipo quando la libreria diventa grande.',
          ],
        },
      ],
    },
    {
      title: 'Generare i dati di supporto',
      blocks: [
        {
          kind: 'table',
          headers: ['Azione', 'Che cosa ottieni'],
          rows: [
            [
              'Genera proxy',
              'Una versione più leggera di un video pesante per montare con più fluidità; l’esportazione usa comunque l’originale.',
            ],
            [
              'Genera trascrizione',
              'Testo del parlato modificabile, su cui puoi cercare e da cui ricavare le didascalie.',
            ],
            [
              'Estrai sottotitoli incorporati',
              'Tracce di sottotitoli estratte dal file, pronte da inserire nella timeline.',
            ],
            [
              'Analizza con IA',
              'Rilevamento delle scene e descrizione in locale, così le clip diventano ricercabili nel Navigatore scene.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Clip composte',
      blocks: [
        {
          kind: 'list',
          items: [
            'Raggruppa una sezione della timeline in una **clip composta** che si comporta come un singolo elemento multimediale riutilizzabile.',
            'Le clip composte compaiono nella libreria media e si possono posizionare di nuovo come qualsiasi altra risorsa.',
            'Fai clic con il tasto destro su una clip composta e scegli **Apri come scheda** per modificarla come **sequenza** autonoma.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le clip composte si possono annidare, cioè una può contenerne un’altra, purché la catena non torni mai su se stessa.',
        },
      ],
    },
    {
      title: 'Animazioni Lottie',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Importa file Lottie, sia `.json` sia archivi `.lottie`, come elementi della timeline che vengono renderizzati con precisione al fotogramma in anteprima e in esportazione. Seleziona una clip Lottie per mostrare i suoi controlli di modifica nella sezione **Lottie** del pannello delle proprietà.',
        },
        {
          kind: 'list',
          items: [
            'Controlla la riproduzione con **Velocità**, **Inverti**, **Ciclo** e **Ping-pong**.',
            'Imposta un segmento **Fotogramma iniziale** / **Fotogramma finale** per riprodurre solo una parte dell’animazione, oppure scegli un **Marcatore** con nome per portare il segmento su di esso.',
            'Ricolora l’animazione: i **Colori** con nome dato dall’autore compaiono per primi, mentre le altre forme sono raccolte in una sezione espandibile; un colore condiviso modifica ogni forma che lo usava, e **Ripristina tutto** riporta gli originali.',
            'Modifica sul posto i livelli **Testo** del modello e regola gli slot di valore scalari e vettoriali esposti in **Proprietà**.',
            'Per gli archivi `.lottie` che raggruppano più di un’animazione, passa dall’una all’altra con il selettore **Animazione**; cambia tavolozza con il selettore **Tema** quando il file include dei temi.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Le modifiche a colore, testo, slot e segmento si vedono dal vivo sul canvas mentre trascini o digiti, e vengono confermate come un unico passo di annullamento. La modifica di animazione, tema, marcatore, segmento e modello si applica a una sola clip Lottie selezionata alla volta.',
        },
      ],
    },
    {
      title: 'Risolvere i media mancanti',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Media mancanti compare quando un file collegato è stato spostato, rinominato, eliminato o ha bisogno di un nuovo permesso. Usa **Concedi accesso**, **Individua**, **Individua cartella** o **Sfoglia un’altra cartella** per ripristinare il collegamento. Usa **Lavora offline** solo se intendi ricollegare più tardi.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
