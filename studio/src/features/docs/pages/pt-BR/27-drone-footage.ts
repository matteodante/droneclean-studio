import type { DocPageContent } from '../../docs-content'

const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Filmagens de drone: estabilizar, corrigir cor, acelerar, compartilhar',
  description:
    'Estabilização por giroscópio e enquadramento, o perfil D-Log M, looks e o céu, rampas de velocidade com suavização, desfoque de movimento e câmera lenta suave, marcadores de batida, a edição suave em um clique, a exportação em Reel do Instagram e o acesso de agentes.',
  category: 'Creative Tools',
  related: ['effects-color', 'keyframes', 'export', 'properties'],
  sections: [
    {
      title: 'Estabilizar a partir dos dados do giroscópio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Os arquivos da DJI e da GoPro carregam o movimento da câmera. Selecione um clipe e ative **Estabilizar este clipe** em Propriedades › Vídeo › Estabilização: o clipe é estabilizado a partir desses dados, sem passada de análise, e **Suavização** e **Trava do horizonte** o ajustam.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Um clipe estabilizado é desenhado no formato do projeto. Um clipe 4:3 do Avata em um projeto 9:16 preenche sozinho o quadro vertical; você não precisa dimensioná-lo.',
        },
        {
          kind: 'paragraph',
          text: 'O **Enquadramento** (dois controles deslizantes em Estabilização) move a janela estabilizada para os lados ou para cima e para baixo dentro da imagem, até onde a estabilização deixar folga, para que uma edição vertical mantenha o assunto à vista. O losango ao lado de cada controle deslizante cria um quadro-chave nele, de modo que o enquadramento pode acompanhar o assunto ao longo do plano.',
        },
      ],
    },
    {
      title: 'Cor: perfil, look, correção',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Defina o **Perfil de cor** dos clipes em log (D-Log M para o Avata 2, D-Log): a imagem chapada vira Rec.709 antes de qualquer outra coisa. Os arquivos da DJI não dizem em qual perfil foram gravados, então a primeira importação da DJI de um projeto pergunta uma vez; **Sim, D-Log M** define isso nesses clipes. O perfil foi ajustado com imagens do Avata 2. A DJI também publica uma LUT D-Log M para o Mini 4 Pro e o Air 3, e o painel reconhece esses drones, mas a cor deles não foi verificada aqui, e o painel avisa.',
            'Escolha um **Look** (um arquivo `.cube` da biblioteca de looks da área de trabalho; **Gerenciar looks… › Adicionar .cube** adiciona um) e sua **Intensidade**.',
            'Termine em **Efeitos**: Color Wheels para contraste, realces e detalhe dos meios-tons; o **Sky** dá a um céu branco e encoberto um azul graduado (horizonte, ângulo, suavidade e uma proteção que o mantém nos pixels claros e pálidos); um Qualificador secundário e uma Power Window fazem o mesmo à mão; Glow, Vignette e Sharpen finalizam a imagem.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Gelo e neve também são brancos: em cenas com gelo, mantenha o qualificador leve e deixe a janela graduada colorir o céu.',
        },
      ],
    },
    {
      title: 'Velocidade, desfoque de movimento e câmera lenta suave',
      blocks: [
        {
          kind: 'table',
          headers: ['Controle', 'O que faz'],
          rows: [
            [
              'Velocidade',
              'Uma velocidade constante; o clipe mantém seu intervalo de origem e sua duração acompanha.',
            ],
            [
              'Curva…',
              'Uma curva de velocidade com quadros-chave: rampa de entrada, rampa de saída ou ambas, cada segmento Linear, Suave, Entrada suave ou Saída suave. O painel mostra os quadros por segundo que o clipe realmente tem no ponto mais lento.',
            ],
            [
              'Rampa suave + zoom',
              'A receita de reel de drone em um clique, no painel de velocidade: rápido, cerca de 0,45x no meio, rápido de novo, com segmentos suaves, câmera lenta suave, desfoque de movimento e um zoom de aproximação suavizado.',
            ],
            [
              'Desfoque de movimento',
              'Acima de 1x, mistura os quadros de origem que cada quadro de saída cobre, com um obturador de 90° a 360°.',
            ],
            [
              'Câmera lenta suave',
              'Abaixo de 1x, ou para um arquivo de 30 fps em um projeto de 60 fps, cria os quadros intermediários em vez de mostrar um quadro duas vezes: Mesclagem de quadros mistura os dois quadros de origem, Fluxo óptico constrói o quadro a partir do movimento entre eles (mais nítido, sem imagens duplas).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Reduza a velocidade apenas de filmagens gravadas em uma taxa de quadros maior que a do projeto. Um arquivo de 30 fps em um projeto de 60 fps já tem metade dos quadros de que precisa: mantenha-o em 1x ou mais rápido, e não reduza filmagens de 60 fps abaixo de 0,5x.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Corte nas batidas fortes da música, não em todas as batidas: clique com o botão direito na música e escolha **Marcar batidas** (um marcador em cada batida forte de graves), ou marque você mesmo com `M`, e deixe cada clipe correr de um marcador até o seguinte.',
        },
      ],
    },
    {
      title: 'Edição suave em um clique',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Coloque seus clipes de vídeo e uma música na linha do tempo e clique em **Edição suave…** (o botão com brilhos na barra da linha do tempo). O editor encontra as batidas da música, coloca os clipes de vídeo um após o outro a partir da primeira batida, cada um cortado no número de compassos que você escolher, e dá a cada um o look da edição suave: uma rampa de velocidade rápida, lenta, rápida com câmera lenta por fluxo óptico, desfoque de movimento e um zoom de aproximação suavizado. É a edição dos reels de drone em um só passo.',
        },
        {
          kind: 'steps',
          items: [
            'Adicione a música e os clipes à linha do tempo. Se não houver nenhum clipe de áudio, a caixa de diálogo diz **Adicione primeiro uma música à linha do tempo**.',
            'Clique em **Edição suave…**, escolha a música se houver mais de uma, a **Duração do plano** (1, 2 ou 4 compassos; um compasso tem quatro batidas) e se quer uma **Fusão curta em cada corte**.',
            'A caixa de diálogo diz quantos clipes vão mudar. Clique em **Aplicar**.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Cada clipe mantém seu ponto de entrada, então corte primeiro o início de um clipe para escolher onde o plano começa. As partes rápidas consomem as imagens mais depressa do que duram, então um plano de um compasso usa cerca de um compasso e meio do clipe. Um clipe com pouco material depois do ponto de entrada é pulado, e os clipes que terminariam depois da música ficam como estão, depois do último plano. Um clipe estabilizado mantém a estabilização. Nada é apagado, e **Ctrl/Cmd+Z** desfaz a edição inteira de uma vez.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Um agente de IA pode fazer o mesmo com uma única chamada, `studio.clips.smoothEditTimeline({ bars, crossfade })`, e ainda escolher sozinho, antes, a melhor parte de cada clipe.',
        },
      ],
    },
    {
      title: 'Exportar para o Instagram',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A predefinição **Reel do Instagram** segue a especificação de Reels da Meta: MP4 H.264 na taxa de quadros do projeto, 1080x1920 (o quadro que o Instagram exibe), 20 Mbps a 60 fps ou 12 Mbps a 30 fps, abaixo do máximo de 25 Mbps da Meta, com som AAC a 128 kbps, o índice no início do arquivo e sem lista de edição. O Instagram recodifica todo upload; entregar a ele o quadro e o tamanho próprios evita uma segunda mudança de escala.',
        },
        {
          kind: 'paragraph',
          text: 'As predefinições **TikTok** e **YouTube Shorts** geram o mesmo MP4 H.264 vertical em 1080x1920 na taxa de quadros do projeto (até 60 fps). **YouTube Shorts** usa as taxas de 1080p publicadas pelo YouTube: 12 Mbps a 60 fps ou 8 Mbps a 30 fps, com áudio AAC estéreo a 384 kbps. O TikTok não publica uma taxa de bits, então **TikTok** usa 16 Mbps a 60 fps ou 10 Mbps a 30 fps, escolhidos por nós, com AAC a 128 kbps. As duas plataformas recodificam todo envio.',
        },
      ],
    },
    {
      title: 'Deixar um agente de IA editar',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O app para desktop roda um servidor MCP local para agentes de IA no seu computador, ligado por padrão: **Configurações › Acesso de agentes › Permitir agentes de IA** o desliga ou liga de novo, e só o seu usuário consegue acessá-lo. O painel mostra o comando para o Claude Code ou a configuração para outros clientes. Um agente pode então montar e corrigir a cor de um projeto e exportá-lo pelo mesmo SDK que o editor usa, e cada mudança é uma etapa de desfazer que você pode ver. Toda chamada que altera o projeto o salva.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
