import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1.5,
  slug: 'concepts',
  title: 'Como o DroneClean Studio funciona',
  description:
    'O modelo mental: armazenamento local-first, projetos e mídias vinculadas, quadros e código de tempo, e o pipeline de GPU.',
  category: 'Start',
  related: ['workspaces', 'getting-started', 'editing-tools'],
  sections: [
    {
      title: 'Local-first, por projeto',
      blocks: [
        {
          kind: 'list',
          items: [
            'O DroneClean Studio roda no seu navegador e guarda tudo em uma **pasta de área de trabalho** no seu disco.',
            'Seus vídeos e áudios originais são **vinculados**, não copiados nem enviados — o DroneClean Studio aponta para os arquivos onde eles já estão.',
            'Projetos, caches, recursos gerados e exportações são gravados na área de trabalho, então você pode fazer backup dela ou movê-la como qualquer pasta.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Como as mídias são vinculadas, mover ou renomear um arquivo de origem aparece como **Mídia ausente** até você revinculá-lo. Veja [Áreas de trabalho e armazenamento](workspaces).',
        },
      ],
    },
    {
      title: 'Projetos, faixas e clipes',
      blocks: [
        {
          kind: 'list',
          items: [
            'Um **projeto** guarda uma linha do tempo, suas configurações (resolução e taxa de quadros) e referências às mídias que você usa.',
            'A linha do tempo empilha **faixas**; as faixas de cima são renderizadas sobre as de baixo.',
            'Um **clipe** na linha do tempo é uma janela para um arquivo de origem — aparar um clipe muda qual parte da origem é reproduzida, não altera o arquivo.',
            'Uma **camada de ajuste** é um clipe que não carrega mídia própria — ela aplica seus efeitos e sua cor a todos os clipes abaixo dela.',
          ],
        },
      ],
    },
    {
      title: 'Sequências e clipes compostos',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O DroneClean Studio tem uma única primitiva para **uma linha do tempo dentro do seu projeto** — uma composição. Ela aparece de duas formas, dependendo de como você a usa.',
        },
        {
          kind: 'list',
          items: [
            'Uma **composição Motion** abre no **Motion**, onde o editor compartilhado mantém suas mídias, a prévia e as propriedades no lugar enquanto o dock inferior vira uma linha do tempo de camadas.',
            'Uma **sequência** é uma linha do tempo independente no mesmo projeto, aberta por uma aba da barra de abas. Cada sequência tem suas próprias faixas, clipes e histórico de edição — a linha do tempo principal é, ela mesma, uma sequência.',
            'Um **clipe composto** pega um trecho da linha do tempo e o dobra em um único item de mídia reutilizável. Na linha do tempo ele se comporta como um clipe só — mover, aparar, adicionar efeitos — enquanto o conteúdo dele vive em uma linha do tempo própria.',
            'Os dois são a mesma coisa vista de modos diferentes: abra um clipe composto para editar seu conteúdo como uma sequência, e qualquer sequência pode ser solta em outra linha do tempo como um clipe composto.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Uma composição pode conter outras composições, mas nunca a si mesma — o DroneClean Studio bloqueia referências circulares, então um clipe composto nunca pode acabar aninhado dentro do próprio conteúdo.',
        },
      ],
    },
    {
      title: 'Quadros e código de tempo',
      blocks: [
        {
          kind: 'list',
          items: [
            'O tempo é medido em **quadros**. Um clipe tem um quadro inicial e uma duração em quadros, na taxa de quadros do projeto.',
            'A prévia mostra o **código de tempo**; em algumas visualizações, clique na leitura para alternar para números de quadro.',
            'A mídia de origem pode ter uma taxa de quadros diferente da do projeto, então o DroneClean Studio converte quadros de origem em quadros do projeto quando você edita.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Defina a resolução e a taxa de quadros do projeto de acordo com o destino da entrega ao criar o projeto.',
        },
      ],
    },
    {
      title: 'Tudo é renderizado na sua máquina',
      blocks: [
        {
          kind: 'list',
          items: [
            'A reprodução, os efeitos, a cor e as ferramentas de IA rodam localmente, usando sua GPU (WebGPU) e sua CPU (WebCodecs).',
            'Os **proxies** são cópias mais leves de mídias pesadas que deixam a edição fluida; a exportação final sempre usa os originais.',
            'Como não há renderização na nuvem, manter a aba aberta durante a exportação importa — a renderização acontece dentro do próprio navegador.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
