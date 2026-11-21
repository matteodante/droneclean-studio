import type { DocPageContent } from '../../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Layout dell’editor e navigazione',
  description:
    'La barra degli strumenti, la barra laterale dei media, il monitor di anteprima, la timeline, le proprietà e le aree di lavoro Montaggio, Colore e Motion.',
  category: 'Start',
  related: ['concepts', 'timeline', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Le superfici principali',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Barra degli strumenti dell’editor** (in alto): Torna ai progetti, schede delle aree di lavoro, specifiche del progetto, lingua, Impostazioni, Scorciatoie da tastiera, Salva, Esporta e Coda di rendering.',
            '**Barra laterale dei media** (a sinistra): le tue risorse e gli strumenti di creazione.',
            '**Monitor di anteprima**: il fotogramma corrente con sovrapposizioni, maschere, scope e controlli di riproduzione.',
            '**Timeline** (in basso): tracce, clip, marcatori e strumenti di montaggio.',
            'Pannello **Proprietà**: modifica la clip o le clip che hai selezionato.',
          ],
        },
      ],
    },
    {
      title: 'Le schede della barra laterale dei media',
      blocks: [
        {
          kind: 'table',
          headers: ['Scheda', 'Contenuto'],
          rows: [
            [
              'Media',
              'Risorse importate, informazioni sul media, proxy, trascrizioni, didascalie, clip composte, controlli per i media mancanti',
            ],
            ['Testo', 'Clip di testo da modelli a singolo e a più intervalli'],
            ['Forme', 'Elementi forma generati'],
            ['Effetti', 'Effetti GPU per la clip selezionata'],
            ['Transizioni', 'Transizioni da trascinare sui tagli'],
            ['IA', 'Sintesi vocale e generazione musicale in locale'],
          ],
        },
      ],
    },
    {
      title: 'Aree di lavoro',
      blocks: [
        {
          kind: 'list',
          items: [
            'L’area di lavoro **Montaggio** (`Alt+1`) è il layout di taglio predefinito per disporre, rifinire, testo, forme, effetti, transizioni e anteprima.',
            'L’area di lavoro **Colore** (`Alt+2`) è dedicata alla correzione colore, con ruote colore, curve e scope per la clip selezionata.',
            'L’area di lavoro **Motion** riunisce composizioni a livelli, fotogrammi chiave, grafici, preset e animazione procedurale: vedi [Area di lavoro Motion](motion).',
            'Seleziona una clip visiva in Montaggio e apri **Animazione** in Proprietà per i preset comuni, lo stato delle animazioni applicate, il movimento del testo e **Crea clip Motion**.',
            'Cambia area di lavoro dalle schede al centro della barra degli strumenti, oppure usa `Alt+1`, `Alt+2` e `Alt+3`.',
          ],
        },
      ],
    },
    {
      title: 'Ottenere aiuto e lavorare al sicuro',
      blocks: [
        {
          kind: 'list',
          items: [
            'Apri **Impostazioni** per le preferenze generali, della timeline, dell’IA e dell’archiviazione.',
            'Apri **Scorciatoie da tastiera** per cercare i comandi, riassegnare i tasti e importare o esportare i preset.',
            'Salva spesso con `Ctrl+S`; il salvataggio automatico può anche partire a un intervallo che imposti in Impostazioni.',
            'Annulla e Ripeti (`Ctrl+Z` e `Ctrl+Shift+Z`) coprono le modifiche alla timeline quando qualcosa va storto.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
