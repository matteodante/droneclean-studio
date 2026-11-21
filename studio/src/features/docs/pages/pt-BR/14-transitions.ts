import type { DocPageContent } from '../../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: 'Transições',
  description:
    'Aplique uma transição a um corte e ajuste seu estilo, duração, posição, suavização e direção.',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Aplicar uma transição',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Abra a aba **Transições** na barra lateral de mídia.',
            'Arraste um cartão de transição até um corte entre dois clipes adjacentes — ou selecione um corte válido e clique em um cartão.',
            'Selecione a transição na linha do tempo para abrir a seção **Transição** em Propriedades.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Um corte é válido quando dois clipes estão colados, borda com borda, e têm quadros de origem de sobra suficientes para se sobrepor. Aplicar sobre uma transição existente a substitui no mesmo lugar.',
        },
      ],
    },
    {
      title: 'Escolher um visual',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Os cartões são agrupados por categoria: **Básica**, **Dissolução**, **Movimento**, **Varredura**, **Deslizamento**, **Giro**, **Máscara**, **Íris**, **Forma**, **Luz** e **Cromática**.',
        },
        {
          kind: 'list',
          items: [
            'Os estilos de dissolução vão de uma simples Cross Dissolve até as variantes Additive, Blur e Dip To Color.',
            'Os estilos de movimento e personalizados incluem Flip, Light Leak, Pixelate, Chromatic, Radial Blur, Glitch e Sparkles.',
            'Os estilos direcionais, como Wipe, Slide e Flip, aparecem como vários cartões, um por direção.',
          ],
        },
      ],
    },
    {
      title: 'Ajustar uma transição',
      blocks: [
        {
          kind: 'table',
          headers: ['Controle', 'O que faz'],
          rows: [
            ['Predefinição', 'Troca o estilo da transição sem refazer o corte.'],
            ['Duração', 'Define quanto tempo a transição dura; redefinir volta a 1 segundo.'],
            ['Posição', 'Centraliza no corte ou desloca a transição para antes ou depois dele.'],
            ['Suavização', 'Linear, Entrada, Saída ou Entrada e saída.'],
            ['Direção', 'Esquerda, Direita, Cima ou Baixo, para estilos direcionais.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Você também pode redimensionar uma transição arrastando a borda dela diretamente na linha do tempo.',
        },
      ],
    },
    {
      title: 'Quando uma transição não é aplicada',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'É preciso um corte de verdade entre dois clipes e **margem de origem** suficiente no lado em questão. Se uma posição estiver bloqueada, escolha outra posição ou apare menos. Arrastar sobre um corte válido sempre funciona, mesmo quando o clique para aplicar não está disponível.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
