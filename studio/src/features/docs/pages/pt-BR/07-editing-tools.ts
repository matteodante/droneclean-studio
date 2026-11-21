import type { DocPageContent } from '../../docs-content'

const page = {
  order: 7,
  slug: 'editing-tools',
  title: 'Ferramentas de edição',
  description:
    'Seleção, navalha, aparar, slip, slide, esticar velocidade e os comportamentos de aparar em ripple e rolling.',
  category: 'Core Editing',
  related: ['timeline', 'keyboard-shortcuts', 'properties'],
  sections: [
    {
      title: 'As ferramentas principais',
      blocks: [
        {
          kind: 'table',
          headers: ['Ferramenta', 'Tecla', 'Uso'],
          rows: [
            ['Seleção', '`V`', 'Selecionar, mover e organizar clipes.'],
            [
              'Aparar',
              '`T`',
              'Arrastar a borda de um clipe para mudar onde ele começa ou termina.',
            ],
            ['Navalha', '`C`', 'Cortar um clipe onde você clicar.'],
            ['Esticar velocidade', '`R`', 'Mudar a duração alterando a velocidade de reprodução.'],
            [
              'Deslizamento (slip)',
              '`Y`',
              'Mudar os quadros de origem dentro de um clipe sem movê-lo.',
            ],
            ['Deslocamento (slide)', '`U`', 'Mover um clipe ajustando os cortes vizinhos.'],
          ],
        },
      ],
    },
    {
      title: 'Comportamentos de aparar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Um corte **ripple** altera uma edição e desloca todo o material posterior, de modo que a duração total muda.',
            'Um corte **rolling** move o corte entre dois clipes vizinhos, sem alterar a duração total.',
            'Uma edição **slip** muda quais quadros de origem aparecem dentro de um clipe sem mover o clipe nem seus vizinhos.',
            'Uma edição **slide** move um clipe ao longo da faixa ajustando automaticamente os cortes vizinhos.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple e rolling são comportamentos da ferramenta **Aparar**, não ferramentas separadas com atalho próprio.',
        },
      ],
    },
    {
      title: 'Manter os clipes sincronizados',
      blocks: [
        {
          kind: 'list',
          items: [
            'A **seleção vinculada** move um clipe de vídeo e seu áudio juntos; alterne-a com `Shift+L`.',
            'Vincule clipes com `Ctrl+Alt+L` e desvincule-os com `Alt+Shift+L` quando a relação precisar mudar.',
            'O **bloqueio de sincronia** em uma faixa mantém o tempo alinhado durante edições do tipo ripple.',
          ],
        },
      ],
    },
    {
      title: 'Edições estruturais',
      blocks: [
        {
          kind: 'list',
          items: [
            'Insira um **quadro congelado** no cursor de reprodução com `Shift+F` para manter um único quadro.',
            'Agrupe uma sequência de clipes em um **clipe composto** para reutilizar ou simplificar um trecho cheio, ou abra-o como uma aba de **sequência** para editá-lo como uma linha do tempo independente.',
            'Use a caixa de diálogo **Layout bento** para organizar clipes visuais selecionados em uma grade estruturada.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
