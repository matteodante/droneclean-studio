import type { DocPageContent } from '../../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Áreas de trabalho e armazenamento',
  description:
    'Como funciona a pasta de área de trabalho, onde ficam os arquivos, permissões e manutenção de caches.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: 'O modelo de área de trabalho',
      blocks: [
        {
          kind: 'list',
          items: [
            'Uma **área de trabalho** é uma única pasta no disco da qual o DroneClean Studio lê e na qual grava.',
            'Tudo o que o DroneClean Studio gera fica ali: arquivos de projeto, metadados de mídia, miniaturas, formas de onda, transcrições, dados de cena, recursos de IA, caches e exportações.',
            'As mídias de origem importadas não são copiadas para a área de trabalho — o DroneClean Studio registra um vínculo com cada arquivo no lugar onde ele já está no disco.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Como a área de trabalho é uma pasta de verdade, você pode fazer backup dela, sincronizá-la ou movê-la como qualquer outro diretório.',
        },
      ],
    },
    {
      title: 'Escolher e trocar de área de trabalho',
      blocks: [
        {
          kind: 'list',
          items: [
            'No primeiro uso, o DroneClean Studio pede que você escolha uma área de trabalho antes de abrir o editor.',
            'Escolha uma pasta comum que seja sua — por exemplo, uma pasta em Documentos. Evite locais protegidos do sistema.',
            'Use o controle **Áreas de trabalho** para adicionar, alternar ou remover áreas de trabalho conhecidas.',
            'Trocar muda a pasta que o DroneClean Studio usa; não move suas mídias de origem.',
          ],
        },
      ],
    },
    {
      title: 'Permissões e reconexão',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Por segurança, os navegadores podem fazer a permissão de acesso à pasta expirar entre sessões.',
        },
        {
          kind: 'list',
          items: [
            'Quando o DroneClean Studio mostrar **Reconecte sua área de trabalho**, escolha **Reconectar** e conceda acesso de leitura e gravação à mesma pasta.',
            'Se o acesso for negado, escolha a pasta de novo e permita o acesso quando o navegador pedir.',
            'Se a pasta foi movida, renomeada ou excluída, escolha outra pasta.',
          ],
        },
      ],
    },
    {
      title: 'Mídia ausente',
      blocks: [
        {
          kind: 'list',
          items: [
            'Mídia ausente significa que o DroneClean Studio não consegue ler, no momento, um ou mais arquivos de origem vinculados.',
            'Use **Conceder acesso** quando um arquivo só precisa de uma nova permissão do navegador.',
            'Use **Localizar** ou **Localizar pasta** quando um arquivo ou a pasta dele foi movido.',
            'Use **Procurar outra pasta** para apontar o DroneClean Studio para uma nova cópia da mídia.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Use **Trabalhar offline** somente se você pretende revincular os arquivos mais tarde; até lá, os clipes continuam como referências quebradas.',
        },
      ],
    },
    {
      title: 'Mover projetos e limpar caches',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Exportar projeto** para empacotar um projeto e suas mídias em um pacote portátil que outra área de trabalho pode importar.',
            'As ações de cache do projeto limpam dados regeneráveis, como formas de onda, tiras de quadros, quadros de GIF e áudio decodificado.',
            'As configurações de armazenamento também permitem regenerar miniaturas, gerar proxies ausentes e excluir proxies.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Limpar caches nunca exclui suas mídias de origem; o DroneClean Studio regenera as prévias quando o projeto precisa delas.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
