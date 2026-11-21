import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Animar com quadros-chave',
  description:
    'Anime valores de transformação, corte, texto, efeitos e áudio com quadros-chave, suavização e o editor de curvas.',
  category: 'Creative Tools',
  related: ['motion', 'motion-library', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Escolher onde editar quadros-chave',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A Edição mantém o trabalho com quadros-chave compacto. O Motion expõe a dope sheet completa das camadas e o gráfico, para um trabalho mais profundo de tempo e curvas.',
        },
        {
          kind: 'table',
          headers: ['Área', 'Fluxo de quadros-chave'],
          rows: [
            [
              'Edição',
              'Selecione um clipe e pressione `K` para adicionar um quadro-chave à propriedade ativa. Abra **Animação** em Propriedades para ver predefinições e o estado aplicado.',
            ],
            [
              'Motion',
              'Expanda uma camada para ver as linhas de propriedades, os losangos dos quadros-chave, a suavização dos segmentos e um gráfico de valores embutido.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'No Motion, o cursor de reprodução compartilhado, a seleção, o snap, a régua, as faixas de propriedades e o gráfico usam o mesmo eixo de tempo.',
        },
      ],
    },
    {
      title: 'Adicionar um quadro-chave',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Leve o cursor de reprodução até o quadro em que você quer criar o quadro-chave.',
            'Digite um valor ao lado de um parâmetro e pressione `Enter`, ou clique no **losango** da linha do parâmetro.',
            'Vá até outro quadro e defina um segundo valor para criar movimento entre eles.',
            'Ative a **gravação automática** com o ícone de cronômetro, ou pressione `A`, para capturar automaticamente as mudanças de valor seguintes.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Não é possível adicionar um quadro-chave dentro de uma região de transição, nem com o cursor de reprodução fora dos limites do clipe — o losango fica desativado ali.',
        },
      ],
    },
    {
      title: 'O que você pode animar',
      blocks: [
        {
          kind: 'table',
          headers: ['Tipo de clipe', 'Valores animáveis'],
          rows: [
            [
              'Todos os clipes visuais',
              'Posição X / Y, largura, altura, rotação, opacidade, raio dos cantos',
            ],
            [
              'Vídeo',
              'Acrescenta ponto de âncora, as quatro bordas de corte, suavidade do corte e volume',
            ],
            [
              'Texto',
              'Acrescenta escala da predefinição, tamanho da fonte, altura da linha, preenchimento, raio do fundo, sombra e contorno',
            ],
            ['Áudio', 'Volume em decibéis'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Os efeitos também trazem seus próprios parâmetros animáveis — procure o botão de quadro-chave ao lado de cada controle deslizante.',
        },
      ],
    },
    {
      title: 'Dar forma ao movimento',
      blocks: [
        {
          kind: 'list',
          items: [
            'Clique no **conector** entre dois quadros-chave para abrir o **editor de suavização**.',
            'Navegue pelas curvas predefinidas em **Cúbica** e **Mola**. Filtre por **Tudo**, **Entrada**, **Saída** ou **Entrada/Saída**.',
            'Escolha **Manter** para conservar o valor anterior até o próximo quadro-chave.',
            'Mude para **Editar** para modelar a curva diretamente: arraste as duas alças de controle no gráfico ou digite valores exatos. As molas expõem **Tensão**, **Fricção** e **Massa** e mostram na prévia o quique real.',
            'Sinta o tempo em **Posição**, **Escala**, **Rotação** ou **Opacidade** na prévia ao vivo e use **Pausar** para parar o loop.',
            'Salve uma curva ajustada como uma **predefinição personalizada** com **Salvar como**, **Atualizar** depois, ou **Redefinir** para a predefinição de origem. As predefinições personalizadas ficam armazenadas no seu dispositivo e aparecem em todos os projetos.',
            'Copie, recorte, cole e exclua quadros-chave, selecione grupos com a seleção em área, arraste para alterar o tempo e arraste com `Alt` para duplicar.',
          ],
        },
      ],
    },
    {
      title: 'Trabalhar no gráfico de valores',
      blocks: [
        {
          kind: 'list',
          items: [
            'Escolha uma propriedade na lista suspensa para editar sua curva, ou deixe em todas para ver as outras como curvas esmaecidas sobrepostas. O número de quadros-chave da propriedade ativa aparece ao lado.',
            'O gráfico desenha uma **grade** rotulada — quadros ou segundos na horizontal, valores na vertical — para você ler as posições num relance.',
            'Enquadre a curva com **Ajustar ao conteúdo**, ou mova a visualização com **Aproximar** / **Afastar** e a roda do mouse. **Redefinir visualização** volta ao ajuste padrão.',
            'Percorra os quadros-chave com as setas de **anterior** / **próximo** e depois digite um quadro exato (**F**) e um valor (**V**) para o quadro-chave selecionado.',
            'Ao arrastar um quadro-chave, segure **Shift** para travá-lo em um eixo, ou **Alt** para um ajuste fino.',
          ],
        },
      ],
    },
    {
      title: 'Converter e limpar o movimento gerado',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Comportamentos ao vivo, como deriva, respiração, tremor e giro, são avaliados durante a reprodução sem criar quadros-chave de propriedade.',
        },
        {
          kind: 'list',
          items: [
            'Escolha **Consolidar em quadros-chave** para converter comportamentos ao vivo de camada em quadros-chave editáveis.',
            'Use **Aplicado** para ir até quadros-chave manuais ou ao primeiro quadro de uma predefinição gerada.',
            'Use **Aparar animação** quando um corte de clipe deixar quadros-chave armazenados fora da duração visível dele.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Leia [Aplicar e reutilizar movimento](motion-library) para ver predefinições, comportamentos ao vivo, movimento de texto, consolidação e animações salvas.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
