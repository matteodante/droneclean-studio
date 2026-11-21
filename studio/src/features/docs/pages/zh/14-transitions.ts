import type { DocPageContent } from '../../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: '转场',
  description: '为剪切点应用转场，并调整其样式、时长、位置、缓动和方向。',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: '应用转场',
      blocks: [
        {
          kind: 'steps',
          items: [
            '打开媒体侧边栏中的**转场**标签页。',
            '把转场卡片拖到两个相邻片段之间的剪切点上，或者选中一个有效的剪切点，再点击卡片。',
            '在时间线上选中该转场，即可打开“属性”中的**转场**部分。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '当两个片段首尾相接，并且有足够的备用源帧可供重叠时，这个剪切点才是有效的。在已有转场上再次应用，会就地替换它。',
        },
      ],
    },
    {
      title: '选择风格',
      blocks: [
        {
          kind: 'paragraph',
          text: '卡片按类别分组：**基础**、**溶解**、**运动**、**擦除**、**滑动**、**翻转**、**蒙版**、**光圈**、**形状**、**光**和**色差**。',
        },
        {
          kind: 'list',
          items: [
            '溶解类样式从普通的 Cross Dissolve 到 Additive、Blur 和 Dip To Color 等变体不一而足。',
            '运动类和自定义样式包括 Flip、Light Leak、Pixelate、Chromatic、Radial Blur、Glitch 和 Sparkles。',
            '擦除、滑动和翻转等有方向的样式会以多张卡片出现，每个方向一张。',
          ],
        },
      ],
    },
    {
      title: '调整转场',
      blocks: [
        {
          kind: 'table',
          headers: ['控件', '作用'],
          rows: [
            ['预设', '更换转场样式，无需重新设置剪切点。'],
            ['时长', '设置转场持续多久；重置会将其恢复为 1 秒。'],
            ['位置', '以剪切点为中心，或把转场移到剪切点之前或之后。'],
            ['缓动', '线性、缓入、缓出或缓入缓出。'],
            ['方向', '对于有方向的样式，可选左、右、上或下。'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '你也可以直接在时间线上拖动转场的边缘来调整它的大小。',
        },
      ],
    },
    {
      title: '转场无法应用时',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: '两个片段之间需要有真正的剪切点，并且相关一侧要有足够的**源余量**。如果某个位置被阻止，请换一个位置，或者少修剪一些。拖到有效的剪切点上始终可行，即使点击应用不可用也是如此。',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
