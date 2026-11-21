import type { DocPageContent } from '../../docs-content'

// order 1.5 places this right after Getting Started in the Start group.
const page = {
  order: 1.5,
  slug: 'concepts',
  title: 'DroneClean Studio 如何运作',
  description: '基本思路：本地优先的存储、项目与链接的媒体、帧与时间码，以及 GPU 流水线。',
  category: 'Start',
  related: ['workspaces', 'getting-started', 'editing-tools'],
  sections: [
    {
      title: '本地优先，是刻意的设计',
      blocks: [
        {
          kind: 'list',
          items: [
            'DroneClean Studio 在你的浏览器中运行，并把所有内容存放在磁盘上的一个**工作区文件夹**里。',
            '你的原始视频和音频是被**链接**的，而不是被复制或上传的，DroneClean Studio 指向的是这些文件原本所在的位置。',
            '项目、缓存、生成的素材和导出文件都写入工作区，因此你可以像处理任何文件夹一样对它进行备份或移动。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '由于媒体是被链接的，移动或重命名源文件后，它会显示为**缺失媒体**，直到你重新链接为止。参见[工作区与存储](workspaces)。',
        },
      ],
    },
    {
      title: '项目、轨道和片段',
      blocks: [
        {
          kind: 'list',
          items: [
            '**项目**包含一条时间线、它的设置（分辨率和帧率），以及对你所用媒体的引用。',
            '时间线把多条**轨道**叠在一起，位置较高的轨道渲染在较低的轨道之上。',
            '时间线上的**片段**是源文件的一扇窗口：修剪片段只会改变播放的是源文件的哪一部分，不会改动文件本身。',
            '**调整图层**是一种本身不带任何媒体的片段，它会把自己的效果和颜色应用到下方的每个片段上。',
          ],
        },
      ],
    },
    {
      title: '序列与复合片段',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio 为**项目中的一条时间线**提供了一个基本单元，也就是合成。根据你的使用方式，它以两种形式出现。',
        },
        {
          kind: 'list',
          items: [
            '**Motion 合成**会在 **Motion** 中打开，共用的编辑器会让你的媒体、预览和属性留在原位，而下方的面板则变成图层时间线。',
            '**序列**是同一项目中独立的时间线，从标签栏的某个标签页打开。每个序列都有自己的轨道、片段和编辑历史，主时间线本身也是一个序列。',
            '**复合片段**会取时间线的一段，把它折叠成单个可重复使用的媒体项目。在时间线上，它表现得像一个片段（可移动、修剪、添加效果），而它的内容则存放在自己的时间线中。',
            '二者其实是同一个东西的不同呈现：打开复合片段，就可以把它的内容当作序列来编辑；任何序列也都可以作为复合片段放进另一条时间线。',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '合成可以包含其他合成，但绝不能包含自身，DroneClean Studio 会阻止循环引用，因此复合片段永远不可能被嵌套进它自己的内容里。',
        },
      ],
    },
    {
      title: '帧与时间码',
      blocks: [
        {
          kind: 'list',
          items: [
            '时间以**帧**为单位计量。片段有一个起始帧，以及按项目帧率计算的帧数长度。',
            '预览显示的是**时间码**；在某些视图中点击读数，可以切换为帧号。',
            '源媒体的帧率可以与项目不同，因此在你剪辑时，DroneClean Studio 会把源帧转换为项目帧。',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '创建项目时，请把项目的分辨率和帧率设置为与你的交付目标一致。',
        },
      ],
    },
    {
      title: '一切都在你的电脑上渲染',
      blocks: [
        {
          kind: 'list',
          items: [
            '播放、效果、调色和 AI 工具都在本地运行，使用你的 GPU（WebGPU）和 CPU（WebCodecs）。',
            '**代理**是为较重的媒体生成的轻量副本，能让剪辑更流畅；最终导出始终使用原始文件。',
            '由于没有云端渲染，导出期间保持标签页打开很重要，因为渲染就发生在浏览器里。',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
