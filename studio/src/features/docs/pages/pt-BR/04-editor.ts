import type { DocPageContent } from '../../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Layout e navegação do editor',
  description:
    'A barra de ferramentas, a barra lateral de mídia, o monitor de prévia, a linha do tempo, as propriedades e os espaços de trabalho Edição, Cor e Motion.',
  category: 'Start',
  related: ['concepts', 'timeline', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'As áreas principais',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Barra de ferramentas do editor** (no alto): Voltar aos projetos, abas de espaços de trabalho, especificações do projeto, idioma, Configurações, Atalhos de teclado, Salvar, Exportar e a Fila de renderização.',
            '**Barra lateral de mídia** (à esquerda): seus recursos e as ferramentas de criação.',
            '**Monitor de prévia**: o quadro atual com sobreposições, máscaras, escopos e controles de reprodução.',
            '**Linha do tempo** (embaixo): faixas, clipes, marcadores e ferramentas de edição.',
            'Painel **Propriedades**: edita o clipe ou os clipes que estiverem selecionados.',
          ],
        },
      ],
    },
    {
      title: 'As abas da barra lateral de mídia',
      blocks: [
        {
          kind: 'table',
          headers: ['Aba', 'Conteúdo'],
          rows: [
            [
              'Mídia',
              'Recursos importados, informações da mídia, proxies, transcrições, legendas, clipes compostos, controles de mídia ausente',
            ],
            ['Texto', 'Clipes de texto a partir de modelos de um ou de vários trechos'],
            ['Formas', 'Itens de formas geradas'],
            ['Efeitos', 'Efeitos de GPU para o clipe selecionado'],
            ['Transições', 'Transições para arrastar até os cortes'],
            ['IA', 'Texto para fala e geração de música, locais'],
          ],
        },
      ],
    },
    {
      title: 'Espaços de trabalho',
      blocks: [
        {
          kind: 'list',
          items: [
            'O espaço de trabalho **Edição** (`Alt+1`) é o layout de corte padrão para organizar, aparar, texto, formas, efeitos, transições e prévia.',
            'O espaço de trabalho **Cor** (`Alt+2`) se concentra na correção de cor, com rodas de cor, curvas e escopos para o clipe selecionado.',
            'O espaço de trabalho **Motion** reúne composições em camadas, quadros-chave, curvas, predefinições e animação procedural — veja [Espaço de trabalho Motion](motion).',
            'Selecione um clipe visual em Edição e abra **Animação** em Propriedades para ver as predefinições comuns, o estado das animações aplicadas, o movimento de texto e **Criar clipe Motion**.',
            'Troque de espaço de trabalho pelas abas centrais da barra de ferramentas ou use `Alt+1`, `Alt+2` e `Alt+3`.',
          ],
        },
      ],
    },
    {
      title: 'Ajuda e segurança',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abra **Configurações** para ver as preferências gerais, de linha do tempo, de IA e de armazenamento.',
            'Abra **Atalhos de teclado** para buscar comandos, reatribuir teclas e importar ou exportar predefinições.',
            'Salve com frequência usando `Ctrl+S`; o salvamento automático também pode rodar em um intervalo que você define em Configurações.',
            'Desfazer e Refazer (`Ctrl+Z` e `Ctrl+Shift+Z`) cobrem as edições da linha do tempo quando algo dá errado.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
