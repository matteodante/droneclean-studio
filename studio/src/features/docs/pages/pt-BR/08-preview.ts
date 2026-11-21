import type { DocPageContent } from '../../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Prévia e reprodução',
  description:
    'Reproduza, avance quadro a quadro, aproxime o monitor, use a tela cheia, salve quadros, use a reprodução com proxy, reduza a resolução de reprodução e renderize um trecho antecipadamente para uma reprodução suave.',
  category: 'Core Editing',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Reproduzir e navegar',
      blocks: [
        {
          kind: 'list',
          items: [
            'Reproduza e pause com os controles da prévia ou com `Space`.',
            'Avance ou volte um quadro por vez com `Left` e `Right` para conferências com precisão de quadro.',
            'Vá ao início da linha do tempo com `Home` e ao fim com `End`.',
            'Leia o código de tempo na tela para confirmar a posição exata do cursor de reprodução.',
          ],
        },
      ],
    },
    {
      title: 'Enquadrar a visualização',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ajuste o zoom da prévia para inspecionar detalhes; isso não altera a tela de exportação.',
            'Use **Tela cheia** para revisar movimento ou enquadramento e Sair da tela cheia para voltar.',
            'Use **Salvar quadro** para gravar o quadro atual em um arquivo de imagem.',
            'As sobreposições de transformação, máscara e edição aparecem no monitor quando um item correspondente está selecionado.',
          ],
        },
      ],
    },
    {
      title: 'Desempenho de reprodução e áudio',
      blocks: [
        {
          kind: 'list',
          items: [
            'Quando existem proxies, o DroneClean Studio os usa para reproduzir com mais fluidez as mídias pesadas; as exportações continuam usando os originais.',
            'O controle de volume do monitor afeta apenas a reprodução local.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'As exportações usam a mixagem do projeto; por isso o volume do monitor nunca altera o áudio renderizado.',
        },
      ],
    },
    {
      title: 'Resolução de reprodução',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O botão ao lado da chave de proxy na barra de transporte define a resolução de reprodução: **Completa**, **1/2** ou **1/4**. Uma resolução menor desenha menos pixels em cada quadro que a prévia calcula sozinha (clipes com efeitos, estabilização, rampas de velocidade, desfoque de movimento), então os trechos pesados tocam mais rápido; a imagem fica mais suave. A configuração vale para o app inteiro e nunca muda uma exportação.',
        },
      ],
    },
    {
      title: 'Renderizar um trecho antecipadamente',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Clipes estabilizados com câmera lenta por fluxo óptico e desfoque de movimento podem ser pesados demais para a prévia em tempo real. Renderize-os antecipadamente, como no After Effects, e eles tocam na taxa de quadros completa.',
        },
        {
          kind: 'steps',
          items: [
            'Marque o trecho com entrada e saída (`I` e `O`), ou não marque nada para renderizar a linha do tempo inteira.',
            'Abra o menu **Renderizar prévia** na barra da linha do tempo, ao lado dos botões de entrada e saída, e escolha **Renderizar da entrada à saída**, ou pressione `Enter`.',
            'Acompanhe o progresso na barra de transporte; o X ali cancela e mantém o que já foi renderizado.',
            'Uma linha verde na borda inferior da régua marca os quadros que agora tocam a partir da prévia renderizada.',
          ],
        },
        {
          kind: 'list',
          items: [
            'Os quadros são renderizados na resolução de reprodução atual e mantidos na memória (até 1 GB, cerca de quatro minutos e meio em 1080p a 60 fps) até você fechar o projeto.',
            'Qualquer edição que mude um quadro (um clipe, um efeito, um quadro-chave, uma transição, a estabilização, a velocidade, o tamanho ou a taxa do projeto, a resolução de reprodução ou a chave de proxy) tira esses quadros da linha verde na hora: a prévia volta a calculá-los ao vivo, nunca uma imagem antiga.',
            'Renderizar de novo calcula só os quadros que faltam. **Excluir a prévia renderizada**, no mesmo menu, libera a memória.',
            'As exportações nunca usam a prévia renderizada: sempre renderizam a partir do projeto.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Se o computador não conseguir codificar quadros no tamanho da prévia, ou o limite de memória for atingido, uma mensagem avisa e a prévia continua ao vivo.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
