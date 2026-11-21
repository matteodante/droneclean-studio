import type { DocPageContent } from '../../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: 'Referência',
  description: 'Os formatos compatíveis e um glossário dos termos usados neste guia.',
  category: 'Reference',
  related: ['concepts', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Formatos',
      blocks: [
        {
          kind: 'table',
          headers: ['Uso', 'Tipos'],
          rows: [
            ['Importação', 'Vídeo, áudio, imagem, GIF, SVG, recursos gerados, clipes compostos'],
            ['Exportação de vídeo', 'MP4, MOV, WebM, MKV'],
            ['Exportação de áudio', 'MP3, AAC, WAV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'O suporte a codecs depende do que o seu navegador consegue decodificar e codificar.',
        },
      ],
    },
    {
      title: 'Termos de edição',
      blocks: [
        {
          kind: 'table',
          headers: ['Termo', 'Significado'],
          rows: [
            [
              'Intervalo de entrada/saída',
              'Um início e um fim marcados, usados em edições de origem e em intervalos de exportação.',
            ],
            [
              'Margem de origem',
              'Quadros de sobra além da borda de um clipe, necessários para cortes e transições.',
            ],
            [
              'Edição ripple',
              'Uma edição que desloca o material posterior para abrir ou fechar espaço na linha do tempo.',
            ],
            ['Edição rolling', 'Uma edição que move o corte entre dois clipes vizinhos.'],
            ['Edição slip', 'Muda os quadros de origem dentro de um clipe sem mover o clipe.'],
            ['Edição slide', 'Move um clipe ajustando os cortes vizinhos dele.'],
          ],
        },
      ],
    },
    {
      title: 'Termos de recursos',
      blocks: [
        {
          kind: 'table',
          headers: ['Termo', 'Significado'],
          rows: [
            ['Área de trabalho', 'A pasta da qual o DroneClean Studio lê e na qual grava.'],
            [
              'Proxy',
              'Uma cópia gerada, mais leve, de uma mídia pesada, usada para uma reprodução mais fluida.',
            ],
            [
              'Clipe composto',
              'Um trecho da linha do tempo agrupado em um único item de mídia reutilizável.',
            ],
            [
              'Camada de ajuste',
              'Uma camada cujos efeitos e correção de cor se aplicam aos clipes abaixo dela.',
            ],
            [
              'Quadro-chave',
              'Um valor definido em um instante específico para animar uma propriedade.',
            ],
            ['LUT', 'Uma tabela de consulta (.cube) que aplica uma transformação de cor.'],
            [
              'Destino do patch',
              'A faixa da linha do tempo para a qual uma edição do monitor de origem é enviada.',
            ],
            [
              'Fila de renderização',
              'Uma lista ordenada de exportações que são renderizadas uma de cada vez.',
            ],
            [
              'Verificação prévia',
              'A checagem de prontidão que roda antes de uma exportação começar.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
