import type { DocPageContent } from '../../docs-content'

const page = {
  order: 10,
  slug: 'properties',
  title: 'Propriedades do clipe',
  description:
    'Transformação, corte, opacidade e mesclagem, e os controles específicos de cada tipo de clipe.',
  category: 'Core Editing',
  related: ['audio', 'text-captions-subtitles', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Como a seleção controla o painel',
      blocks: [
        {
          kind: 'list',
          items: [
            'Selecione um clipe para editar todo o seu conjunto de propriedades.',
            'Selecione vários clipes para mudar de uma só vez uma propriedade compartilhada por todos.',
            'O painel mostra abas apenas para os grupos de propriedades que se aplicam à seleção atual.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Um valor **Misto** significa que os clipes selecionados não compartilham essa configuração no momento; ao alterá-lo, um único valor é aplicado a todos.',
        },
      ],
    },
    {
      title: 'Controles compartilhados pelos clipes visuais',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Transformação**: posição, tamanho, rotação e ponto de âncora.',
            '**Corte**: corte cada borda para dentro, com um controle de suavidade para a borda do corte.',
            '**Opacidade** e **Mesclagem**: esmaeça um clipe e escolha como ele se compõe sobre as camadas de baixo.',
            '**Vídeo**: velocidade de reprodução e tempos relacionados dos clipes de vídeo.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Muitos controles numéricos podem ser animados — procure o botão de quadro-chave ao lado do valor.',
        },
      ],
    },
    {
      title: 'Controles específicos por tipo',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo de clipe', 'Controles'],
          rows: [
            [
              'Áudio',
              'Ganho, fade de entrada/saída, tom e um equalizador por clipe (veja Edição de áudio).',
            ],
            [
              'Texto',
              'Conteúdo, fonte, tamanho, cor, alinhamento, fundo, espaçamento, efeitos e animação (veja a página Texto).',
            ],
            ['Forma', 'Tipo de forma, caminho, preenchimento, contorno, máscara e suavização.'],
            ['Legenda', 'Tempo e texto das falas, além de predefinições de estilo de legenda.'],
            ['Cor', 'Rodas, curvas e ferramentas de correção (veja Efeitos e cor).'],
          ],
        },
      ],
    },
    {
      title: 'Marcadores',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O painel de propriedades lista todos os marcadores do projeto sob o título **Marcadores**, ordenados por tempo. A lista está sempre disponível — aparece abaixo das configurações da tela quando nada está selecionado e abaixo do editor de marcador quando um marcador está selecionado — para que você possa percorrer e alcançar seus marcadores, qualquer que seja a seleção.',
        },
        {
          kind: 'list',
          items: [
            'Cada linha mostra a cor do marcador, seu rótulo (ou um nome padrão, se não tiver) e seu código de tempo.',
            'Selecione uma linha para torná-la o marcador ativo e levar o cursor de reprodução até esse ponto.',
            'Use o ícone de lixeira de uma linha para remover só aquele marcador.',
            '**Limpar tudo** remove todos os marcadores de uma vez.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Pressione `M` para colocar um marcador no cursor de reprodução. Quando a lista está vazia, ela mostra esta dica.',
        },
        {
          kind: 'paragraph',
          text: 'Ao selecionar um marcador, seu editor abre acima da lista; ali você pode mudar a posição em **Quadro**, editar o **Rótulo** e definir a **Cor** a partir de uma amostra predefinida ou redefini-la para o padrão. O campo **Tempo** mostra o código de tempo do marcador somente para leitura, e **Excluir marcador** o remove.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
