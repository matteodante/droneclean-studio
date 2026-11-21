import type { DocPageContent } from '../../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: 'Navegador de cenas e análise por IA',
  description:
    'Analise as mídias localmente para legendar as cenas e depois pesquise por palavra-chave, significado ou cor.',
  category: 'Creative Tools',
  related: ['media', 'local-ai', 'source-monitor'],
  sections: [
    {
      title: 'Analisar com IA',
      blocks: [
        {
          kind: 'list',
          items: [
            'Execute **Analisar com IA** em um clipe pela biblioteca de mídia, ou pelo menu **Analisar** do Navegador de cenas.',
            'A análise roda inteiramente na sua máquina: detecta cenas, legenda cada uma, extrai uma paleta de cores e cria embeddings de texto e de imagem.',
            'Escolha **Analisar novas mídias** para clipes sem legendas, ou **Reanalisar tudo** para atualizar tudo.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Os resultados ficam em cache por conteúdo, então uma mídia idêntica é reaproveitada em vez de ser analisada de novo.',
        },
      ],
    },
    {
      title: 'Abrir o Navegador de cenas',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abra o Navegador de cenas pela biblioteca de mídia, ou com `Ctrl+Shift+F`.',
            'Ele pesquisa as legendas de IA e os dados de cena produzidos por Analisar com IA.',
            'Defina o escopo como todas as mídias analisadas ou um único clipe e ordene por **Relevância**, **Timestamp** ou **Nome da mídia**.',
            'Alterne entre **Visualização em lista** e **Visualização em grade** conforme queira navegar ou varrer os resultados.',
          ],
        },
      ],
    },
    {
      title: 'Modos de pesquisa',
      blocks: [
        {
          kind: 'table',
          headers: ['Modo', 'Corresponde por'],
          rows: [
            [
              'Palavra-chave',
              'As palavras exatas de uma legenda — bom para um objeto ou rótulo específico.',
            ],
            [
              'Semântica',
              'Significado, de modo que "pôr do sol sobre a água" encontra cenas relacionadas (o primeiro uso baixa um modelo pequeno, de ~22 MB).',
            ],
            ['Cor', 'Uma paleta semelhante — escolha uma amostra na paleta da biblioteca.'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Os resultados trazem selos de correspondência — Forte, Bom ou Razoável — e indicam se a correspondência foi por palavra-chave, significado, semelhança visual ou cor.',
        },
      ],
    },
    {
      title: 'Usar um resultado',
      blocks: [
        {
          kind: 'list',
          items: [
            'Clique em uma cena para visualizá-la no monitor de origem.',
            'Arraste uma cena para a linha do tempo para acrescentar esse momento à sua edição.',
            'Se nada for encontrado, confirme que o clipe foi analisado — só as mídias analisadas são pesquisáveis.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
