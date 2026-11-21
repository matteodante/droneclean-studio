import type { DocPageContent } from '../../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Progetti',
  description: 'Crea, configura, duplica, organizza, elimina, ripristina e sposta i progetti.',
  category: 'Start',
  related: ['workspaces', 'editor'],
  sections: [
    {
      title: 'Creare e configurare un progetto',
      blocks: [
        {
          kind: 'list',
          items: [
            'Crea un progetto dalla pagina Progetti con **Nuovo progetto**.',
            'Imposta nome, descrizione, risoluzione, frequenza fotogrammi e colore di sfondo del progetto.',
            'Risoluzione e frequenza fotogrammi definiscono il canvas di esportazione e i tempi della timeline: sceglile in base alla consegna che ti serve.',
            'Puoi rivedere le specifiche del progetto in seguito dalla barra degli strumenti dell’editor.',
          ],
        },
      ],
    },
    {
      title: 'Dimensione del canvas e proporzioni',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Il canvas definisce il fotogramma in cui il video viene composto ed esportato. Scegli una dimensione quando crei un progetto, oppure cambiala in qualsiasi momento dal pannello **Canvas** mentre monti.',
        },
        {
          kind: 'paragraph',
          text: 'In **Nuovo progetto**, la sezione **Risoluzione** offre preset pronti per le piattaforme più comuni. Ogni scheda mostra la dimensione in pixel e le proporzioni. Scegli **Personalizzata** per digitare invece larghezza e altezza esatte.',
        },
        {
          kind: 'table',
          headers: ['Preset', 'Risoluzione', 'Proporzioni'],
          rows: [
            ['YouTube 1080p', '`1920x1080`', '`16:9` orizzontale'],
            ['Shorts / TikTok / Reels', '`1080x1920`', '`9:16` verticale'],
            ['Instagram Square', '`1080x1080`', '`1:1` quadrato'],
            ['Instagram Portrait', '`1080x1350`', '`4:5` ritratto'],
            ['Twitter/X', '`1200x675`', '`16:9` orizzontale'],
            ['LinkedIn', '`1200x627`', 'orizzontale'],
            ['Personalizzata', 'I tuoi valori', 'Qualsiasi cosa inserisci'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Per cambiare la dimensione dopo che il progetto esiste:',
        },
        {
          kind: 'steps',
          items: [
            'Deseleziona ogni clip, così la barra laterale delle proprietà mostra il pannello **Canvas**.',
            'Modifica i campi **W** e **H** per impostare larghezza e altezza del fotogramma in pixel.',
            'Usa **Scambia** per invertire larghezza e altezza, per esempio per trasformare un progetto orizzontale in uno verticale.',
            'Usa **Ripristina** per riportare il canvas a `1920x1080`.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Le dimensioni si arrotondano a numeri pari e vanno da `320x240` fino a `7680x4320`. Le clip esistenti mantengono posizione e scala attuali quando il canvas cambia, quindi riposiziona ciò che ora finisce fuori dal nuovo fotogramma.',
        },
      ],
    },
    {
      title: 'Organizzare l’elenco dei progetti',
      blocks: [
        {
          kind: 'list',
          items: [
            'Cerca i progetti per nome, e ordina o filtra l’elenco man mano che cresce.',
            'Usa miniature e metadati per riconoscere l’ultimo progetto su cui hai lavorato.',
            'Lo spazio di lavoro attivo è indicato nella pagina Progetti, così sai sempre dove sono archiviati i progetti.',
            'Usa **Duplica** per creare una variante senza toccare l’originale.',
          ],
        },
      ],
    },
    {
      title: 'Cestino e ripristino',
      blocks: [
        {
          kind: 'list',
          items: [
            'Eliminare un progetto lo sposta nel **Cestino** invece di rimuoverlo subito.',
            'Ripristina un progetto dalla sezione Cestino finché è ancora lì.',
            '**Svuota il cestino** elimina definitivamente i progetti nel cestino e i media a cui fanno riferimento in modo esclusivo.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'L’eliminazione definitiva non si può annullare, quindi controlla il nome prima di svuotare il cestino.',
        },
      ],
    },
    {
      title: 'Spostare il lavoro tra spazi di lavoro',
      blocks: [
        {
          kind: 'list',
          items: [
            'Usa **Esporta progetto** per creare un bundle che impacchetta il progetto insieme ai suoi media.',
            'Importa un bundle in un altro spazio di lavoro per continuare lo stesso montaggio su un’altra macchina o in un’altra cartella.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'I bundle sono il modo sicuro per passare un progetto a qualcun altro, perché portano con sé i media collegati insieme alla timeline.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
