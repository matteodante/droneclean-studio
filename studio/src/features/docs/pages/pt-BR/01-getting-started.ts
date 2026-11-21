import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Primeiros passos',
  description:
    'O que é o DroneClean Studio, o que seu navegador precisa ter e sua primeira edição, do início à exportação.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'O que é o DroneClean Studio',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O DroneClean Studio é um editor de vídeo **local-first** que roda inteiramente no seu navegador — não há conta, upload nem renderização em servidor. Edição, efeitos, cor, ferramentas de IA e exportação rodam na sua própria máquina, usando sua GPU e sua CPU.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Suas mídias ficam no seu dispositivo. O DroneClean Studio cria vínculos com os arquivos originais e grava projetos, caches e exportações em uma **pasta de área de trabalho** que você escolhe — nada é enviado para a nuvem.',
        },
      ],
    },
    {
      title: 'O que seu navegador precisa ter',
      blocks: [
        {
          kind: 'paragraph',
          text: 'O DroneClean Studio depende de APIs web modernas, por isso um navegador Chromium recente é o caminho compatível.',
        },
        {
          kind: 'table',
          headers: ['Navegador', 'Situação'],
          rows: [
            ['Chrome / Edge 113+', 'Totalmente compatível'],
            ['Brave', 'Funciona depois de ativar a flag da File System Access API'],
            ['Safari / Firefox', 'Ainda não compatíveis com o fluxo de trabalho completo'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'O DroneClean Studio usa a File System Access API (pastas de área de trabalho), WebCodecs (decodificação e exportação), WebGPU (efeitos, cor, IA) e OPFS (caches). Mantenha a aceleração por hardware ativada e os drivers da GPU atualizados.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'O Brave pode bloquear o acesso a pastas. Abra `brave://flags/#file-system-access-api`, defina como **Enabled** e reinicie o Brave.',
        },
      ],
    },
    {
      title: 'Sua primeira edição',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abra o DroneClean Studio em um navegador compatível e, quando solicitado, escolha uma **pasta de área de trabalho** na qual você possa ler e gravar.',
            'Na página Projetos, escolha **Novo projeto** e defina a resolução e a taxa de quadros da edição.',
            'Abra a aba **Mídia** e use **Importar** para adicionar arquivos, ou arraste as mídias direto para a biblioteca.',
            'Arraste um clipe do painel Mídia para uma faixa da linha do tempo.',
            'Pressione `Space` para reproduzir e use `Left` e `Right` para avançar ou voltar um quadro por vez.',
            'Salve com `Ctrl+S` enquanto trabalha e depois escolha **Exportar** para renderizar o vídeo final.',
          ],
        },
      ],
    },
    {
      title: 'Confirme que sua configuração funciona',
      blocks: [
        {
          kind: 'list',
          items: [
            'O seletor de área de trabalho abre e aceita uma pasta comum (não um local protegido do sistema).',
            'As mídias importadas aparecem como cartões, com miniaturas, no painel Mídia.',
            'A reprodução começa na linha do tempo quando você pressiona `Space`.',
            'A exportação abre e a verificação prévia não indica nenhum problema impeditivo.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Se alguma etapa falhar, consulte a página **Solução de problemas** para ver o sintoma correspondente.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
