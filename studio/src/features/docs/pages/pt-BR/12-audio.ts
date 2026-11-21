import type { DocPageContent } from '../../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Edição de áudio',
  description:
    'Grave uma locução, ajuste ganho e fades do clipe, tom, equalizador por clipe, o mixer e os medidores, e a limpeza de silêncios e vícios de fala.',
  category: 'Creative Tools',
  related: ['properties', 'local-ai'],
  sections: [
    {
      title: 'Ajustar um clipe',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Selecione um clipe e abra a aba **Áudio** em Propriedades.',
        },
        {
          kind: 'table',
          headers: ['Controle', 'Intervalo'],
          rows: [
            ['Ganho', '-60 dB a +12 dB (−60 dB praticamente silencia o clipe)'],
            ['Esmaecer entrada / Esmaecer saída', '0 a 5 segundos cada'],
            ['Tom', 'Semitons e Centésimos, independentes da velocidade'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Você também pode arrastar a linha de volume e as alças de fade diretamente no clipe, na linha do tempo, e o **Ganho** pode receber quadros-chave para subir ou descer ao longo de um clipe.',
        },
      ],
    },
    {
      title: 'Tom e timbre',
      blocks: [
        {
          kind: 'list',
          items: [
            'Os controles de **Tom** mudam a altura do som sem alterar a velocidade do clipe. Para mudar a velocidade, use **Velocidade** na aba Vídeo.',
            'A seção **Equalizador** dá a cada clipe um editor de curva para modelar o timbre.',
          ],
        },
      ],
    },
    {
      title: 'Mixer e medidores',
      blocks: [
        {
          kind: 'list',
          items: [
            'Abra os **Medidores** de áudio para acompanhar os níveis estéreo e detectar clipping durante a reprodução.',
            'Use o **Mixer** para equilibrar os níveis em todo o projeto.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'O volume do monitor na prévia afeta apenas a reprodução local e nunca altera a mixagem exportada.',
        },
      ],
    },
    {
      title: 'Gravar uma locução',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O botão **Gravar locução** (microfone) na barra de ferramentas da linha do tempo grava a narração em sincronia com o projeto. A captura acontece **enquanto a linha do tempo é reproduzida**, e a gravação pronta cai em uma nova faixa de áudio ancorada na posição do cursor de reprodução em que você começou.',
        },
        {
          kind: 'steps',
          items: [
            'Leve o cursor de reprodução até onde a locução deve começar.',
            'Clique no botão de **microfone** — a linha do tempo começa a ser reproduzida e a gravação começa.',
            'Use **Pausar gravação** para parar o cursor e o microfone juntos, **Retomar gravação** para continuar e **Parar e salvar** para terminar e colocar o clipe em uma nova faixa de áudio.',
            'Clique em **Cancelar gravação** (o ✕) para descartar a gravação sem adicionar nada.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Abra **Configurações do microfone** (o ▾ ao lado do botão) para escolher um dispositivo de entrada e ajustar a captura. O medidor de nível ali é ao vivo, então você pode testar o microfone antes de gravar.',
        },
        {
          kind: 'table',
          headers: ['Configuração', 'O que faz'],
          rows: [
            ['Supressão de ruído', 'Reduz o ruído de fundo constante. Ativada por padrão.'],
            ['Ganho automático', 'Mantém sua voz em um nível constante. Ativado por padrão.'],
            [
              'Silenciar a linha do tempo durante a gravação',
              'Silencia o monitor da linha do tempo para que o áudio dos alto-falantes não vaze para o microfone. Ativado por padrão.',
            ],
            [
              'Ajuste de sincronização',
              'Adianta ou atrasa o clipe gravado para compensar a latência da entrada (até ±1000 ms).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Use fones de ouvido para que o áudio do projeto nunca seja captado pelo microfone — assim você pode desativar **Silenciar a linha do tempo durante a gravação** para ouvir a mixagem enquanto narra.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'A busca de posição fica desativada durante a gravação, e pressionar `Space` ou chegar ao fim da linha do tempo encerra a gravação. Isso mantém a gravação presa ao cursor de reprodução, para que ela nunca saia de sincronia.',
        },
      ],
    },
    {
      title: 'Limpar o diálogo',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Remover silêncio** encontra os trechos silenciosos e os corta; a configuração **Silêncio mínimo** controla a duração que uma pausa precisa ter, e a caixa de diálogo estima quanto será removido.',
            '**Remover bordões** detecta, na transcrição e no áudio, palavras como "hum" e "é" e as remove.',
            'As duas ferramentas mostram os trechos que vão remover, para que você possa visualizar antes de aplicar a edição.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Uma transcrição melhora a detecção de vícios de fala; por isso, gere uma antes para obter os melhores resultados.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
