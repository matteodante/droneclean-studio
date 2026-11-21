import type { DocPageContent } from '../../docs-content'

const page = {
  order: 11.5,
  slug: 'shapes-masks',
  title: 'Formas e máscaras',
  description:
    'Adicione itens de forma, desenhe caminhos personalizados com a ferramenta caneta e use qualquer forma como máscara de clipe.',
  category: 'Creative Tools',
  related: ['motion', 'properties', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Adicionar uma forma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abra a aba **Formas** e clique em uma forma para adicioná-la no cursor de reprodução, ou arraste-a para uma faixa específica.',
            'Formas integradas: **Retângulo**, **Círculo**, **Elipse**, **Triângulo**, **Estrela**, **Polígono** e **Coração**.',
            'Uma forma nova chega com o tamanho da tela e já selecionada, pronta para posicionar e estilizar.',
          ],
        },
      ],
    },
    {
      title: 'Estilizar uma forma',
      blocks: [
        {
          kind: 'table',
          headers: ['Controle', 'Observações'],
          rows: [
            ['Tipo', 'Alterna entre os sete tipos de forma.'],
            ['Preenchimento', 'Um preenchimento de cor sólida ou gradiente.'],
            [
              'Esp. do traço / Traço',
              'Largura do contorno (0–50 px) e sua cor (exibida quando a largura é maior que 0).',
            ],
            [
              'Extremidade / Junção',
              'As pontas do traço e o modo como os segmentos conectados do traço se encontram.',
            ],
            [
              'Aparar caminhos',
              'Controles de Início, Fim e Deslocamento para desenhar só parte de um caminho.',
            ],
            ['Afunilamento', 'Larguras inicial e final de um traço afunilado.'],
            [
              'Raio',
              'Arredondamento dos cantos (0–100 px) para retângulo, triângulo, estrela e polígono.',
            ],
            ['Pontas / Raio int.', 'Número de pontas e raio interno, para estrela e polígono.'],
            ['Direção', 'Para que lado um triângulo aponta.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Posição, tamanho, rotação e opacidade ficam nos controles de Transformação, e a maioria dos valores aceita quadros-chave — veja [Animar com quadros-chave](keyframes).',
        },
      ],
    },
    {
      title: 'Animar vértices de caminho no Motion',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abra a forma no **Motion** e expanda suas linhas de propriedades.',
            'Selecione pontos do caminho na prévia.',
            'Escolha **Vértices selecionados** para criar quadros-chave só nesses pontos, ou **Todos os vértices** para expor todos os pontos.',
            'Adicione quadros-chave às coordenadas dos vértices e mova o cursor de reprodução antes de remodelar o caminho.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Os quadros-chave de Geometria do caminho travam a topologia do caminho. Remova-os antes de adicionar, remover, reordenar ou mudar o primeiro vértice.',
        },
      ],
    },
    {
      title: 'Desenhar um caminho personalizado com a ferramenta caneta',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Na aba Formas, escolha a ferramenta **Caneta** para desenhar uma forma de caminho personalizado.',
            'Clique na prévia para colocar pontos; clique e arraste um ponto para puxar alças curvas (bézier).',
            'Backspace remove o último ponto, e Escape cancela.',
            'Com pelo menos três pontos, escolha **Concluir forma** para confirmá-la (ou **Cancelar**).',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Para remodelar um caminho depois, selecione-o e use **Editar caminho**: arraste pontos e alças, clique duas vezes em uma aresta para adicionar um ponto e converta um ponto entre **Canto** e **Bézier**. Escolha **Concluído** ao terminar.',
        },
      ],
    },
    {
      title: 'Usar uma forma como máscara',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Coloque a forma em uma faixa **acima** do clipe que você quer mascarar.',
            'Na seção Forma, ative **Usar como máscara**.',
            'Escolha um **Tipo de máscara**: **Recorte** para bordas duras, ou **Alfa** para bordas suaves.',
            'Em uma máscara Alfa, ajuste **Difusão** para suavizar a borda; use **Inverter** para ocultar a área da forma em vez de revelá-la.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Uma máscara afeta tudo o que está nas faixas abaixo dela, conforme a geometria da forma. A difusão vale apenas para máscaras Alfa — as máscaras de Recorte continuam com bordas duras.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Enquanto você edita uma máscara ou desenha com a caneta, o resto do editor fica bloqueado — conclua ou saia da edição da máscara para continuar.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
