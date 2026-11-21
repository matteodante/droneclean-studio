import type { DocPageContent } from '../../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Projetos',
  description: 'Crie, configure, duplique, organize, exclua, restaure e mova projetos.',
  category: 'Start',
  related: ['workspaces', 'editor'],
  sections: [
    {
      title: 'Criar e configurar um projeto',
      blocks: [
        {
          kind: 'list',
          items: [
            'Crie um projeto na página Projetos com **Novo projeto**.',
            'Defina o nome, a descrição, a resolução, a taxa de quadros e a cor de fundo do projeto.',
            'A resolução e a taxa de quadros definem a tela de exportação e o tempo da linha do tempo, então escolha-as de acordo com a entrega que você pretende fazer.',
            'Você pode rever as especificações do projeto depois, na barra de ferramentas do editor.',
          ],
        },
      ],
    },
    {
      title: 'Tamanho da tela e proporção',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A tela define o quadro em que seu vídeo é composto e exportado. Escolha um tamanho ao criar o projeto ou altere-o a qualquer momento no painel **Tela** durante a edição.',
        },
        {
          kind: 'paragraph',
          text: 'Em **Novo projeto**, a seção **Resolução** oferece predefinições prontas para as plataformas mais comuns. Cada cartão de predefinição mostra seu tamanho em pixels e sua proporção. Escolha **Personalizado** para digitar uma largura e uma altura exatas.',
        },
        {
          kind: 'table',
          headers: ['Predefinição', 'Resolução', 'Proporção'],
          rows: [
            ['YouTube 1080p', '`1920x1080`', '`16:9` horizontal'],
            ['Shorts / TikTok / Reels', '`1080x1920`', '`9:16` vertical'],
            ['Instagram quadrado', '`1080x1080`', '`1:1` quadrado'],
            ['Instagram retrato', '`1080x1350`', '`4:5` retrato'],
            ['Twitter/X', '`1200x675`', '`16:9` horizontal'],
            ['LinkedIn', '`1200x627`', 'horizontal'],
            ['Personalizado', 'Seus próprios valores', 'O que você digitar'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Para mudar o tamanho depois que o projeto já existe:',
        },
        {
          kind: 'steps',
          items: [
            'Desmarque qualquer clipe para que a barra lateral de propriedades mostre o painel **Tela**.',
            'Edite os campos **W** e **H** para definir a largura e a altura do quadro em pixels.',
            'Use **Trocar** para inverter largura e altura, por exemplo para transformar um projeto horizontal em vertical.',
            'Use **Redefinir** para devolver a tela a `1920x1080`.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'As dimensões são ajustadas para números pares e vão de `320x240` até `7680x4320`. Os clipes existentes mantêm a posição e a escala atuais quando a tela muda; por isso, reposicione tudo o que agora ficar fora do novo quadro.',
        },
      ],
    },
    {
      title: 'Organizar a lista de projetos',
      blocks: [
        {
          kind: 'list',
          items: [
            'Pesquise projetos pelo nome e ordene ou filtre a lista conforme ela crescer.',
            'Use as miniaturas e os metadados para identificar o projeto em que você trabalhou por último.',
            'A área de trabalho ativa aparece na página Projetos, para você sempre saber onde os projetos estão armazenados.',
            'Use **Duplicar** para criar uma variação sem mexer no original.',
          ],
        },
      ],
    },
    {
      title: 'Lixeira e restauração',
      blocks: [
        {
          kind: 'list',
          items: [
            'Excluir um projeto o move para a **Lixeira** em vez de removê-lo na hora.',
            'Restaure um projeto pela seção Lixeira enquanto ele ainda estiver lá.',
            '**Esvaziar lixeira** exclui permanentemente os projetos que estão na lixeira e as mídias que só eles referenciam.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'A exclusão permanente não pode ser desfeita; por isso, confirme o nome antes de esvaziar a lixeira.',
        },
      ],
    },
    {
      title: 'Mover trabalhos entre áreas de trabalho',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Exportar projeto** para criar um pacote que reúne o projeto e suas mídias.',
            'Importe um pacote em outra área de trabalho para continuar a mesma edição em outra máquina ou pasta.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Os pacotes são a forma segura de passar um projeto para outra pessoa, porque levam junto as mídias vinculadas e a linha do tempo.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
