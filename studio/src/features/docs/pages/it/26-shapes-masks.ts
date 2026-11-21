import type { DocPageContent } from '../../docs-content'

// L’ordine 11.5 colloca questa pagina subito dopo Testo, didascalie e sottotitoli in Creative Tools.
const page = {
  order: 11.5,
  slug: 'shapes-masks',
  title: 'Forme e maschere',
  description:
    'Aggiungi elementi forma, disegna tracciati personalizzati con lo strumento penna e usa qualsiasi forma come maschera di una clip.',
  category: 'Creative Tools',
  related: ['motion', 'properties', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Aggiungere una forma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Apri la scheda **Forme** e fai clic su una forma per aggiungerla alla testina, oppure trascinala su una traccia specifica.',
            'Forme integrate: **Rettangolo**, **Cerchio**, **Ellisse**, **Triangolo**, **Stella**, **Poligono** e **Cuore**.',
            'Una nuova forma arriva dimensionata sul canvas e selezionata, pronta da posizionare e stilizzare.',
          ],
        },
      ],
    },
    {
      title: 'Stilizzare una forma',
      blocks: [
        {
          kind: 'table',
          headers: ['Controllo', 'Note'],
          rows: [
            ['Tipo', 'Passa tra i sette tipi di forma.'],
            ['Riempimento', 'Un riempimento a tinta unita o a gradiente.'],
            [
              'Spess. contorno / Contorno',
              'Spessore del contorno (0–50 px) e suo colore (mostrato quando lo spessore è superiore a 0).',
            ],
            [
              'Terminazione / Giunzione',
              'Le estremità del contorno e il modo in cui si incontrano i segmenti collegati.',
            ],
            [
              'Taglia tracciati',
              'Controlli Inizio, Fine e Offset per disegnare solo una parte di un tracciato.',
            ],
            ['Rastremazione', 'Larghezze iniziale e finale per un contorno rastremato.'],
            [
              'Raggio',
              'Arrotondamento degli angoli (0–100 px) per rettangolo, triangolo, stella e poligono.',
            ],
            ['Punti / Raggio int.', 'Numero di punti e raggio interno, per stella e poligono.'],
            ['Direzione', 'Verso in cui punta un triangolo.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Posizione, dimensione, rotazione e opacità si trovano nei controlli Trasformazione, e la maggior parte dei valori può avere fotogrammi chiave: vedi [Animazione con fotogrammi chiave](keyframes).',
        },
      ],
    },
    {
      title: 'Animare i vertici del tracciato in Motion',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Apri la forma in **Motion** ed espandi le sue righe delle proprietà.',
            'Seleziona i punti del tracciato nell’anteprima.',
            'Scegli **Vertici selezionati** per animare solo quei punti, oppure **Tutti i vertici** per esporre ogni punto.',
            'Aggiungi fotogrammi chiave alle coordinate dei vertici e sposta la testina prima di rimodellare il tracciato.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'I fotogrammi chiave della Geometria del tracciato bloccano la topologia del tracciato. Rimuovili prima di aggiungere, rimuovere, riordinare o cambiare il primo vertice.',
        },
      ],
    },
    {
      title: 'Disegnare un tracciato personalizzato con lo strumento penna',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Nella scheda Forme, scegli lo strumento **Penna** per disegnare una forma a tracciato personalizzato.',
            'Fai clic nell’anteprima per posizionare i punti; fai clic e trascina un punto per estrarre le maniglie curve (bézier).',
            'Backspace rimuove l’ultimo punto, ed Escape annulla.',
            'Con almeno tre punti, scegli **Termina forma** per confermarla (oppure **Annulla**).',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Per rimodellare un tracciato in seguito, selezionalo e usa **Modifica tracciato**: trascina punti e maniglie, fai doppio clic su un bordo per aggiungere un punto e converti un punto tra **Angolo** e **Bézier**. Scegli **Fatto** quando hai finito.',
        },
      ],
    },
    {
      title: 'Usare una forma come maschera',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Posiziona la forma su una traccia **sopra** la clip che vuoi mascherare.',
            'Nella sezione Forma, attiva **Usa come maschera**.',
            'Scegli un **Tipo di maschera**: **Clip** per i bordi netti, oppure **Alfa** per i bordi morbidi.',
            'Per una maschera Alfa, regola **Sfumatura** per ammorbidire il bordo; usa **Inverti** per nascondere l’area della forma invece di mostrarla.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Una maschera agisce su tutto ciò che si trova sulle tracce sottostanti, secondo la geometria della forma. La sfumatura vale solo per le maschere Alfa: le maschere Clip restano a bordi netti.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Mentre modifichi una maschera o disegni con la penna, il resto dell’editor è bloccato: termina o esci dalla modifica della maschera per continuare.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
