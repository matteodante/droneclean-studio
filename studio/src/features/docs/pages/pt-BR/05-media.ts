import type { DocPageContent } from '../../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Biblioteca de mídia',
  description:
    'Importe mídias, inspecione arquivos e gere proxies, transcrições, legendas e dados de cena por IA.',
  category: 'Core Editing',
  related: ['source-monitor', 'timeline', 'scene-browser', 'export'],
  sections: [
    {
      title: 'Importar mídia',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abra a aba **Mídia** e use **Importar** para escolher arquivos, ou arraste os arquivos direto para a biblioteca.',
            'O DroneClean Studio trabalha com vídeo, áudio, imagens, GIFs, SVGs, animações Lottie (`.json` e `.lottie`) e recursos gerados. Os GIFs são importados como itens de imagem.',
            'Use **Importar mídia da URL** para um link direto a um arquivo de mídia — a URL precisa apontar para o próprio arquivo, não para uma página que o incorpora.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'As filmagens em Apple ProRes são importadas, visualizadas e geram miniaturas como qualquer outro clipe — inclusive em formatos que os navegadores não decodificam sozinhos. Na exportação, os clipes ProRes são recodificados para o codec de saída que você escolher; não existe formato de saída ProRes.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'A importação de pastas ainda não é compatível — solte diretamente os arquivos de mídia. O que pode ser decodificado depende do seu navegador; se um arquivo não for importado, tente outro formato ou transcodifique-o antes.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'As filmagens em log (S-Log3 e semelhantes) parecem chapadas e lavadas por definição — é assim que são capturadas. Aplique uma LUT ou uma correção de cor para recuperá-las; não há nada de errado com o arquivo.',
        },
      ],
    },
    {
      title: 'Inspecionar um clipe',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abra **Informações da mídia** para ver codec, dimensões, duração, taxa de quadros, tamanho do arquivo, tipo e o estado da transcrição.',
            'Clique duas vezes em um cartão de mídia, ou use **Abrir no monitor de origem**, para visualizar uma origem antes de incluí-la na edição.',
            'Os cartões de mídia têm menus para Arquivo, Proxy, Transcrição, Legendas incorporadas e ações de IA.',
            'Ordene, filtre e agrupe os recursos por tipo quando a biblioteca ficar grande.',
          ],
        },
      ],
    },
    {
      title: 'Gerar dados de apoio',
      blocks: [
        {
          kind: 'table',
          headers: ['Ação', 'O que ela oferece'],
          rows: [
            [
              'Gerar proxy',
              'Uma versão mais leve de um vídeo pesado para uma edição mais fluida; a exportação continua usando o original.',
            ],
            [
              'Gerar transcrição',
              'Texto da fala, editável, que você pode pesquisar e transformar em legendas.',
            ],
            [
              'Extrair legendas incorporadas',
              'Faixas de legendas extraídas do arquivo, prontas para inserir na linha do tempo.',
            ],
            [
              'Analisar com IA',
              'Detecção de cenas e legendagem locais, para que os clipes possam ser pesquisados no Navegador de cenas.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Clipes compostos',
      blocks: [
        {
          kind: 'list',
          items: [
            'Agrupe um trecho da linha do tempo em um **clipe composto** que se comporta como um único item de mídia reutilizável.',
            'Os clipes compostos aparecem na biblioteca de mídia e podem ser colocados de novo como qualquer outro recurso.',
            'Clique com o botão direito em um clipe composto e escolha **Abrir como aba** para editá-lo como uma **sequência** independente.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Os clipes compostos podem ser aninhados — um pode conter outro — desde que a cadeia nunca volte a si mesma.',
        },
      ],
    },
    {
      title: 'Animações Lottie',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Importe arquivos Lottie — `.json` simples ou pacotes `.lottie` — como itens da linha do tempo que são renderizados com precisão de quadro na prévia e na exportação. Selecione um clipe Lottie para ver seus controles de edição na seção **Lottie** do painel de propriedades.',
        },
        {
          kind: 'list',
          items: [
            'Controle a reprodução com **Velocidade**, **Inverter**, **Repetir** e **Ping-pong**.',
            'Defina um trecho com **Quadro inicial** / **Quadro final** para reproduzir só uma parte da animação, ou escolha um **Marcador** nomeado para levar o trecho até ele.',
            'Recolorize a animação — as **Cores** nomeadas pelo autor aparecem primeiro, e as formas restantes ficam recolhidas; uma cor compartilhada altera todas as formas que a usavam, e **Redefinir tudo** restaura as originais.',
            'Edite no próprio lugar as camadas de **Texto** do modelo e ajuste os slots de valor escalares e vetoriais expostos em **Propriedades**.',
            'Em arquivos `.lottie` que reúnem mais de uma animação, alterne entre elas com o seletor **Animação**; troque as paletas com o seletor **Tema** quando o arquivo trouxer temas.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'As edições de cor, texto, slots e trecho aparecem ao vivo na tela enquanto você arrasta ou digita e são confirmadas como uma única etapa de desfazer. A edição de animação, tema, marcador, trecho e modelo vale para um clipe Lottie selecionado por vez.',
        },
      ],
    },
    {
      title: 'Corrigir mídia ausente',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Mídia ausente aparece quando um arquivo vinculado foi movido, renomeado, excluído ou precisa de uma nova permissão. Use **Conceder acesso**, **Localizar**, **Localizar pasta** ou **Procurar outra pasta** para restaurar o vínculo. Use **Trabalhar offline** somente se você pretende revincular mais tarde.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
