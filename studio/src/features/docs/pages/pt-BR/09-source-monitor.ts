import type { DocPageContent } from '../../docs-content'

const page = {
  order: 9,
  slug: 'source-monitor',
  title: 'Fluxo de trabalho do monitor de origem',
  description:
    'Visualize uma origem, marque um intervalo de entrada/saída, escolha os destinos do patch e insira ou sobrescreva na linha do tempo.',
  category: 'Core Editing',
  related: ['media', 'timeline', 'scene-browser'],
  sections: [
    {
      title: 'Abrir uma origem',
      blocks: [
        {
          kind: 'list',
          items: [
            'Clique duas vezes em um cartão de mídia, ou use **Abrir no monitor de origem** em Informações da mídia, para carregar uma origem.',
            'O cabeçalho do monitor mostra o nome do arquivo de origem, com um controle de fechar para sair dele.',
            'A reprodução da origem é independente da prévia da linha do tempo, então você pode percorrer uma origem sem mover o cursor de reprodução da linha do tempo.',
            'Clique na leitura do código de tempo para alternar entre a exibição em código de tempo e em número de quadro.',
          ],
        },
      ],
    },
    {
      title: 'Marcar um intervalo de entrada/saída',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Vá até o primeiro quadro que você quer e pressione `I` (**Marcar ponto de entrada**).',
            'Vá até o quadro seguinte ao último que você quer e pressione `O` (**Marcar ponto de saída**) — o ponto de saída é exclusivo.',
            'Faça o ajuste fino arrastando a alça de entrada, a alça de saída ou o intervalo inteiro na tira.',
            'Use **Reproduzir de entrada a saída** para revisar apenas o intervalo, ou `Alt+X` para limpá-lo e usar a origem inteira.',
          ],
        },
      ],
    },
    {
      title: 'Escolher os destinos do patch',
      blocks: [
        {
          kind: 'list',
          items: [
            'A chave **V** liga ou desliga o destino do patch de origem de vídeo; a chave **A** faz o mesmo para o áudio.',
            'Cada chave tem um seletor de destino: **Auto**, uma faixa específica pelo nome ou **Criar na edição** para criar uma faixa nova.',
            'Um vídeo com som coloca um par vinculado de vídeo e áudio nas faixas de destino V e A.',
            'A faixa ativa da linha do tempo preenche previamente os destinos V e A correspondentes.',
          ],
        },
      ],
    },
    {
      title: 'Inserir e sobrescrever',
      blocks: [
        {
          kind: 'paragraph',
          text: 'As duas edições colocam o intervalo marcado no quadro atual do cursor de reprodução da linha do tempo e depois avançam o cursor até o fim do novo clipe.',
        },
        {
          kind: 'table',
          headers: ['Edição', 'Tecla', 'O que faz'],
          rows: [
            [
              'Inserir',
              '`,`',
              'Coloca o intervalo e empurra para a direita todo o material posterior nas faixas de destino.',
            ],
            [
              'Sobrescrever',
              '`.`',
              'Substitui o material da linha do tempo que estiver sob o intervalo, deixando os clipes ao redor no lugar.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'As imagens viram por padrão um clipe de **três segundos** na edição, a menos que você marque um intervalo mais curto.',
        },
      ],
    },
    {
      title: 'Se uma edição não for aplicada',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Ative antes pelo menos um dos destinos de patch **V** ou **A**. Para editar áudio, ative **A**; para editar um vídeo sem som ou uma imagem, ative **V**. Uma faixa de destino bloqueada também impede a edição — desbloqueie-a e tente de novo.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
