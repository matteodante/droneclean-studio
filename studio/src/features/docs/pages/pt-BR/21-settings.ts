import type { DocPageContent } from '../../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Configurações',
  description:
    'As abas Geral, Linha do tempo, IA, Armazenamento e Privacidade, e onde ficam o idioma e os atalhos.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'As abas',
      blocks: [
        {
          kind: 'table',
          headers: ['Aba', 'O que você define'],
          rows: [
            [
              'Geral',
              'Salvamento automático ligado/desligado e intervalo (5–30 min); profundidade do histórico de desfazer (10–200 etapas); sons da interface (ligado/desligado, volume, tema de som).',
            ],
            [
              'Linha do tempo',
              'Snap por padrão; mostrar formas de onda e tiras de quadros; extrair tiras de quadros na importação.',
            ],
            [
              'IA',
              'Intervalo de amostragem de legendas (segundos ou quadros); estilo de legenda padrão.',
            ],
            [
              'Armazenamento',
              'Gerar proxies ausentes; limpar o cache do projeto; regenerar miniaturas; excluir proxies; gerenciar a IA local.',
            ],
            [
              'Privacidade',
              'Relatórios de falhas e estatísticas de uso anônimas, cada um ligado ou desligado (ambos desligados até você permitir); no app para desktop, também **Verificar novas versões** (ativado por padrão).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Limpar o cache do projeto remove dados regeneráveis (formas de onda, tiras de quadros, quadros de GIF, áudio decodificado); nunca exclui as mídias de origem. Use **Redefinir** no cabeçalho da caixa de diálogo para restaurar os padrões.',
        },
      ],
    },
    {
      title: 'Novas versões',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O app para desktop não é assinado, então não consegue se atualizar sozinho. Em vez disso, ao iniciar (no máximo uma vez por dia), ele pede ao GitHub o número da versão mais recente e, se houver uma mais nova, mostra um pequeno cartão com **Baixar** (abre a página dessa versão no seu navegador) e **Depois** (esconde até amanhã). Nada aparece enquanto uma exportação está sendo renderizada. É a única solicitação que o app faz sem você pedir, por isso tem uma chave: **Configurações › Privacidade › Verificar novas versões**, ativada por padrão. O GitHub vê seu endereço IP; nada mais sobre você ou seu trabalho é enviado, e com a chave desligada nenhuma solicitação é feita. O editor web está sempre na versão mais recente e nunca verifica.',
        },
      ],
    },
    {
      title: 'Sons da interface',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O DroneClean Studio pode tocar sons de interface sintetizados e discretos — sinais curtos que confirmam ações como selecionar, confirmar, alternar e excluir. Eles vêm **desligados por padrão**, são opcionais e nunca afetam o áudio exportado.',
        },
        {
          kind: 'steps',
          items: [
            'Abra **Configurações** e vá à aba **Geral**.',
            'Ative **Sons da interface**.',
            'Ajuste o **Volume do som** ao seu gosto (0–100%).',
            'Escolha um **Tema de som** — **Signature**, **Velvet** ou **Crisp** — e use o botão **Prévia** para ouvi-lo.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Os sons são suprimidos enquanto a prévia está sendo reproduzida, para nunca vazarem no áudio que você está monitorando; as exportações são silenciosas por definição. Ao ativar a chave, toca uma breve confirmação.',
        },
      ],
    },
    {
      title: 'Relatórios de falhas e estatísticas de uso',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O DroneClean Studio não envia nada sobre você ou seu trabalho sem a sua permissão. Na primeira vez que abre, ele pergunta, em um cartão no canto inferior esquerdo, se deve enviar **relatórios de falhas** e **estatísticas de uso anônimas**; até você responder, e depois de **Não permitir**, nada é enviado. Mude qualquer uma das duas coisas a qualquer momento em **Configurações › Privacidade**.',
        },
        {
          kind: 'table',
          headers: ['Relatório', 'O que é enviado', 'Para onde'],
          rows: [
            [
              'Relatórios de falhas',
              'O erro, onde ele aconteceu no código do editor, a versão e o sistema operacional. Caminhos e nomes de arquivos são removidos das mensagens antes de elas saírem.',
              'Sentry, na UE',
            ],
            [
              'Estatísticas de uso',
              'Que o app foi aberto, um projeto foi criado (seu tamanho e taxa de quadros), uma exportação foi concluída (seu formato, tamanho e duração), um agente de IA foi conectado ou uma sombra foi removida (sua duração), sob um id aleatório desta instalação que é esquecido quando você desliga as estatísticas.',
              'PostHog, na UE',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Nunca são enviados: seus vídeos, quadros, nomes de arquivos e pastas, nomes de projetos ou sua conta. Seu endereço IP não é armazenado. O app para desktop guarda sua resposta na pasta do perfil dele, e o editor web, no seu navegador.',
        },
      ],
    },
    {
      title: 'Personalizar os atalhos de teclado',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Os atalhos de teclado são totalmente personalizáveis, mas o editor é uma caixa de diálogo própria, aberta pelo botão **Teclado** na barra de ferramentas — não esta caixa de Configurações. Ele tem um teclado interativo na tela, pesquisa e filtros **Personalizado** / **Conflitos** / **Não atribuído**, gravação para reatribuir, atribuições alternativas, padrões por comando e **Redefinir tudo**, detecção de conflitos e **Importar** / **Exportar** de predefinições em JSON.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Veja a página **Atalhos de teclado** para a lista completa de comandos e um passo a passo de como reatribuir.',
        },
      ],
    },
    {
      title: 'Definido em outro lugar',
      blocks: [
        {
          kind: 'list',
          items: [
            'O **idioma** da interface é um controle separado na barra de ferramentas, fora desta caixa de diálogo; o DroneClean Studio vem em 10 idiomas.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'O DroneClean Studio usa atualmente um único tema escuro; não há seletor de tema.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
