import type { DocPageContent } from '../../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: '场景浏览器与 AI 分析',
  description: '在本地分析媒体，为场景生成字幕描述，然后按关键词、含义或颜色进行搜索。',
  category: 'Creative Tools',
  related: ['media', 'local-ai', 'source-monitor'],
  sections: [
    {
      title: '用 AI 分析',
      blocks: [
        {
          kind: 'list',
          items: [
            '在媒体库中对片段运行**用 AI 分析**，或使用场景浏览器的**分析**菜单。',
            '整个过程完全在你的电脑上运行：检测场景，为每个场景生成描述，提取调色板，并构建文本和图像嵌入。',
            '对没有描述的片段选择**分析新媒体**，或选择**全部重新分析**来刷新所有内容。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '结果按内容缓存，因此相同的媒体会被复用，而不会再次分析。',
        },
      ],
    },
    {
      title: '打开场景浏览器',
      blocks: [
        {
          kind: 'list',
          items: [
            '从媒体库打开场景浏览器，或使用 `Ctrl+Shift+F`。',
            '它搜索的是“用 AI 分析”生成的 AI 字幕描述和场景数据。',
            '把范围设为所有已分析的媒体或单个片段，并按**相关性**、**时间戳**或**媒体名称**排序。',
            '在**列表视图**和**网格视图**之间切换，以适应浏览或快速扫视。',
          ],
        },
      ],
    },
    {
      title: '搜索模式',
      blocks: [
        {
          kind: 'table',
          headers: ['模式', '匹配依据'],
          rows: [
            ['关键词', '字幕描述中的确切词语，适合查找特定的物体或标签。'],
            [
              '语义',
              '含义，因此搜索“水面上的日落”可以找到相关的场景（首次使用会下载一个小型模型，约 22 MB）。',
            ],
            ['颜色', '相近的调色板，从媒体库调色板中选取一个色样。'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '结果带有匹配度标记（强、良好或一般），并注明匹配是依据关键词、含义、视觉相似度还是颜色。',
        },
      ],
    },
    {
      title: '使用搜索结果',
      blocks: [
        {
          kind: 'list',
          items: [
            '点击某个场景，即可在源监视器中预览它。',
            '把场景拖到时间线上，就能把这一刻加入你的剪辑。',
            '如果什么都没找到，请确认该片段已经分析过，只有已分析的媒体才能被搜索到。',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
