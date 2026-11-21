import type { DocPageContent } from '../../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: 'Transizioni',
  description:
    'Applica una transizione a un taglio e regolane stile, durata, posizionamento, andamento e direzione.',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Applicare una transizione',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Apri la scheda **Transizioni** nella barra laterale dei media.',
            'Trascina una scheda di transizione su un taglio tra due clip adiacenti, oppure seleziona un taglio valido e fai clic su una scheda.',
            'Seleziona la transizione sulla timeline per aprire la sezione **Transizione** in Proprietà.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Un taglio è valido quando due clip sono affiancate bordo a bordo e hanno abbastanza fotogrammi sorgente di riserva da sovrapporsi. Applicarne una sopra una transizione esistente la sostituisce sul posto.',
        },
      ],
    },
    {
      title: 'Scegliere uno stile',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Le schede sono raggruppate per categoria: **Base**, **Dissolvenza**, **Movimento**, **Tendina**, **Scorrimento**, **Ribaltamento**, **Maschera**, **Iride**, **Forma**, **Luce** e **Cromatica**.',
        },
        {
          kind: 'list',
          items: [
            'Gli stili di dissolvenza vanno da una semplice Cross Dissolve alle varianti Additive, Blur e Dip To Color.',
            'Gli stili di movimento e personalizzati includono Flip, Light Leak, Pixelate, Chromatic, Radial Blur, Glitch e Sparkles.',
            'Gli stili direzionali come Wipe, Slide e Flip compaiono come più schede, una per direzione.',
          ],
        },
      ],
    },
    {
      title: 'Regolare una transizione',
      blocks: [
        {
          kind: 'table',
          headers: ['Controllo', 'Che cosa fa'],
          rows: [
            ['Preset', 'Cambia lo stile della transizione senza rifare il taglio.'],
            [
              'Durata',
              'Imposta per quanto dura la transizione; il ripristino la riporta a 1 secondo.',
            ],
            [
              'Posizionamento',
              'Al centro del taglio, oppure sposta la transizione prima o dopo di esso.',
            ],
            ['Andamento', 'Lineare, In, Out oppure In e Out.'],
            ['Direzione', 'Sinistra, Destra, Alto o Basso, per gli stili direzionali.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Puoi anche ridimensionare una transizione trascinandone il bordo direttamente sulla timeline.',
        },
      ],
    },
    {
      title: 'Quando una transizione non si applica',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Serve un vero taglio tra due clip, e abbastanza **margine sorgente** sul lato interessato. Se un posizionamento è bloccato, scegline un altro o taglia di meno. Trascinare su un taglio valido funziona sempre, anche quando l’applicazione con un clic non è disponibile.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
