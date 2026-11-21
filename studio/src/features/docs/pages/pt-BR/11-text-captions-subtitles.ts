import type { DocPageContent } from '../../docs-content'

const page = {
  order: 11,
  slug: 'text-captions-subtitles',
  title: 'Texto, legendas e legendas de diálogo',
  description:
    'Adicione e estilize clipes de texto, gere legendas a partir de uma transcrição e importe faixas de legendas incorporadas.',
  category: 'Creative Tools',
  related: ['motion-library', 'motion', 'shapes-masks', 'properties', 'local-ai'],
  sections: [
    {
      title: 'Três coisas relacionadas',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo', 'O que é', 'Ponto de partida'],
          rows: [
            [
              'Clipe de texto',
              'Um item independente da linha do tempo no qual você digita',
              'A aba Texto',
            ],
            [
              'Legendas',
              'Linhas geradas que acompanham um clipe de vídeo ou de áudio',
              'A transcrição de um clipe',
            ],
            [
              'Legendas de diálogo',
              'Uma faixa de falas na linha do tempo',
              'Uma faixa incorporada, ou legendas consolidadas',
            ],
          ],
        },
      ],
    },
    {
      title: 'Adicionar e estilizar um clipe de texto',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abra a aba **Texto** e clique em **Adicionar texto** ou em um modelo para colocar o texto no cursor de reprodução — ou arraste um modelo para a linha do tempo ou para a tela.',
            'Escolha um layout (**Único**, **2 trechos**, **3 trechos**) e uma predefinição de estilo, como Clean, Lower Third, Cinematic ou Neon.',
            'Na seção **Texto**, defina fonte, tamanho (8–500 px), peso, cor, fundo, alinhamento, espaçamento, altura da linha, preenchimento e raio.',
            'Adicione sombra ou contorno em **Efeitos** e anime o texto em **Animação de texto**.',
          ],
        },
      ],
    },
    {
      title: 'Animação de texto',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Na seção **Animação de texto** (nas propriedades do texto ou na biblioteca **Motion** da camada selecionada), cada caractere, palavra ou linha pode ser animado de forma independente. A animação de texto continua ao vivo e procedural, então não há quadros-chave de camada para gerenciar.',
        },
        {
          kind: 'steps',
          items: [
            'Selecione um clipe de texto e abra a seção **Animação de texto**.',
            'Escolha uma predefinição na linha **Entrada**, **Saída** ou **Loop**. **Entrada** toca no início do clipe, **Saída** no fim do clipe e **Loop** roda continuamente entre os dois.',
            'Clique de novo na predefinição ativa (ou no seu ✕) para removê-la — uma predefinição por linha.',
            'Ajuste os controles que aparecem sob a predefinição ativa.',
            'No Motion, arraste a borda de uma faixa de movimento de texto para mudar sua duração, ou arraste uma faixa de Entrada ou Saída para longe da borda do clipe para deslocá-la.',
          ],
        },
        {
          kind: 'table',
          headers: ['Controle', 'O que faz'],
          rows: [
            [
              'Aplicar a',
              'A unidade que cada predefinição anima: Caractere, Palavra, Linha ou Clipe inteiro.',
            ],
            ['Duração', 'Comprimento, em quadros, da animação de cada unidade.'],
            ['Escalonamento', 'Quadros de atraso entre cada unidade, para um efeito em cascata.'],
            [
              'Ordem',
              'Qual unidade anima primeiro: Para frente, Para trás, Do centro ou Aleatório.',
            ],
            ['Intensidade', 'Dimensiona a força do efeito, de 0 a 200 por cento.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A lista **Aplicado** mostra cada slot de movimento de texto ativo. Selecione uma entrada para levar o cursor de reprodução até a faixa dela na linha do tempo.',
        },
      ],
    },
    {
      title: 'Legendas a partir de uma transcrição',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Gere uma transcrição do clipe pela biblioteca de mídia ou pelo painel Transcrição.',
            'Use **Gerar legendas** (ou deixe o DroneClean Studio ativar automaticamente as legendas da transcrição) no menu de contexto do clipe.',
            'Edite o tempo e o texto das falas e escolha uma predefinição de estilo (Netflix, YouTube, Bold Yellow, Outlined, TikTok) na seção **Legenda**.',
            'Ajuste a cor, o tamanho e a posição vertical da legenda, e um fundo opcional.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Use **Consolidar legendas em segmento** para transformar as legendas da transcrição em um segmento de legendas independente.',
        },
      ],
    },
    {
      title: 'Legendas incorporadas e importadas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Extrair legendas incorporadas** em um cartão de mídia para procurar faixas de legendas em um arquivo.',
            'Na caixa de diálogo **Legendas incorporadas**, escolha uma faixa — cada linha mostra seu idioma, codec e número de falas.',
            'Insira a faixa para adicionar suas falas à linha do tempo como um segmento de legendas.',
            'Edite o início, o fim e o texto de cada fala na seção **Legenda** e defina Itálico, Negrito ou Sublinhado para a fala inteira.',
          ],
        },
      ],
    },
    {
      title: 'Legendas na exportação',
      blocks: [
        {
          kind: 'note',
          tone: 'info',
          text: 'Ative **Incorporar legendas** nas configurações de exportação para incluir as legendas da transcrição como uma faixa de legendas (MP4, MKV, WebM). Alguns players ocultam as faixas de legendas por padrão, então talvez os espectadores precisem ativá-las.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
