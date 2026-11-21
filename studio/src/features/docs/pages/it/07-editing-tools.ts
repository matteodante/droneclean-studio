import type { DocPageContent } from '../../docs-content'

const page = {
  order: 7,
  slug: 'editing-tools',
  title: 'Strumenti di montaggio',
  description:
    'Selezione, rasoio, taglio, slip, slide, cambio di velocità e i comportamenti di taglio ripple e rolling.',
  category: 'Core Editing',
  related: ['timeline', 'keyboard-shortcuts', 'properties'],
  sections: [
    {
      title: 'Gli strumenti principali',
      blocks: [
        {
          kind: 'table',
          headers: ['Strumento', 'Tasto', 'Uso'],
          rows: [
            ['Selezione', '`V`', 'Seleziona, sposta e organizza le clip.'],
            [
              'Modifica taglio',
              '`T`',
              'Trascina il bordo di una clip per cambiare dove inizia o finisce.',
            ],
            ['Rasoio', '`C`', 'Taglia una clip dove fai clic.'],
            ['Cambia velocità', '`R`', 'Cambia la durata modificando la velocità di riproduzione.'],
            ['Slip', '`Y`', 'Cambia i fotogrammi sorgente dentro una clip senza spostarla.'],
            ['Slide', '`U`', 'Sposta una clip regolando i tagli adiacenti.'],
          ],
        },
      ],
    },
    {
      title: 'Comportamenti di taglio',
      blocks: [
        {
          kind: 'list',
          items: [
            'Un taglio **ripple** modifica un punto di montaggio e sposta tutto il materiale successivo, quindi la durata totale cambia.',
            'Un taglio **rolling** sposta il taglio tra due clip adiacenti, senza cambiare la durata complessiva.',
            'Una modifica **slip** cambia quali fotogrammi sorgente compaiono dentro una clip, senza spostare la clip né quelle vicine.',
            'Una modifica **slide** sposta una clip lungo la traccia regolando automaticamente i tagli adiacenti.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple e rolling sono comportamenti dello strumento **Modifica taglio**, non strumenti separati con una scorciatoia propria.',
        },
      ],
    },
    {
      title: 'Mantenere le clip in sincronia',
      blocks: [
        {
          kind: 'list',
          items: [
            'La **Selezione collegata** sposta insieme una clip video e il suo audio; attivala o disattivala con `Shift+L`.',
            'Collega le clip con `Ctrl+Alt+L` e scollegale con `Alt+Shift+L` quando il rapporto tra loro deve cambiare.',
            'Il **blocco sincronia** su una traccia mantiene allineata la temporizzazione durante le modifiche in stile ripple.',
          ],
        },
      ],
    },
    {
      title: 'Modifiche strutturali',
      blocks: [
        {
          kind: 'list',
          items: [
            'Inserisci un **fermo immagine** alla testina con `Shift+F` per mantenere un singolo fotogramma.',
            'Raggruppa una serie di clip in una **clip composta** per riutilizzare o semplificare una sezione affollata, oppure aprila come scheda di **sequenza** per modificarla come timeline autonoma.',
            'Usa la finestra **Layout Bento** per disporre le clip visive selezionate in una griglia strutturata.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
