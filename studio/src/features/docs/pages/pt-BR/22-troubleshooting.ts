import type { DocPageContent } from '../../docs-content'

const page = {
  order: 22,
  slug: 'troubleshooting',
  title: 'Solução de problemas',
  description:
    'Correções para problemas de navegador, área de trabalho, mídia, WebGPU, IA local e exportação.',
  category: 'Reference',
  related: ['workspaces', 'export'],
  sections: [
    {
      title: 'Navegador e área de trabalho',
      blocks: [
        {
          kind: 'table',
          headers: ['Sintoma', 'Correção'],
          rows: [
            [
              'Navegador não compatível, ou sem seletor de área de trabalho',
              'Use o Chrome ou o Edge 113+, que oferecem as APIs de que o DroneClean Studio precisa.',
            ],
            [
              'O Brave não consegue escolher uma pasta',
              'Ative `brave://flags/#file-system-access-api` e reinicie o Brave.',
            ],
            [
              'Permissão negada',
              'Escolha uma pasta comum que você possa editar e depois permita o acesso de leitura e gravação.',
            ],
            [
              'Pede para reconectar ao reabrir',
              'Escolha **Reconectar** para a mesma pasta; se ela foi movida, escolha outra pasta.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Mídia e importação',
      blocks: [
        {
          kind: 'table',
          headers: ['Sintoma', 'Correção'],
          rows: [
            [
              'Mídia ausente',
              'Revincule com **Conceder acesso**, **Localizar**, **Localizar pasta** ou **Procurar outra pasta**.',
            ],
            [
              'A importação falhou ou codec não compatível',
              'Tente outro formato compatível com o navegador, ou transcodifique o arquivo antes.',
            ],
            [
              'A importação por URL falha',
              'Confirme que o link aponta para o próprio arquivo de mídia, não para uma página que o incorpora.',
            ],
            [
              'Prévias ou formas de onda desatualizadas',
              'Regenere as miniaturas ou os proxies, ou limpe o cache do projeto nas configurações de Armazenamento.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Use **Trabalhar offline** somente se você pretende revincular os arquivos mais tarde — até lá, os clipes continuam como referências quebradas.',
        },
      ],
    },
    {
      title: 'WebGPU e IA local',
      blocks: [
        {
          kind: 'table',
          headers: ['Sintoma', 'Correção'],
          rows: [
            [
              'Efeitos, escopos ou IA indisponíveis',
              'O WebGPU pode estar desligado — use um Chrome ou Edge recente, atualize os drivers da GPU e mantenha a aceleração por hardware ativada.',
            ],
            [
              'O download de um modelo é lento ou falha',
              'Mantenha a aba aberta, tente de novo em uma conexão estável e limpe o **Cache de modelos de IA locais** se um download estiver corrompido.',
            ],
            [
              'Falta de memória durante o trabalho com IA',
              'Use **Descarregar modelos locais** para liberar os runtimes.',
            ],
            [
              'Importação de LUT bloqueada',
              'A importação de LUT (.cube) exige um navegador baseado em Chromium.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Exportação',
      blocks: [
        {
          kind: 'table',
          headers: ['Sintoma', 'Correção'],
          rows: [
            [
              'Codec indisponível na verificação prévia',
              'Escolha outro codec ou formato, ou diminua a resolução ou a qualidade.',
            ],
            [
              'Exportação por worker indisponível',
              'Mantenha a aba em foco e evite interações pesadas; trocar itens de imagem animada por clipes de vídeo pode ajudar.',
            ],
            [
              'Exportação grande ou lenta',
              'Exporte um intervalo de entrada/saída mais curto, diminua a resolução ou a qualidade e libere espaço em disco antes.',
            ],
            [
              'A exportação não começa',
              'Resolva qualquer aviso impeditivo da verificação prévia e depois teste um intervalo curto para confirmar que o pipeline funciona.',
            ],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
