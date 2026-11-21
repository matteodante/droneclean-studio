import type { DocPageContent } from '../../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: '参考',
  description: '支持的格式，以及本指南中所用术语的词汇表。',
  category: 'Reference',
  related: ['concepts', 'keyboard-shortcuts'],
  sections: [
    {
      title: '格式',
      blocks: [
        {
          kind: 'table',
          headers: ['用途', '类型'],
          rows: [
            ['导入', '视频、音频、图片、GIF、SVG、生成的素材、复合片段'],
            ['视频导出', 'MP4、MOV、WebM、MKV'],
            ['音频导出', 'MP3、AAC、WAV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '编解码器的支持情况取决于你的浏览器能够解码和编码哪些格式。',
        },
      ],
    },
    {
      title: '剪辑术语',
      blocks: [
        {
          kind: 'table',
          headers: ['术语', '含义'],
          rows: [
            ['入点/出点范围', '标记好的起点和终点，用于素材编辑和导出范围。'],
            ['源余量', '片段边缘之外多出的帧，修剪和转场时需要用到。'],
            ['波纹编辑', '一种会让之后的素材移动，以腾出或合上时间线空间的编辑。'],
            ['滚动编辑', '一种移动两个相邻片段之间剪切点的编辑。'],
            ['滑移编辑', '在不移动片段的前提下，改变片段内部的源帧。'],
            ['滑动编辑', '移动片段，同时调整它相邻的剪切点。'],
          ],
        },
      ],
    },
    {
      title: '功能术语',
      blocks: [
        {
          kind: 'table',
          headers: ['术语', '含义'],
          rows: [
            ['工作区', 'DroneClean Studio 读取和写入的文件夹。'],
            ['代理', '为较重的媒体生成的轻量副本，用于让播放更流畅。'],
            ['复合片段', '把一段时间线组合成的、可重复使用的单个媒体项目。'],
            ['调整图层', '其效果和调色会作用于下方各片段的图层。'],
            ['关键帧', '在特定时间设定的数值，用于为属性制作动画。'],
            ['LUT', '应用色彩变换的查找表（.cube）。'],
            ['修补目标', '源监视器的编辑所送往的时间线轨道。'],
            ['渲染队列', '按顺序排列、逐个渲染的导出列表。'],
            ['预检', '在导出开始之前运行的就绪检查。'],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
