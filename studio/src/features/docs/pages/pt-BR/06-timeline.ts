import type { DocPageContent } from '../../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Edição básica na linha do tempo',
  description:
    'Faixas, adição de clipes, seleção, dividir e unir, exclusão, snap, marcadores, intervalos, sequências e zoom.',
  category: 'Core Editing',
  related: ['editing-tools', 'preview', 'media', 'export', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Faixas',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Faixas de vídeo** contêm itens visuais: vídeo, imagens, texto, formas, legendas e camadas de ajuste.',
            '**Faixas de áudio** contêm clipes de áudio e o áudio vinculado aos arquivos de vídeo.',
            'Adicione faixas com **Adicionar faixa de vídeo** ou **Adicionar faixa de áudio** quando precisar de mais espaço.',
            'Os controles de faixa incluem **Bloquear**, **Solo**, **Ativar/Desativar** (visibilidade) e o bloqueio de sincronia.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Os grupos de faixas têm um único nível de profundidade e funcionam como cabeçalhos — silenciar, visibilidade e bloqueio passam do grupo para as suas faixas.',
        },
      ],
    },
    {
      title: 'Adicionar e organizar clipes',
      blocks: [
        {
          kind: 'list',
          items: [
            'Arraste um clipe do painel Mídia para uma faixa de vídeo ou de áudio.',
            'Use a ferramenta **Seleção** (`V`) para mover e reorganizar clipes.',
            'A **seleção vinculada** mantém um clipe de vídeo e seu áudio se movendo juntos; desvincule-os para editar só um deles.',
            'Desloque um item selecionado com `Shift+Arrow` (1 px) ou `Ctrl+Shift+Arrow` (10 px).',
          ],
        },
      ],
    },
    {
      title: 'Dividir, unir e excluir',
      blocks: [
        {
          kind: 'list',
          items: [
            'Divida no cursor de reprodução com `Alt+C`, ou use a ferramenta **Navalha** (`C`) para cortar onde você clicar.',
            'Una trechos adjacentes do mesmo clipe com `Shift+J`.',
            '**Excluir** deixa um vazio; **Exclusão ripple** (`Ctrl+Delete`) remove o clipe e fecha o vazio.',
            'Use **Fechar todos os espaços** para aproximar os clipes e remover o espaço vazio de uma faixa.',
          ],
        },
      ],
    },
    {
      title: 'Snap, marcadores e intervalos',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ative ou desative o snap com `S` para que os clipes se encaixem nos cortes próximos, nos marcadores e no cursor de reprodução.',
            'Adicione um marcador com `M` para anotações e referências de tempo; pule entre marcadores com `[` e `]`.',
            'Defina um ponto de entrada (`I`) e um ponto de saída (`O`) para delimitar um intervalo de prévia e exportação; limpe-os com `Alt+X`.',
          ],
        },
      ],
    },
    {
      title: 'Sequências (várias linhas do tempo)',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Uma **sequência** é uma linha do tempo independente, com suas próprias faixas, clipes, marcadores e intervalo de entrada/saída. A barra de abas acima da linha do tempo lista a linha do tempo **Principal** e todas as sequências — clique em uma aba para trocar a que você está editando.',
        },
        {
          kind: 'list',
          items: [
            'Crie uma sequência com o botão **+** no fim da barra de abas; ela abre em uma aba própria.',
            'Troque de sequência clicando em uma aba; a aba **Principal** é sempre a primeira.',
            'Clique duas vezes em uma aba para **renomeá-la**, ou use o menu de opções da aba (⋮) para **Renomear**, **Fechar aba** e **Excluir sequência**.',
            '**Fechar aba** só remove a aba — a sequência continua disponível no painel Mídia e em todos os clipes que fazem referência a ela. **Excluir sequência** a remove por completo (dá para desfazer), junto com todos os clipes que fazem referência a ela.',
            'Um **clipe composto** pode ser aberto como aba de sequência — no painel Mídia, clique com o botão direito em um clipe composto e escolha **Abrir como aba** para editá-lo como uma linha do tempo independente.',
            'Solte uma sequência na linha do tempo para aninhá-la como um clipe (rotulado **Sequência**); clique duas vezes nesse clipe para ir até a aba dele.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Cada sequência mantém seus próprios marcadores, intervalo de entrada/saída, visualização e histórico de desfazer — trocar de aba nunca mistura essas informações.',
        },
      ],
    },
    {
      title: 'Zoom e desfazer',
      blocks: [
        {
          kind: 'list',
          items: [
            'Dê zoom com `Ctrl+=` e `Ctrl+-`, ajuste a edição inteira à tela com `\\` e volte a 100% com `Shift+\\`.',
            'O zoom altera apenas a visualização, nunca o tempo dos clipes.',
            'Desfaça com `Ctrl+Z` e refaça com `Ctrl+Shift+Z`; a profundidade do histórico de desfazer é configurável em Configurações.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
