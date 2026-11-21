import type { DocPageContent } from '../../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Atalhos de teclado',
  description: 'Os atalhos padrão por grupo, e como pesquisá-los, reatribuí-los e redefini-los.',
  category: 'Reference',
  sections: [
    {
      title: 'Reprodução',
      blocks: [
        {
          kind: 'table',
          headers: ['Ação', 'Atalho'],
          rows: [
            ['Reproduzir / Pausar', '`Space`'],
            ['Quadro anterior / seguinte', '`Left` / `Right`'],
            ['Ponto de snap anterior / seguinte', '`Up` / `Down`'],
            ['Ir ao início / ao fim', '`Home` / `End`'],
          ],
        },
      ],
    },
    {
      title: 'Edição',
      blocks: [
        {
          kind: 'table',
          headers: ['Ação', 'Atalho'],
          rows: [
            ['Dividir no cursor de reprodução', '`Alt+C`'],
            ['Dividir no cursor do mouse', '`Shift+C`'],
            ['Unir', '`Shift+J`'],
            ['Excluir / Exclusão ripple', '`Delete` / `Ctrl+Delete`'],
            ['Inserir quadro congelado', '`Shift+F`'],
            ['Vincular / Desvincular clipes', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['Alternar seleção vinculada', '`Shift+L`'],
            ['Deslocar 1 px / 10 px', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: 'Ferramentas',
      blocks: [
        {
          kind: 'table',
          headers: ['Ferramenta', 'Atalho'],
          rows: [
            ['Seleção', '`V`'],
            ['Aparar', '`T`'],
            ['Navalha', '`C`'],
            ['Esticar velocidade', '`R`'],
            ['Deslizamento (slip)', '`Y`'],
            ['Deslocamento (slide)', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple e rolling são comportamentos de aparar da ferramenta **Aparar**, não ferramentas separadas com atalho próprio.',
        },
      ],
    },
    {
      title: 'Histórico, visualização e área de transferência',
      blocks: [
        {
          kind: 'table',
          headers: ['Ação', 'Atalho'],
          rows: [
            ['Desfazer / Refazer', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['Copiar / Recortar / Colar', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['Alternar snap / snap da tela', '`S` / `Shift+S`'],
            ['Aproximar / afastar o zoom', '`Ctrl+=` / `Ctrl+-`'],
            ['Ajustar à tela / 100%', '`\\` / `Shift+\\`'],
            ['Espaço de trabalho Edição / Cor / Motion', '`Alt+1` / `Alt+2` / `Alt+3`'],
          ],
        },
      ],
    },
    {
      title: 'Marcadores e quadros-chave',
      blocks: [
        {
          kind: 'table',
          headers: ['Ação', 'Atalho'],
          rows: [
            ['Adicionar / Remover marcador', '`M` / `Shift+M`'],
            ['Marcador anterior / seguinte', '`[` / `]`'],
            ['Limpar quadros-chave', '`Shift+A`'],
            ['Adicionar quadro-chave à camada selecionada da Edição', '`K`'],
            ['Gráfico / planilha / visualização dividida de quadros-chave', '`1` / `2` / `3`'],
            ['Quadro-chave anterior / seguinte da propriedade', '`Alt+[` / `Alt+]`'],
            ['Alternar a gravação automática da propriedade ativa', '`A`'],
            ['Ajustar os quadros-chave selecionados', '`F`'],
          ],
        },
      ],
    },
    {
      title: 'Monitor de origem e projeto',
      blocks: [
        {
          kind: 'table',
          headers: ['Ação', 'Atalho'],
          rows: [
            ['Marcar entrada / saída', '`I` / `O`'],
            ['Limpar entrada/saída', '`Alt+X`'],
            ['Renderizar prévia (da entrada à saída, ou a linha do tempo inteira)', '`Enter`'],
            ['Edição de inserção / sobrescrita', '`,` / `.`'],
            ['Salvar', '`Ctrl+S`'],
            ['Exportar', '`Ctrl+Shift+E`'],
            ['Abrir o Navegador de cenas', '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: 'Personalizar atalhos',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Todas as atribuições acima são padrões de fábrica. Abra o editor de atalhos redesenhado pelo botão **Atalhos de teclado** (ícone de teclado) na barra de ferramentas do editor para remapear qualquer comando para as teclas que você preferir.',
        },
        {
          kind: 'steps',
          items: [
            'Pesquise comandos pelo nome, ou filtre pelos grupos **Personalizado**, **Conflitos** ou **Não atribuído**.',
            'Escolha um comando e pressione **Gravar**; depois mantenha os modificadores pressionados e aperte a tecla final.',
            'Se a combinação já estiver em uso, o editor sinaliza o conflito — escolha **Sobrescrever** para reatribuí-la, ou escolha outras teclas.',
            'Use **Desvincular** para limpar uma atribuição, ou adicione uma atribuição alternativa ao lado da principal.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Use **Redefinir** para restaurar um único comando, ou **Redefinir tudo** para devolver todos os atalhos ao padrão. Você também pode **Exportar** suas atribuições para um arquivo de predefinição e **Importar** em outra máquina.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
