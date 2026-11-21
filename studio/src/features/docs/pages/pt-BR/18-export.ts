import type { DocPageContent } from '../../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: 'Exportação',
  description:
    'Renderize vídeo ou áudio no navegador, escolha formatos e intervalo e resolva os avisos da verificação prévia.',
  category: 'Output',
  related: ['render-queue', 'text-captions-subtitles', 'troubleshooting'],
  sections: [
    {
      title: 'Configurar uma exportação',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abra **Exportar** (`Ctrl+Shift+E`) e escolha **Exportar vídeo** ou **Exportar áudio**.',
            'Renderize o projeto inteiro ou o intervalo atual de entrada/saída quando precisar só de um trecho.',
            'Defina **Resolução** e **Qualidade** de acordo com o objetivo: uma revisão rápida, um arquivo para compartilhar ou um master final.',
            'Resolva os avisos da verificação prévia e depois renderize.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Resolução e qualidade mais altas levam mais tempo e geram arquivos maiores.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Quando um projeto tem mais do que a linha do tempo Principal, um menu **Sequência** no alto da caixa de diálogo escolhe qual linha do tempo exportar — na sua própria resolução e intervalo.',
        },
      ],
    },
    {
      title: 'Formatos',
      blocks: [
        {
          kind: 'table',
          headers: ['Saída', 'Formatos'],
          rows: [
            ['Contêineres de vídeo', 'MP4, MOV, WebM, MKV'],
            ['Somente áudio', 'MP3, AAC, WAV'],
            ['Faixa de legendas alternável', 'WebM, MKV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Quais codecs estão disponíveis depende do seu navegador; o DroneClean Studio avisa ou usa uma alternativa quando um deles não está.',
        },
      ],
    },
    {
      title: 'Legendas',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Quando uma exportação de vídeo tem uma transcrição, o controle **Legendas** escolhe como as legendas são incluídas. As opções se adaptam ao contêiner escolhido.',
        },
        {
          kind: 'table',
          headers: ['Modo', 'O que faz'],
          rows: [
            ['**Desativado**', 'Nenhuma legenda no vídeo exportado.'],
            [
              '**Embutir**',
              'As legendas são desenhadas no quadro, então aparecem em qualquer player.',
            ],
            [
              '**Arquivo** `.srt`',
              'Vídeo limpo mais um arquivo de legendas `.srt` separado, baixado junto com ele.',
            ],
            [
              '**Faixa incorporada**',
              'Uma faixa de legendas alternável, carregada dentro do contêiner.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'A opção de faixa incorporada aparece apenas para `WebM` e `MKV`. Em `MP4` e `MOV`, escolha embutir ou um arquivo separado, ou troque de contêiner para ter uma faixa alternável.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Alguns players ocultam as faixas de legendas por padrão, então talvez os espectadores precisem ativá-las.',
        },
      ],
    },
    {
      title: 'Verificações prévias',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A verificação prévia roda antes da renderização e sinaliza impedimentos comuns: um intervalo vazio, mídia ausente, um codec indisponível, uma alternativa de exportação por worker, um arquivo grande ou uma renderização longa.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Para um teste rápido de sanidade, exporte primeiro um intervalo curto de entrada/saída antes de se comprometer com a renderização completa.',
        },
      ],
    },
    {
      title: 'Renderizar e baixar',
      blocks: [
        {
          kind: 'list',
          items: [
            'O progresso passa por preparando, renderizando, codificando e finalizando, e você pode **Cancelar** a qualquer momento.',
            'A exportação por worker roda em segundo plano quando disponível; a alternativa na thread principal exige a aba em foco e sem uso.',
            'Quando termina, escolha **Baixar** para salvar o arquivo, que também é gravado na pasta de exportações da sua área de trabalho.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Mantenha a aba do projeto aberta até a exportação terminar. Para agrupar várias renderizações, adicione-as à **Fila de renderização** em vez de exportar uma de cada vez.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
