import type { DocPageContent } from '../../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: 'Fila de renderização',
  description:
    'Enfileire várias exportações, divida uma renderização em segmentos, gerencie a fila e encontre os arquivos salvos.',
  category: 'Output',
  related: ['export'],
  sections: [
    {
      title: 'Enfileirar exportações',
      blocks: [
        {
          kind: 'list',
          items: [
            'Na caixa de diálogo Exportar, escolha **Adicionar à fila** em vez de renderizar na hora.',
            'Enfileire o projeto inteiro ou o intervalo atual.',
            'Abra a fila a qualquer momento pelo botão **Fila de renderização** na barra de ferramentas, que mostra a contagem de tarefas em tempo real.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'As exportações enfileiradas são renderizadas uma de cada vez e salvas na pasta de exportações da sua área de trabalho.',
        },
      ],
    },
    {
      title: 'Dividir em segmentos',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Dividir em segmentos** transforma uma renderização em várias tarefas.',
            'Use **Um segmento por marcador** para quebrar a renderização nos marcadores da linha do tempo.',
            'Ou divida em blocos fixos de um número definido de segundos.',
          ],
        },
      ],
    },
    {
      title: 'Gerenciar a fila',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Pausar** e **Retomar** a fila para controlar quando a renderização acontece.',
            'Mova uma tarefa enfileirada para **Cima** ou para **Baixo** para mudar a ordem dela.',
            '**Cancelar** uma tarefa em andamento ou enfileirada, **Tentar novamente** uma que falhou e **Remover** as tarefas concluídas.',
            'O estado da tarefa aparece como Na fila, Renderizando, Concluído, Falhou ou Cancelado; use **Limpar concluídas** ou **Limpar tudo** para arrumar a lista.',
          ],
        },
      ],
    },
    {
      title: 'Exportações salvas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Mude para a aba **Exportações salvas** para ver os arquivos concluídos.',
            'Baixe ou exclua uma exportação salva a partir dali.',
            'Os arquivos ficam nesta pasta do projeto, dentro da sua área de trabalho.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
