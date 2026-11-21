import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'Efeitos e cor',
  description:
    'Adicione e empilhe efeitos de GPU, faça a correção de cor com rodas e curvas, leia os escopos, aplique LUTs e isole correções.',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: 'Adicionar e gerenciar efeitos',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Selecione um clipe e abra a seção **Efeitos** em Propriedades.',
            'Use **Adicionar efeito** e depois pesquise ou escolha em uma categoria. Você também pode adicionar **Predefinições** integradas ou as suas próprias predefinições salvas.',
            'Reordene a pilha com **Mover efeito para cima** e **Mover efeito para baixo** — a ordem muda a forma como os efeitos se combinam.',
            'Desative, redefina ou remova um efeito pelo painel dele; os parâmetros numéricos aceitam quadros-chave.',
          ],
        },
      ],
    },
    {
      title: 'O catálogo de efeitos',
      blocks: [
        {
          kind: 'table',
          headers: ['Categoria', 'Efeitos'],
          rows: [
            [
              'Cor',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['Desfoque', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              'Distorcer',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, Ripple Glass, Glass Mosaic, Blocks, Droste e mais',
            ],
            [
              'Estilizar',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, VHS, Halftone, Dither, ASCII, Ink, Pixel Sort, Block Glitch, Color Glitch',
            ],
            ['Chroma', 'Chroma Key (remoção de fundo verde e azul)'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Todos os efeitos são renderizados na GPU (WebGPU). Entre as adições recentes estão **Gradient Map**, **VHS**, **CRT**, **Droste**, **Block Glitch**, as distorções **Ripple Glass** e **Glass Mosaic**, **Ink** e **Pixel Sort**.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'O **ASCII** pode renderizar seus próprios caracteres: defina **Character Set** como **Custom**, digite seus **Caracteres personalizados** (a rampa vai do mais denso ao mais claro) e escolha uma **Fonte** (Monospace, Courier, Consolas ou Lucida Console). Os conjuntos integrados incluem ASCII Ramp, Dense, Binary e Symbols.',
        },
      ],
    },
    {
      title: 'Entradas de cor e o conta-gotas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Todo controle de cor aceita um valor **hex**; digite-o direto no campo (a prévia é atualizada enquanto você digita).',
            'Onde há suporte a transparência, o campo aceita hex de 8 dígitos (`#rrggbbaa`) e o seletor ganha um controle deslizante de alfa.',
            'Clique no **conta-gotas** (pipeta) para amostrar uma cor de qualquer lugar do aplicativo ou da prévia; uma lupa acompanha o cursor para você acertar o pixel exato; depois, clique para aplicar.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'O conta-gotas é um amostrador integrado ao aplicativo (não o nativo do navegador) e não pede nenhuma permissão. A mesma ferramenta sustenta as rodas do espaço de trabalho Cor.',
        },
      ],
    },
    {
      title: 'Corrigir a cor no espaço de trabalho Cor',
      blocks: [
        {
          kind: 'list',
          items: [
            'Mude para o espaço de trabalho **Cor** (`Alt+2`) e selecione um clipe; as rodas e as curvas já estão prontas mesmo antes de existir uma correção.',
            'As **Rodas de cor** ajustam Sombras, Meios-tons, Realces e Deslocamento, com seletores de balanço de branco e balanço automático.',
            'As **Curvas** editam os canais Mestre, Vermelho, Verde e Azul; clique em uma curva para adicionar um ponto e clique duas vezes em um ponto para removê-lo.',
            'Compare com **Antes**, **Depois** e **Dividido**, e copie um visual entre clipes com **Copiar correção de cor** e **Colar correção de cor**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Ignorar correção de cor** mostra na prévia a imagem sem correção, mas nunca afeta as exportações.',
        },
      ],
    },
    {
      title: 'Ler os escopos',
      blocks: [
        {
          kind: 'table',
          headers: ['Escopo', 'Mostra'],
          rows: [
            ['Waveform', 'Luminância e distribuição de cor, de cima para baixo'],
            ['RGB Parade', 'Os canais vermelho, verde e azul lado a lado'],
            ['Vectorscope', 'Matiz e saturação'],
            ['Histogram', 'A distribuição dos tons'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Ative ou desative os escopos com **Mostrar escopos de cor**. Waveform e Histogram também oferecem visualizações RGB, de canal único e de luma (Y).',
        },
      ],
    },
    {
      title: 'LUTs e correções isoladas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Adicione o efeito **LUT (.cube)**, escolha **Importar LUT .cube** e depois ajuste **Intensidade** para misturá-lo.',
            'O **Qualificador secundário** aplica uma correção a uma faixa de matiz, saturação e luminância.',
            'A **Power Window** limita uma correção a uma máscara elíptica ou retangular, com suavização e inversão.',
            'Adicione uma **camada de ajuste** para corrigir a cor ou aplicar efeitos a todos os clipes das faixas abaixo dela.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'A importação de LUT exige um navegador baseado em Chromium.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
