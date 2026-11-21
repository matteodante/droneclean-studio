import type { DocPageContent } from '../../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Ferramentas de IA local',
  description:
    'Texto para fala, geração de música e transcrição no navegador, com cache local dos modelos.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: 'Como a IA local funciona',
      blocks: [
        {
          kind: 'list',
          items: [
            'As ferramentas de IA rodam no seu navegador, usando o seu próprio hardware — nada é enviado a um servidor.',
            'Na primeira vez que você usa um modelo, ele é baixado uma única vez e depois fica em cache local para reutilização.',
            'Um indicador de estado mostra os estados de carregando, ativo, pronto e erro enquanto um modelo roda.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Algumas ferramentas exigem Chrome ou Edge 113+ (ou Safari 26+) e suporte a WebGPU. O primeiro download de um modelo pode ser grande.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'As licenças dos modelos obrigam você, não a nós: a música gerada com o MusicGen é apenas para uso não comercial (CC BY-NC 4.0), e a fala do Supertonic vem sob a licença OpenRAIL-M, que proíbe alguns usos. A aba IA avisa isso antes de você gerar.',
        },
      ],
    },
    {
      title: 'Texto para fala',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abra a aba **IA** e expanda **Texto para fala**; depois digite ou cole seu roteiro.',
            'Escolha um mecanismo (veja a tabela) e depois uma voz e, onde houver suporte, velocidade, idioma e tags expressivas.',
            'Ouça o resultado e depois use **Salvar e inserir** para colocar o áudio vinculado no cursor de reprodução, ou **Salvar na biblioteca**.',
          ],
        },
        {
          kind: 'table',
          headers: ['Mecanismo', 'Idiomas', 'Roda em'],
          rows: [
            ['Kokoro', 'Inglês', 'WebGPU'],
            ['MOSS Nano', '20 idiomas', 'CPU'],
            ['Supertonic 3', '31 idiomas', 'ONNX local'],
          ],
        },
      ],
    },
    {
      title: 'Geração de música',
      blocks: [
        {
          kind: 'list',
          items: [
            'Expanda **Geração de música** e descreva a faixa com um prompt, ou comece por uma predefinição como Lo-fi chill ou Upbeat EDM.',
            'Defina a duração em segundos e depois **Gerar música**; a primeira execução baixa o modelo e o guarda em cache.',
            'Ouça o clipe e depois use **Salvar e inserir** na linha do tempo ou **Salvar na biblioteca**.',
          ],
        },
      ],
    },
    {
      title: 'Transcrição',
      blocks: [
        {
          kind: 'list',
          items: [
            'A transcrição fica na biblioteca de mídia e no fluxo de Transcrição, separada da aba IA.',
            'O **Parakeet** é o mecanismo padrão, rápido, e cobre muitos idiomas europeus.',
            'Os modelos Whisper (Tiny, Base, Small, Large v3 Turbo) também estão disponíveis, e o DroneClean Studio recorre ao Whisper quando necessário.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Uma transcrição alimenta as legendas, a pesquisa na transcrição e a remoção de vícios de fala — gere uma logo no começo.',
        },
      ],
    },
    {
      title: 'Gerenciar modelos e runtimes',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abra as configurações de **Armazenamento** para gerenciar a IA local.',
            'Use **Cache de modelos de IA locais** para inspecionar ou limpar os modelos baixados — útil se um download estiver corrompido.',
            'Use **Descarregar modelos locais** para liberar os runtimes e a memória.',
            'Tarefas longas podem ser canceladas se você não precisar mais do resultado.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
