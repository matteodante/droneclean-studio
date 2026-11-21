import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.5,
  slug: 'motion-library',
  title: 'Aplicar e reutilizar movimento',
  description:
    'Aplique predefinições editáveis, adicione comportamentos ao vivo, ajuste o movimento de texto e salve animações para reutilizar.',
  category: 'Creative Tools',
  related: ['motion', 'keyframes', 'properties', 'text-captions-subtitles'],
  sections: [
    {
      title: 'Escolher a área de animação certa',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O DroneClean Studio usa um único sistema de animação em dois lugares. Use a aba compacta **Animação** ao editar um clipe de sequência, ou abra o **Motion** para o trabalho de composição em camadas.',
        },
        {
          kind: 'table',
          headers: ['Área', 'Use para'],
          rows: [
            [
              'Edição > Animação',
              'Predefinições comuns, estado das animações aplicadas, movimento de texto e criar ou reabrir um clipe Motion',
            ],
            [
              'Motion > Biblioteca de movimento',
              'O catálogo completo de predefinições, comportamentos ao vivo, animações salvas e controles da camada selecionada',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Selecione um ou mais clipes da Edição e escolha **Criar clipe Motion** para preservá-los dentro de uma composição em camadas. Selecione um clipe Motion existente e escolha **Abrir no Motion** para editar suas camadas.',
        },
      ],
    },
    {
      title: 'Aplicar uma predefinição editável',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Selecione um ou mais clipes ou camadas do Motion.',
            'Escolha uma predefinição em **Entrada**, **Saída** ou **Ênfase**.',
            'Defina **Ao aplicar** como **Substituir** para trocar o movimento por outro de mesma intenção, ou **Adicionar** para manter os quadros-chave existentes.',
            'Abra as linhas de propriedades ou o gráfico de valores para ajustar os quadros-chave gerados.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'A seção **Aplicado** lista separadamente os quadros-chave manuais e cada aplicação de predefinição. Selecione uma entrada para levar o cursor de reprodução até o primeiro quadro-chave dela.',
        },
      ],
    },
    {
      title: 'Adicionar um comportamento ao vivo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Os comportamentos ao vivo são avaliados durante a reprodução sem criar quadros-chave. Deixe-os ao vivo para um movimento ajustável, ou consolide-os quando precisar de controle no nível do quadro.',
        },
        {
          kind: 'table',
          headers: ['Comportamento', 'Resultado'],
          rows: [
            ['Float drift', 'Desloca posição e rotação'],
            ['Sway', 'Gira para um lado e para o outro'],
            ['Breath pulse', 'Muda tamanho e opacidade'],
            ['Spin', 'Gira continuamente'],
            ['Micro shake', 'Adiciona tremor de posição e rotação com semente fixa'],
          ],
        },
        {
          kind: 'list',
          items: [
            'Selecione o bloco de um comportamento para aplicá-lo com as configurações padrão.',
            'Ajuste **Intensidade** e **Duração** pelos controles aplicados dele.',
            'Leia a faixa hachurada na linha do tempo do Motion para ver onde o movimento procedural atua.',
            'Aplique um comportamento a vários clipes para defasar as fases deles, em vez de mover todos os clipes em uníssono.',
          ],
        },
      ],
    },
    {
      title: 'Ajustar o movimento de texto na linha do tempo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O movimento de texto anima caracteres, palavras, linhas ou o clipe inteiro por meio de slots ao vivo de **Entrada**, **Saída** e **Loop**.',
        },
        {
          kind: 'list',
          items: [
            'Selecione um clipe de texto e escolha uma predefinição para cada slot na aba **Animação** ou na Biblioteca de movimento.',
            'Arraste a borda de uma faixa de movimento de texto no Motion para mudar sua duração.',
            'Arraste uma faixa de **Entrada** ou **Saída** para longe da borda do clipe para deslocar seu início ou fim.',
            'Selecione a entrada dela em **Aplicado** para levar o cursor de reprodução até a faixa.',
          ],
        },
      ],
    },
    {
      title: 'Revisar e limpar a animação aplicada',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Aplicado** para distinguir quadros-chave manuais, quadros-chave gerados, comportamentos ao vivo e movimento de texto.',
            'Remova uma aplicação de predefinição sem apagar quadros-chave não relacionados.',
            'Remova um comportamento ao vivo ou um slot de movimento de texto pela linha dele.',
            'Quando um corte deixar quadros-chave fora do clipe, use **Aparar animação** para apagar só esses quadros-chave estacionados.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '**Aparar animação** altera a animação armazenada. Use a ação do aviso ou Desfazer se precisar dos quadros-chave removidos de volta.',
        },
      ],
    },
    {
      title: 'Consolidar, salvar e reutilizar movimento',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Escolha **Consolidar em quadros-chave** para amostrar os comportamentos ao vivo da camada em quadros-chave de propriedade editáveis.',
            'Selecione um clipe com a animação que você quer guardar.',
            'Escolha **Salvar animação**, digite um nome e salve na biblioteca do projeto.',
            'Aplique a animação salva a outro clipe ou camada compatível.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'As animações salvas podem incluir quadros-chave editáveis, comportamentos ao vivo de camada, movimento de texto ou uma combinação deles. Os projetos exportados levam consigo a sua biblioteca de animações salvas.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
