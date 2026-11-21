import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.75,
  slug: 'motion',
  title: 'Usar o espaço de trabalho Motion',
  description:
    'Construa, cronometre, anime, vincule por hierarquia e reutilize composições 2D em camadas no espaço de trabalho Motion.',
  category: 'Creative Tools',
  related: ['motion-library', 'keyframes', 'shapes-masks', 'concepts'],
  sections: [
    {
      title: 'Abrir ou criar uma composição Motion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O Motion reúne em um único espaço de trabalho a biblioteca de mídia, a prévia da composição, a linha do tempo de camadas, as propriedades, os quadros-chave, o gráfico e a Biblioteca de movimento.',
        },
        {
          kind: 'steps',
          items: [
            'Escolha **Motion** no seletor de espaços de trabalho, ou pressione `Alt+3`.',
            'Escolha uma composição existente no menu de composições, ou escolha **Nova comp.**.',
            'Para promover clipes de sequência, selecione-os na Edição, abra **Animação** e escolha **Criar clipe Motion**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Criar um clipe Motion preserva os clipes selecionados e a animação deles dentro da nova composição. O novo invólucro continua sendo um clipe comum na Edição.',
        },
      ],
    },
    {
      title: 'Adicionar camadas à composição',
      blocks: [
        {
          kind: 'list',
          items: [
            'Arraste vídeo, áudio, imagens, texto, formas, arquivos Lottie ou outra composição da biblioteca de mídia.',
            'Escolha **Adicionar item** para criar camadas de **Texto**, **Cor sólida**, **Gradiente**, **Forma** ou **Objeto nulo**.',
            'Cor sólida e Gradiente criam camadas de forma de quadro inteiro que você pode redimensionar, estilizar, mascarar e animar.',
            'O DroneClean Studio impede que uma composição contenha a si mesma, inclusive por aninhamento circular indireto.',
          ],
        },
      ],
    },
    {
      title: 'Definir a duração e o intervalo ativo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A duração autoral define a composição. As alças de Entrada e Saída da régua definem o intervalo ativo de renderização dentro dessa duração.',
        },
        {
          kind: 'steps',
          items: [
            'Arraste as alças de **Entrada** e **Saída** acima da régua do Motion para marcar o intervalo ativo.',
            'Escolha **Recortar composição para a região ativa** para encurtar a composição autoral até esse intervalo.',
            'Escolha **Ajustar zoom** para enquadrar a composição autoral sem mudar sua duração.',
            'Edite **Duração da comp.** em Propriedades e selecione a unidade dela para alternar entre quadros e segundos.',
            'Leia o valor correspondente de **Código de tempo** abaixo do controle de duração.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Recortar mantém os controles de Entrada e Saída disponíveis e ajusta o novo intervalo. As camadas que vão além da duração autoral continuam visíveis no excedente esmaecido.',
        },
      ],
    },
    {
      title: 'Organizar e cronometrar camadas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Arraste o trecho de uma camada para movê-lo no tempo. As camadas selecionadas se movem juntas em uma única etapa de desfazer.',
            'Edite os campos de **Entrada** e **Saída** de cada camada, ou arraste as bordas do trecho dela para aparar.',
            'Use os controles da camada para mudar visibilidade, bloqueio, solo, modo de mesclagem e ordem de empilhamento.',
            'Arraste a alça de três pontos para reordenar uma camada ou um grupo. As camadas filhas permanecem dentro do grupo atual.',
            'Selecione duas ou mais camadas e escolha **Grupo de camadas**. Visibilidade, bloqueio, solo, tempo e reordenação do grupo valem para as filhas dele.',
            'Clique com o botão direito em uma camada ou grupo para renomear, agrupar, desagrupar, duplicar, copiar, colar ou excluir.',
          ],
        },
      ],
    },
    {
      title: 'Animar propriedades e vértices de caminho',
      blocks: [
        {
          kind: 'list',
          items: [
            'Expanda uma camada para revelar os grupos de propriedades aninhados, os controles de valor, a gravação automática, a navegação e os losangos de quadro-chave.',
            'Defina o filtro de propriedades como **Propriedades animadas** quando precisar só das linhas que contêm quadros-chave.',
            'Selecione o losango de uma propriedade para adicionar ou remover um quadro-chave no cursor de reprodução compartilhado.',
            'Selecione dois quadros-chave vizinhos para editar a suavização do segmento entre eles.',
            'Selecione o ícone de curva de uma propriedade para trocar a faixa dela na dope sheet por um gráfico de valores embutido.',
            'Abra o menu do grupo Posição e escolha **Separar dimensões da posição** para editar X e Y de forma independente.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'As formas de caminho expõem faixas de vértices no Motion. Selecione pontos do caminho na prévia e depois alterne entre **Vértices selecionados** e **Todos os vértices** acima das linhas de propriedades.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Depois que a Geometria do caminho tiver quadros-chave, não é possível adicionar, remover, reordenar nem mudar o primeiro vértice do caminho. Remova esses quadros-chave antes de mudar a topologia do caminho.',
        },
      ],
    },
    {
      title: 'Vincular camadas com um Objeto nulo',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Escolha **Adicionar item > Objeto nulo**. Um Objeto nulo controla transformações, mas não é renderizado.',
            'Escolha um pai no menu **Pai**, ou arraste o pick whip de Pai até outra camada.',
            'Solte normalmente para preservar a pose do filho na tela.',
            'Segure **Shift** ao soltar para encaixar a posição do filho no pai.',
            'Segure **Alt/Option** ao soltar para usar a pose local autoral do filho.',
            'Clique com Ctrl ou Command no pick whip do filho para desvinculá-lo preservando a pose atual.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Os alvos de pai válidos são destacados enquanto você arrasta. O Motion rejeita auto-parentesco, alvos descendentes e vínculos que criariam um ciclo.',
        },
      ],
    },
    {
      title: 'Vincular propriedades ou escrever uma expressão',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O parentesco cria uma hierarquia de camadas. Um **Vínculo de propriedade** faz uma propriedade acompanhar outra sem alterar essa hierarquia.',
        },
        {
          kind: 'list',
          items: [
            'Arraste o pick whip de uma propriedade até uma linha compatível no Motion, na dope sheet ou no gráfico.',
            'Vincule valores escalares a valores escalares. Posição, Escala e Âncora são vinculadas como valores bidimensionais completos.',
            'Selecione o botão de chaves para adicionar uma expressão em sandbox sem apagar os quadros-chave da propriedade.',
            'Use o pick whip da expressão para inserir uma referência `prop("layer-id", "property")` no cursor do texto.',
            'Use `value`, `preValue`, `frame`, `time`, valores escalares ou `[x, y]`, aritmética e as funções matemáticas compatíveis.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'O DroneClean Studio avalia primeiro os quadros-chave, depois o Vínculo de propriedade e por último a expressão. A prévia e a exportação usam a mesma ordem.',
        },
      ],
    },
    {
      title: 'Expor controles para composições reutilizadas',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abra **Controles publicados** dentro da composição de origem.',
            'Publique o texto ou as cores que um editor deve poder mudar nas instâncias colocadas.',
            'Coloque a composição em uma sequência comum e selecione essa instância.',
            'Edite os valores publicados dela em Propriedades sem alterar a composição de origem.',
            'Redefina uma substituição ou use **Redefinir todas as substituições** para restaurar os valores da origem.',
          ],
        },
      ],
    },
    {
      title: 'Usar a composição na Edição',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Uma composição Motion continua sendo um recurso de composição reutilizável. Coloque-a em uma sequência e depois mova, apare, anime ou aplique efeitos à instância como a qualquer outro clipe.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'A animação interna das camadas e a animação do clipe inteiro continuam independentes. Um título pode ser animado por dentro enquanto a instância colocada se move ou aparece gradualmente na Edição.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
