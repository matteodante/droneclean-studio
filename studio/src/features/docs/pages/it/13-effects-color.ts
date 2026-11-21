import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'Effetti e colore',
  description:
    'Aggiungi e sovrapponi effetti GPU, correggi il colore con ruote e curve, leggi gli scope, applica LUT e isola le correzioni.',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: 'Aggiungere e gestire gli effetti',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Seleziona una clip e apri la sezione **Effetti** in Proprietà.',
            'Usa **Aggiungi effetto**, poi cerca o scegli da una categoria. Puoi anche aggiungere **Preset** integrati o i tuoi preset salvati.',
            'Riordina la pila con **Sposta su** e **Sposta giù**: l’ordine cambia il modo in cui gli effetti si combinano.',
            'Disattiva, ripristina o rimuovi un effetto dal suo pannello; i parametri numerici possono avere fotogrammi chiave.',
          ],
        },
      ],
    },
    {
      title: 'Il catalogo degli effetti',
      blocks: [
        {
          kind: 'table',
          headers: ['Categoria', 'Effetti'],
          rows: [
            [
              'Colore',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['Sfocatura', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              'Distorsione',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, Ripple Glass, Glass Mosaic, Blocks, Droste e altri',
            ],
            [
              'Stilizzazione',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, VHS, Halftone, Dither, ASCII, Ink, Pixel Sort, Block Glitch, Color Glitch',
            ],
            ['Chiave cromatica', 'Chroma Key (rimozione di green screen e blue screen)'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Tutti gli effetti vengono renderizzati sulla GPU (WebGPU). Tra le aggiunte recenti ci sono **Gradient Map**, **VHS**, **CRT**, **Droste**, **Block Glitch**, le distorsioni **Ripple Glass** e **Glass Mosaic**, **Ink** e **Pixel Sort**.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**ASCII** può disegnare i propri caratteri: imposta **Set di caratteri** su **Personalizzato**, digita i tuoi **Caratteri personalizzati** (la scala va dal più denso al più chiaro) e scegli un **Carattere** (Monospace, Courier, Consolas o Lucida Console). I set integrati includono ASCII Ramp, Dense, Binary e Symbols.',
        },
      ],
    },
    {
      title: 'Input di colore e contagocce',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ogni controllo di colore accetta un valore **esadecimale**; digitalo direttamente nel campo (l’anteprima si aggiorna mentre scrivi).',
            'Dove è supportata la trasparenza, il campo accetta l’esadecimale a 8 cifre (`#rrggbbaa`) e il selettore aggiunge un cursore alfa.',
            'Fai clic sul **contagocce** (pipetta) per campionare un colore da qualsiasi punto dell’app o dell’anteprima; una lente di ingrandimento segue il cursore così puoi centrare il pixel esatto, poi fai clic per applicare.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Il contagocce è un campionatore integrato nell’app (non quello nativo del browser) e non richiede alcuna richiesta di permesso. Lo stesso strumento è alla base delle ruote nell’area di lavoro Colore.',
        },
      ],
    },
    {
      title: 'Correggere il colore nell’area di lavoro Colore',
      blocks: [
        {
          kind: 'list',
          items: [
            'Passa all’area di lavoro **Colore** (`Alt+2`) e seleziona una clip; ruote e curve sono pronte anche prima che esista una correzione.',
            'Le **Ruote colore** regolano Ombre, Mezzitoni, Luci e Offset, con selettori del bilanciamento del bianco e bilanciamento automatico.',
            'Le **Curve** modificano i canali Master, Rosso, Verde e Blu; fai clic su una curva per aggiungere un punto e doppio clic su un punto per rimuoverlo.',
            'Confronta con **Prima**, **Dopo** e **Diviso**, e copia un look da una clip all’altra con **Copia correzione colore** e **Incolla correzione colore**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Escludi correzione** mostra in anteprima l’immagine senza correzione, ma non influisce mai sulle esportazioni.',
        },
      ],
    },
    {
      title: 'Leggere gli scope',
      blocks: [
        {
          kind: 'table',
          headers: ['Scope', 'Che cosa mostra'],
          rows: [
            ['Waveform', 'Distribuzione di luminanza e colore, dall’alto in basso'],
            ['RGB Parade', 'I canali rosso, verde e blu affiancati'],
            ['Vectorscope', 'Tonalità e saturazione'],
            ['Histogram', 'La distribuzione dei toni'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Mostra o nascondi gli scope con **Mostra scope colore**. Waveform e Histogram offrono anche viste RGB, a canale singolo e di luma (Y).',
        },
      ],
    },
    {
      title: 'LUT e correzioni isolate',
      blocks: [
        {
          kind: 'list',
          items: [
            'Aggiungi l’effetto **LUT (.cube)**, scegli **Importa LUT .cube**, poi imposta **Intensità** per miscelarla.',
            '**Secondary Qualifier** applica una correzione a un intervallo di tonalità, saturazione e luminanza.',
            '**Power Window** limita una correzione a una maschera ellittica o rettangolare con sfumatura e inversione.',
            'Aggiungi un **livello di regolazione** per correggere il colore o applicare effetti a ogni clip sulle tracce sottostanti.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'L’importazione delle LUT richiede un browser basato su Chromium.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
